/**
 * hook-perf-measure.mjs — Measure what the kit's hooks actually cost per tool call.
 *
 * Every matching hook is a fresh `node` process. One Edit fires the PreToolUse and PostToolUse
 * groups that match "Edit", which on a stock kit is ~20 spawns; a Task fires ~9. Nothing in the
 * kit reported that number, so any hook-consolidation work had no baseline. This produces it.
 *
 * Two rules shape the whole module:
 *
 * 1. Measuring must not touch the user's project. Hooks write state files, ledgers and metrics,
 *    and some shell out to git. Only a minority of them resolve the project root through
 *    lib/resolve-project-root.cjs, so exporting BK_PROJECT_ROOT is not enough — the rest walk up
 *    from __dirname or fall back to process.cwd(). So the whole .claude/ tree is copied into a
 *    temp dir and the hooks are run FROM the copy, with cwd, BK_PROJECT_ROOT and
 *    CLAUDE_PROJECT_DIR all pointing there. That covers every resolution path a hook can take.
 *
 * 2. Wall-clock and CPU are different numbers and both matter. Claude Code runs the hooks of one
 *    event in parallel, so the latency added to a tool call is roughly the MAX over that event's
 *    hooks, while the CPU burned is the SUM. Reporting only the sum overstates the wait;
 *    reporting only the max hides the contention that hurts on a machine also running Xcode or
 *    Gradle.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Events whose matcher is a tool name. Everything else fires on session/agent lifecycle. */
const TOOL_EVENTS = ['PreToolUse', 'PostToolUse'];

/**
 * What the user actually does, expressed as tool calls.
 *
 * Grouping by scenario rather than by settings.json group is deliberate: settings.json has
 * overlapping matchers (PostToolUse carries both "Edit|Write" and "Write|Edit"), so its structure
 * says nothing about how many processes one keystroke costs.
 */
export const DEFAULT_SCENARIOS = [
  { name: 'Edit a file', toolName: 'Edit', toolInput: { file_path: 'src/main.txt', old_string: 'a', new_string: 'b' } },
  { name: 'Write a file', toolName: 'Write', toolInput: { file_path: 'src/main.txt', content: 'hello' } },
  { name: 'Delegate', toolName: 'Task', toolInput: { subagent_type: 'general-purpose', description: 'probe', prompt: 'probe' } },
  { name: 'Read a file', toolName: 'Read', toolInput: { file_path: 'src/main.txt' } },
  { name: 'Run a command', toolName: 'Bash', toolInput: { command: 'echo hi', description: 'probe' } }
];

/**
 * A matcher made only of these characters is a plain name or a list of names, never a regex.
 * Straight from the Hooks Reference: letters, digits, `_`, `-`, spaces, `,` and `|`.
 */
const PLAIN_MATCHER = /^[A-Za-z0-9_\- ,|]+$/;

/**
 * Does a settings.json matcher fire for this tool name?
 *
 * Claude Code's Hooks Reference defines three branches, and the difference between them is not
 * cosmetic — the same string means different things under each:
 *
 * 1. "", "*" or absent — every tool.
 * 2. Only letters, digits, `_`, `-`, spaces, `,` or `|` — an exact name, or a `|`/`,`-separated
 *    list of exact names. Compared by equality, so "Edit" does NOT fire for "MultiEdit".
 * 3. Anything else — a JavaScript regex, evaluated UNANCHORED. So "mcp_*" (regex: "mcp" plus any
 *    number of underscores) matches at position 0 of "mcp__github__list_issues" and does fire.
 *
 * Anchoring branch 3 the way this used to would silently disable every glob-shaped matcher in a
 * user's settings and under-report their hook cost. An unparseable regex falls back to an exact
 * comparison rather than throwing — a bad matcher in someone's settings must not kill the report.
 */
export function matchesTool(matcher, toolName) {
  const raw = (matcher ?? '').trim();
  if (raw === '' || raw === '*') return true;

  if (PLAIN_MATCHER.test(raw)) {
    return raw
      .split(/[|,]/)
      .map((name) => name.trim())
      .filter(Boolean)
      .includes(toolName);
  }

  try {
    return new RegExp(raw).test(toolName);
  } catch (_) {
    return raw === toolName;
  }
}

