#!/usr/bin/env node
// post-commit.cjs - Update workflow state phase to "commit" after git commit
// Trigger: PostToolUse (Bash) — fires only when bash command contains "git commit"
// Rewritten from package/.claude/hooks/post-commit-handler.sh

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');

  /**
   * Files still untracked in the working tree right after a commit.
   *
   * A commit that reports success is not the same as a commit that captured the work.
   * `git add <dir>` stages modifications to files git already knows about and silently
   * ignores everything new, so a deliverable made entirely of new files can be committed
   * away to nothing. That is not hypothetical: bk-git-manager reported two commits with
   * "no staged files remaining, ready for your review" while all 15 new files of the
   * sub-task — 12 widgets and 3 tests, the whole deliverable — sat untracked, and it took
   * a follow-up commit to repair. Nothing in the harness noticed.
   *
   * Only files this session actually wrote are reported. That is the whole question — "did
   * the commit capture the work?" — and anything else is somebody else's untracked clutter.
   *
   * The first version reported every untracked path, and the field showed why that fails: on
   * two consecutive commits it named the same 10 files, 9 of which were kit infrastructure
   * that `bk update` had installed and the project had simply not committed yet. A warning
   * that says the same irrelevant thing after every commit is one nobody reads, which is the
   * same as not having it.
   *
   * file-edit-history.jsonl is the record of what the session wrote, so intersecting against
   * it keeps exactly the files whose absence from the commit would be a real loss — the 15 new
   * widgets and tests of the original failure would all be in it — and drops the rest.
   *
   * Untracked files are surfaced, never blocked: only the caller knows what the deliverable
   * was supposed to contain.
   */
  function sessionEditedFiles(cwd) {
    try {
      const fs = require('fs');
      const path = require('path');
      const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
      const root = resolveProjectRoot({ cwd });
      const file = path.join(root, '.bk-metrics', 'file-edit-history.jsonl');
      const out = new Set();
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const raw = line.trim();
        if (!raw) continue;
        try {
          const entry = JSON.parse(raw);
          if (entry && entry.file) out.add(path.resolve(String(entry.file)));
        } catch { /* skip malformed */ }
      }
      return out;
    } catch {
      return null; // no history — fall back to reporting every untracked file
    }
  }

  /**
   * The kit's per-machine session state — mirrors NEVER_COMMIT in the CLI's
   * lib/session-state-gitignore.mjs (ESM, different install tree, so not shared by import;
   * post-commit.test.mjs feeds every NEVER_COMMIT entry through this hook to keep them equal).
   *
   * None of it is ever a deliverable, and listing it here pushed the other way: after the
   * warning named untracked kit paths, the conductor in X-Game-Pro asked bk-git-manager to
   * commit "the bk state" too, and 75e97db put .workflow-state.json.bak, .retry-state.json and
   * five checkpoints into history. Matched at any depth, because git reports paths from the
   * repository root and the project may be a subdirectory; `.bk-metrics/` is matched in any
   * directory because the kit also writes it under feature dirs. `.claude/hooks/.logs/` is the
   * hooks' own run log — appended on every hook run, this one included.
   */
  const SESSION_STATE = [
    /(^|\/)bk\/dev\/shared\/\.workflow-state\.json(\..*)?$/,
    /(^|\/)bk\/dev\/shared\/(checkpoints|handoff)(\/|$)/,
    /(^|\/)bk\/dev\/shared\/\.(statusline-cache|retry-state)\.json$/,
    /(^|\/)\.bk-metrics(\/|$)/,
    /(^|\/)\.claude\/hooks\/\.logs(\/|$)/,
  ];
  const isSessionState = (f) => SESSION_STATE.some((re) => re.test(f));

  /**
   * An untracked directory git collapsed into one line that also holds session state —
   * `bk/`, `bk/dev/`, `bk/dev/shared/`. Naming it is right (the session may have written a
   * plan in there), but `git add` on it would sweep the state in with the plan.
   */
  const holdsSessionState = (f) => f.endsWith('/') && /(^|\/)bk\/(dev\/(shared\/)?)?$/.test(f);

  function untrackedFiles(cwd) {
    try {
      const { execSync } = require('child_process');
      const out = execSync('git status --porcelain --untracked-files=normal', {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
        cwd: cwd || undefined, timeout: 3000
      });
      const path = require('path');
      const edited = sessionEditedFiles(cwd);
      const base = cwd || process.cwd();

      return out.split('\n')
        .filter((l) => l.startsWith('?? '))
        .map((l) => l.slice(3).trim())
        .filter(Boolean)
        .filter((f) => !f.endsWith('.bak') && !isSessionState(f))
        .filter((f) => {
          if (!edited) return true;                      // no history: report everything
          if (f.endsWith('/')) {                         // git collapses an untracked directory
            const dir = path.resolve(base, f);
            for (const e of edited) if (e.startsWith(dir)) return true;
            return false;
          }
          return edited.has(path.resolve(base, f));
        });
    } catch {
      return []; // not a repo, git missing, timeout — never block the commit path
    }
  }

  async function main() {
    const timer = createHookTimer('post-commit');
    try {
      const { isHookEnabled, readWorkflowState, writeWorkflowState } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('post-commit')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const toolResponse = data.tool_response || {};

      // Only act on git commit commands
      const command = toolInput.command || '';
      if (!command.includes('git commit')) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Check commit succeeded — output contains "[branch hash]" pattern
      const output = typeof toolResponse === 'string'
        ? toolResponse
        : (toolResponse.stdout || JSON.stringify(toolResponse));

      const commitSucceeded = /\[.+\s[a-f0-9]+\]/.test(output);
      if (!commitSucceeded) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Extract commit hash from output if available
      const hashMatch = output.match(/\[.+\s([a-f0-9]+)\]/);
      const commitHash = hashMatch ? hashMatch[1] : null;

      // Update workflow state phase
      const state = readWorkflowState();
      if (!state) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Append to the history read under the write lock — a hook that lands between the read
      // above and this write would otherwise have its entry dropped.
      //
      // Only a real phase CHANGE earns a history entry. Batched commits are normal — a session
      // in the iOS field repo made four in a row while already in `commit` — and the previous
      // version appended a `commit -> commit` no-op for each one. Those four meaningless
      // entries filled phase_history and then fed fsm-guard's phase-recurrence ladder as if
      // they were a genuine dead-loop, which is how `critical-fixes` ended up wedged at commit.
      writeWorkflowState((fresh) => {
        const alreadyCommitted = fresh.current_phase === 'commit';
        return {
          current_phase: 'commit',
          ...(alreadyCommitted ? {} : {
            phase_history: [
              ...(Array.isArray(fresh.phase_history) ? fresh.phase_history : []),
              { from: fresh.current_phase || null, to: 'commit', timestamp: new Date().toISOString() }
            ].slice(-20)  // cap to prevent unbounded growth
          }),
          ...(commitHash ? { last_commit_hash: commitHash } : {})
        };
      });

      let context = `[POST-COMMIT] Phase → commit${commitHash ? ` (${commitHash})` : ''}. Feature "${state.feature || 'unknown'}".`;

      const untracked = untrackedFiles(data.cwd);
      let referenced = [];
      if (untracked.length) {
        // Sharper than "something is untracked": does THIS commit use an untracked file? Then it
        // cannot build on its own and the history is not bisectable. Optional lib, bounded work.
        try {
          referenced = require('./lib/commit-untracked-references.cjs')
            .findReferencedUntracked(untracked, data.cwd).referenced;
        } catch { /* optional lib — fall back to the generic warning */ }
        const refSet = new Set(referenced.map((r) => r.file));
        // A referenced file may sit inside a collapsed `dir/` line: drop the line only when the
        // exact path matched, otherwise leave the directory in the generic list.
        const rest = untracked.filter((f) => !refSet.has(f));

        if (referenced.length) {
          context += `\n[POST-COMMIT] WARNING: this commit references file(s) that are still untracked — ` +
            `it will not build or pass on its own, and the history is not bisectable:\n` +
            referenced.slice(0, 8).map((r) =>
              `  ?? ${r.file}  (used by ${r.usedBy.slice(0, 3).join(', ')}${r.usedBy.length > 3 ? ', ...' : ''})`
            ).join('\n') +
            `\nStage them into this commit (git add <file> && git commit --amend --no-edit) or reorder ` +
            `the commits so they land first.`;
        }
        if (rest.length) {
          // Eight names are enough to recognise the deliverable; `git status` has the rest.
          const shown = rest.slice(0, 8);
          const more = rest.length - shown.length;
          const listing = `${rest.length} file(s) are still untracked after this commit:\n` +
            shown.map((f) => `  ?? ${f}`).join('\n') + (more > 0 ? `\n  ...and ${more} more` : '');
          let fix = null;
          try {
            fix = require('./lib/untracked-fix-command.cjs').buildFixCommand(rest, { skip: holdsSessionState });
          } catch { /* optional lib — fall back to the generic hint */ }
          const hint = fix && fix.command
            ? `\nThese are files this session wrote. If they belong to this change (source, tests, the bk/dev/<feature>/ plan, ` +
              `.claude/agent-memory), fold them in with ONE command: ${fix.command}` +
              `\nIf one is deliberately left out, add it to .gitignore or tell the user why. Never stage .env/keys.`
            : `\nIf any belong to this commit it did not capture them (\`git add <dir>\` skips new files).`;
          context += referenced.length
            // Dependency already called out above: keep the remainder to a one-line note.
            ? `\n[POST-COMMIT] Also ${listing}`
            : `\n[POST-COMMIT] WARNING: ${listing}${hint}` +
              `\nVerify: git show --stat ${commitHash || 'HEAD'}`;
        }
        if (untracked.some(holdsSessionState)) {
          context += `\nStage files by name inside bk/: bk/dev/shared/ also holds per-machine session state ` +
            `(.workflow-state.json*, checkpoints/, handoff/, .retry-state.json, .statusline-cache.json) that is never committed.`;
        }

        try {
          const { trackWarnSignal } = require('./lib/harness-policy-loader.cjs');
          trackWarnSignal('untracked_after_commit', {
            commit: commitHash, count: untracked.length, files: untracked.slice(0, 20),
            referenced_by_commit: referenced.slice(0, 20).map((r) => r.file)
          });
        } catch { /* telemetry is best-effort */ }
      }

      // Advisory context is subject to the shared injection budget (cap + dedupe). Optional:
      // if the lib is absent the text goes out unchanged.
      let text = context;
      try {
        const injectionBudget = require('./lib/injection-budget.cjs');
        text = injectionBudget.prepareInjection('post-commit', context, {
          sessionId: injectionBudget.sessionIdFrom(data)
        });
      } catch { /* optional lib — keep the full text */ }

      if (text) process.stdout.write(JSON.stringify({ additionalContext: text }) + '\n');

      timer.end({ status: untracked.length ? 'untracked_after_commit' : 'ok', exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a
  // crash. Logging it here is how a clean run got filed as `status: "crash"`.
  if (e && e.bkDispatchExit) throw e;

  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'post-commit', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'post-commit', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
