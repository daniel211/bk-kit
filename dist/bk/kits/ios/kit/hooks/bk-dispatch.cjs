#!/usr/bin/env node
'use strict';
/**
 * bk-dispatch.cjs — run one settings.json matcher group's hooks in a single node process.
 *
 * Usage (written into settings.json by the build):
 *   node $CLAUDE_PROJECT_DIR/.claude/hooks/bk-dispatch.cjs fsm-guard.cjs privacy-block.cjs ...
 *
 * Why: every hook was its own `node`, and a `node` costs ~40ms to boot before it runs a line of
 * hook code. An Edit fired 20 of them, so roughly 800ms of the ~930ms of CPU an Edit spent on
 * hooks was V8 starting up. One process per matcher group takes that to five.
 *
 * Scope — one group, not one event. Claude Code still does all the matching: this replaces the
 * hook list inside a group and nothing else. The alternative, one dispatcher per event with the
 * matchers moved in here, would mean reimplementing four different matcher domains (tool names,
 * SessionStart sources, SubagentStop agent names, and the empty matcher) and would break any hook
 * a user adds to their own settings.json. It buys three more saved processes on an Edit, none of
 * them on the critical path, and is not worth owning that semantics.
 *
 * The hooks stay separate modules. This file loads them; it does not absorb them.
 */

const path = require('path');
const { readPayload, installStdin } = require('./lib/hook-dispatch-stdin.cjs');
const { mergeStdout, mergeExitCode, mergeStderr } = require('./lib/hook-dispatch-output.cjs');

/** A hung hook must never hang the tool call. Overridable for slow machines. */
const DEFAULT_TIMEOUT_MS = Number(process.env.BK_HOOK_TIMEOUT_MS) || 5000;

/** Only basenames are accepted — settings.json must not be able to point the dispatcher at /etc. */
function resolveHook(name) {
  const base = path.basename(String(name || '').trim());
  if (!base || !base.endsWith('.cjs') || base === 'bk-dispatch.cjs') return null;
  return path.join(__dirname, base);
}

async function main() {
  const hookPaths = process.argv.slice(2).map(resolveHook).filter(Boolean);
  if (hookPaths.length === 0) process.exit(0);

  const payload = readPayload();
  // Never restored: a hook still unwinding after the dispatch has moved on must not fall through
  // to the real fd 0, which was drained by readPayload() above.
  const stdin = installStdin(payload);

  let records;
  if (process.env.BK_HOOK_DISPATCH === 'off') {
    const { dispatchViaSpawn } = require('./lib/hook-dispatch-spawn.cjs');
    records = await dispatchViaSpawn(hookPaths, payload, { timeoutMs: DEFAULT_TIMEOUT_MS });
  } else {
    const { dispatch } = require('./lib/hook-dispatch-runner.cjs');
    records = await dispatch(hookPaths, { timeoutMs: DEFAULT_TIMEOUT_MS, beforeEach: stdin.freshStream });
  }

  for (const record of records) {
    if (record.status !== 'ok') {
      record.stderr += `[bk-dispatch] ${record.script}: ${record.status} — ${record.detail}\n`;
    }
  }

  // Diagnostics: BK_HOOK_DISPATCH_REPORT=<file> dumps the per-hook records. This is how the
  // "every hook exits on every path" assumption is checked against the real 50 rather than
  // assumed — a record with exited:false is a hook that stopped without saying so.
  //
  // A `.jsonl` path appends one line per dispatch instead of overwriting. A single JSON file
  // only ever holds the last dispatch, which is enough to check one tool call by hand and
  // useless for watching a session: the interesting dispatches are the rare ones, and they are
  // overwritten by whatever fired next. Appending keeps the whole run, at one line each.
  if (process.env.BK_HOOK_DISPATCH_REPORT) {
    const reportPath = process.env.BK_HOOK_DISPATCH_REPORT;
    try {
      if (reportPath.endsWith('.jsonl')) {
        // `payload` is the raw event text, not a parsed object — parse defensively, and label
        // the dispatch as best we can if it is not JSON at all.
        let event = null, tool = null;
        try {
          const parsed = JSON.parse(payload || '{}');
          event = parsed.hook_event_name || null;
          tool = parsed.tool_name || null;
        } catch { /* unparseable payload still deserves a report line */ }

        const line = JSON.stringify({
          ts: new Date().toISOString(),
          event,
          tool,
          durationMs: records.reduce((sum, r) => sum + (r.durationMs || 0), 0),
          exitCode: mergeExitCode(records),
          hooks: records.map((r) => ({
            script: r.script,
            status: r.status,
            exitCode: r.exitCode,
            exited: r.exited,
            durationMs: r.durationMs,
            ...(r.detail ? { detail: r.detail } : {})
          }))
        });
        require('./lib/jsonl-rotator.cjs').appendJsonl(reportPath, line + '\n');
      } else {
        require('fs').writeFileSync(reportPath, JSON.stringify(records, null, 2));
      }
    } catch { /* diagnostics are best-effort */ }
  }

  const out = mergeStdout(records);
  const err = mergeStderr(records);
  if (out) process.stdout.write(out);
  if (err) process.stderr.write(err);
  process.exit(mergeExitCode(records));
}

// Fail open: a dispatcher fault must never block a tool call that no hook objected to.
main().catch((e) => {
  try { process.stderr.write(`[bk-dispatch] CRASH (fail-open): ${e && e.message}\n`); } catch { /* ignore */ }
  process.exit(0);
});