/**
 * Hook script filename out of a settings.json command string.
 *
 * Commands come in several shapes — `node $CLAUDE_PROJECT_DIR/.claude/hooks/x.cjs`, or wrapped in
 * `bash -c '...git rev-parse...'`. Only the filename is taken: the hook is then run from the
 * sandbox copy by absolute path, which is what keeps the measurement off the real project no
 * matter what the original command line pointed at.
 *
 * @returns {string|null}
 */
export function hookScriptFromCommand(command) {
  const match = String(command || '').match(/\.claude[/\\]hooks[/\\]([\w.@/\\-]+\.c?js)/);
  return match ? match[1].replace(/\\/g, '/') : null;
}

/**
 * Extra hook names a command passes as arguments.
 *
 * bk-dispatch.cjs is invoked as `node .../bk-dispatch.cjs a.cjs b.cjs c.cjs`, and those arguments
 * ARE the hooks. Dropping them would leave the measurement timing an empty dispatcher — one
 * process that loads nothing and exits — and reporting it as the whole cost of an Edit.
 *
 * @returns {string[]}
 */
export function hookArgsFromCommand(command) {
  const parts = String(command || '').trim().split(/\s+/);
  // Only a bare `node <script> <names...>` has arguments this tool can interpret. Anything
  // wrapped in a shell is left as a single opaque process.
  if (parts[0] !== 'node' || !/\.c?js$/.test(parts[1] || '')) return [];
  const args = parts.slice(2);
  return args.every((a) => /^[\w.-]+\.c?js$/.test(a)) ? args : [];
}

/**
 * Every hook process that runs for one tool name, in settings.json order, tagged with its event.
 *
 * One entry per PROCESS, not per hook: a bk-dispatch.cjs entry is one process that runs the hooks
 * named in `args`, and `hookCount` says how many. Reporting it as several entries would invent
 * spawns that no longer happen; reporting it as one hook would hide the work it does.
 *
 * Duplicates are kept: two matcher groups on the same event that both list a hook really do spawn
 * it twice, and hiding that would flatter the numbers.
 *
 * @returns {Array<{event: string, matcher: string, script: string, args: string[], hookCount: number}>}
 */
export function resolveHooksForTool(settings, toolName) {
  const out = [];
  const hooks = settings?.hooks || {};
  for (const event of TOOL_EVENTS) {
    for (const group of hooks[event] || []) {
      if (!matchesTool(group.matcher, toolName)) continue;
      for (const entry of group.hooks || []) {
        const script = hookScriptFromCommand(entry.command);
        if (!script) continue;
        const args = hookArgsFromCommand(entry.command);
        out.push({ event, matcher: group.matcher ?? '', script, args, hookCount: args.length || 1 });
      }
    }
  }
  return out;
}

/** Minimal but realistic stdin payload — the fields hooks actually read. */
function payloadFor(event, scenario, sandboxDir) {
  const base = {
    session_id: 'bk-hook-perf',
    transcript_path: join(sandboxDir, '.claude', 'hook-perf-transcript.jsonl'),
    cwd: sandboxDir,
    hook_event_name: event,
    tool_name: scenario.toolName,
    tool_input: scenario.toolInput
  };
  if (event === 'PostToolUse') base.tool_response = { success: true };
  return JSON.stringify(base);
}

/** Median of a sample list; the lower middle for an even count, which is fine for n=3. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** One timed `node <script>` run with the payload on stdin. */
function timeOnce(nodeArgs, input, { cwd, env, timeoutMs }) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, nodeArgs, {
    input, cwd, env, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const timedOut = result.signal === 'SIGTERM' || result.error?.code === 'ETIMEDOUT';
  return { ms, timedOut, status: result.status, spawnError: result.error && !timedOut ? result.error.message : null, stderr: result.stderr || '' };
}

/**
 * Median cost of spawning node and doing nothing.
 *
 * Printed separately because it is the floor under every hook: without it a "55ms hook" reads as
 * slow when ~45ms of it is process startup that no amount of hook rewriting removes.
 */
export function measureSpawnFloor({ runs = 3, timeoutMs = 5000 } = {}) {
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(timeOnce(['-e', ''], '', { cwd: tmpdir(), env: process.env, timeoutMs }).ms);
  return { medianMs: median(samples), samples };
}

/**
 * Copy the target's .claude/ into a fresh temp dir so hooks run against a throwaway project.
 * @returns {string} sandbox root (contains .claude/)
 */
export function createSandbox(targetDir) {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'bk-hook-perf-'));
  cpSync(join(targetDir, '.claude'), join(sandboxDir, '.claude'), { recursive: true, dereference: false });
  return sandboxDir;
}

/**
 * Measure the kit's hooks for `targetDir`, per scenario.
 *
 * A hook exiting non-zero is normal — blocking is what exit codes are for — so a non-zero status
 * is recorded, not flagged. Timeouts and spawn failures are flagged, because those are the two
 * cases where the number printed is not a real measurement.
 *
 * @returns {{targetDir: string, runs: number, timeoutMs: number, spawnFloorMs: number,
 *   scenarios: Array<object>, measurements: Array<object>, problems: Array<object>, error?: string}}
 */
export function measureHookPerf({ targetDir, runs = 3, timeoutMs = 5000, scenarios = DEFAULT_SCENARIOS } = {}) {
  const settingsPath = join(targetDir, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    return { targetDir, runs, timeoutMs, spawnFloorMs: 0, scenarios: [], measurements: [], problems: [], error: `No kit found at ${settingsPath}` };
  }

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    return { targetDir, runs, timeoutMs, spawnFloorMs: 0, scenarios: [], measurements: [], problems: [], error: `Could not parse ${settingsPath}: ${err.message}` };
  }

  const spawnFloor = measureSpawnFloor({ runs, timeoutMs });
  const sandboxDir = createSandbox(targetDir);
  const measurements = [];

  try {
    // Every one of the four root-resolution priorities in resolve-project-root.cjs — env vars,
    // the stdin cwd, the __dirname walk-up, process.cwd() — now lands inside the sandbox.
    const env = { ...process.env, BK_PROJECT_ROOT: sandboxDir, CLAUDE_PROJECT_DIR: sandboxDir };

    const scenarioReports = scenarios.map((scenario) => {
      const matched = resolveHooksForTool(settings, scenario.toolName);
            // `count` is processes; `hooks` is the hooks they run. They differ once dispatch wiring
      // folds a matcher group's hooks into one process, and conflating them is how a report ends
      // up claiming an Edit got 4x cheaper because it stopped counting most of the work.
      const perEvent = new Map(TOOL_EVENTS.map((e) => [e, { event: e, count: 0, hooks: 0, wallMs: 0, cpuMs: 0 }]));

      for (const hook of matched) {
        const hookPath = join(sandboxDir, '.claude', 'hooks', hook.script);
        const record = { scenario: scenario.name, toolName: scenario.toolName, ...hook, medianMs: 0, samples: [], status: 'ok', exitCode: null, detail: null };

        if (!existsSync(hookPath)) {
          record.status = 'missing';
          record.detail = 'hook file not found in the kit';
        } else {
          const input = payloadFor(hook.event, scenario, sandboxDir);
          for (let i = 0; i < runs; i++) {
            const run = timeOnce([hookPath, ...(hook.args || [])], input, { cwd: sandboxDir, env, timeoutMs });
            record.samples.push(run.ms);
            record.exitCode = run.status;
            if (run.timedOut) { record.status = 'timeout'; record.detail = `exceeded ${timeoutMs}ms`; }
            else if (run.spawnError) { record.status = 'error'; record.detail = run.spawnError; }
            else if (run.status === null && record.status === 'ok') { record.status = 'error'; record.detail = (run.stderr.trim().split('\n')[0] || 'no exit status'); }
          }
          record.medianMs = median(record.samples);
        }

        measurements.push(record);
        const bucket = perEvent.get(hook.event);
        bucket.count += 1;
        bucket.hooks += record.hookCount || 1;
        bucket.cpuMs += record.medianMs;
        bucket.wallMs = Math.max(bucket.wallMs, record.medianMs);
      }

      const events = TOOL_EVENTS.map((e) => perEvent.get(e)).filter((b) => b.count > 0);
      return {
        name: scenario.name,
        toolName: scenario.toolName,
        processCount: matched.length,
        hookCount: matched.reduce((sum, h) => sum + (h.hookCount || 1), 0),
        // The events fire at different moments, so their waits add; within one event they overlap.
        wallMs: events.reduce((sum, b) => sum + b.wallMs, 0),
        cpuMs: events.reduce((sum, b) => sum + b.cpuMs, 0),
        events
      };
    });

    return {
      targetDir,
      runs,
      timeoutMs,
      spawnFloorMs: spawnFloor.medianMs,
      scenarios: scenarioReports,
      measurements,
      problems: measurements.filter((m) => m.status !== 'ok')
    };
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
}

/** Slowest hook processes by median, one row per script (worst scenario wins). */
export function slowestHooks(measurements, limit = 8) {
  const best = new Map();
  for (const m of measurements) {
    const seen = best.get(m.script);
    if (!seen || m.medianMs > seen.medianMs) best.set(m.script, m);
  }
  return [...best.values()].sort((a, b) => b.medianMs - a.medianMs).slice(0, limit);
}

const ms = (value) => `${value.toFixed(0)}ms`;

/**
 * Render the report. Separate from measurement so tests can assert on structure, not on text.
 * @returns {string[]} lines
 */
export function formatHookPerfReport(result, { indent = '  ' } = {}) {
  if (result.error) return [`${indent}${result.error}`, `${indent}Run "init" in this directory first; hook timing needs an installed kit.`];

  const lines = [];
  const say = (line = '') => lines.push(line ? `${indent}${line}` : '');

  say(`node spawn floor: ${ms(result.spawnFloorMs)} per process (median of ${result.runs}).`);
  say('Every hook pays that before it does any work of its own.');
  say();
  say('Per tool call (median of each hook, measured in a throwaway copy of .claude/):');
  say();
  for (const s of result.scenarios) {
    const detail = s.events.map((e) => `${e.event.replace('ToolUse', '')} ${e.count}`).join(' + ');
    const procs = s.processCount === s.hookCount ? `${s.processCount} processes` : `${s.processCount} processes running ${s.hookCount} hooks`;
    say(`${s.name} (${s.toolName})`);
    say(`  ${procs} (${detail})  wall ~${ms(s.wallMs)}  cpu ${ms(s.cpuMs)}`);
  }
  say();
  say('wall = what the tool call waits for (hooks of one event run in parallel, so max per event).');
  say('cpu  = total processor time burned (sum), which is what competes with a running build.');

  const dispatched = result.measurements.filter((m) => (m.hookCount || 1) > 1);
  if (dispatched.length) {
    say();
    say('This kit runs each matcher group\'s hooks in one bk-dispatch.cjs process, so the rows');
    say('below are per PROCESS. A dispatcher row is the whole group — the per-hook breakdown it');
    say('replaces is not measurable from here. To attribute cost to a single hook again, rebuild');
    say('the kit with BK_HOOK_DISPATCH=off and re-run this.');
  }

  const slow = slowestHooks(result.measurements);
  if (slow.length) {
    say();
    say('Slowest hook processes:');
    for (const m of slow) {
      const covers = (m.hookCount || 1) > 1 ? ` (${m.hookCount} hooks)` : '';
      say(`  ${ms(m.medianMs).padStart(7)}  ${m.script}${covers}  [${m.event} ${m.matcher || '*'}]`);
    }
  }

  if (result.problems.length) {
    say();
    say('Not measured cleanly:');
    for (const p of result.problems) say(`  ${p.script} [${p.event}, ${p.toolName}] — ${p.status}: ${p.detail}`);
  }

  say();
  say('Hooks ran against a temp copy, with git and project state absent, so a hook that shells');
  say('out to git may be faster or slower here than in the real repo.');
  return lines;
}

/**
 * Print the report. Never throws for a slow or unhappy kit — this is a measurement, not a gate.
 */
export function reportHookPerf(targetDir, { runs = 3, indent = '  ', log = console.log } = {}) {
  const result = measureHookPerf({ targetDir, runs });
  for (const line of formatHookPerfReport(result, { indent })) log(line);
  return result;
}
