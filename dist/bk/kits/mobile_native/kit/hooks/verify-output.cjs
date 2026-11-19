#!/usr/bin/env node
// verify-output.cjs - Verify agent output files exist and check tool-restriction violations
// Trigger: SubagentStop (completions only — see lib/subagent-stop-identity.cjs)
// Rewritten from package/.claude/hooks/verify-agent-output.sh
//
// Why SubagentStop and not PostToolUse(Task|Agent), which is where this hook ran until 0.10.1:
// Claude Code now runs Agent/Task calls in the background by default, and for a background
// call PostToolUse fires ~2s after LAUNCH with a tool_response of "Async agent launched
// successfully…". This hook then looked for a report the agent had not had time to write,
// recorded a failure, and on the second one injected `[REACTIVE-SIGNAL: agent_stuck] (HIGH)`.
// Measured in X-Game-Pro on 2026-09-23: the hook output recorded in the main transcripts reads
// `bk-ios-developer failed 10x` — every single dispatch counted as a failure — and the
// tool-restriction scan, reading the same launch metadata, could not have seen a forbidden
// tool if one had been used. SubagentStop fires when the agent actually finishes and names its
// own transcript, which is the record of what it did.
//
// Delivery: nothing this hook prints reaches the conductor. SubagentStop output stays in the
// subagent's transcript, and even the old PostToolUse text never did — it was a bare
// `{additionalContext}`, which Claude Code records with `content: ""`. Verdicts are queued in
// lib/conductor-inbox.cjs and delivered by conductor-inbox-drain.cjs.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  const READ_ONLY_AGENTS = new Set([
    'bk-code-reviewer', 'bk-security-auditor',
    'bk-performance-analyzer', 'bk-test-architect'
  ]);

  // Agents that must not modify project code but DO need Bash to drive an external
  // review harness. Bash is bounded by an allowlist rather than forbidden outright.
  const CODE_IMMUTABLE_AGENTS = new Set([
    'bk-gemini-reviewer',
    'bk-codex-reviewer'
  ]);

  // The harness itself, plus read-only inspection an agent may reasonably reach for
  // while assembling scope. Anything else is a violation.
  const HARNESS_BASH_ALLOWLIST = [
    /(?:^|[/\s;&|])agy(?:\s|$)/,                  // Antigravity CLI — the current harness
    /(?:^|[/\s;&|])gemini(?:\s|$)/,               // retired Gemini CLI, still tolerated
    /gemini-review\.mjs(?:\s|$)/,                 // the runner script
    /(?:^|[/\s;&|])codex(?:\s|$)/,                // OpenAI Codex CLI — bk-codex-reviewer's harness
    /codex-review\.mjs(?:\s|$)/,                  // its runner script
    // Availability probes. `where` is the Windows spelling the runner uses; omitting it
    // flagged every probe on Windows as a violation.
    /^\s*(?:which|command\s+-v|where|type)\s/,
    /^\s*git\s+(?:diff|status|log|show|ls-files|rev-parse|branch)\b/,
    /^\s*(?:ls|cat|head|tail|wc|find|grep|rg|pwd|echo)\b/
  ];

  // Flags that lift a harness CLI's sandbox. A command carrying one is a violation even when
  // the allowlist above would otherwise match it (e.g. `codex exec --full-auto`).
  const HARNESS_BASH_DENYLIST = [
    /--dangerously-bypass-approvals-and-sandbox\b/, /--full-auto\b/, /--dangerously-skip-permissions\b/
  ];

  /** Tools that modify an existing file in place. Read-only agents may use none of them. */
  const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);

  /** Tools that dispatch another agent. A worker doing so breaks the worker preamble. */
  const DISPATCH_TOOLS = new Set(['Task', 'Agent']);

  const clip = (s) => (s.length > 120 ? `${s.slice(0, 117)}...` : s);

  /**
   * Bash commands, from the agent's own tool calls, that fall outside the harness allowlist.
   * This used to regex `"command": "…"` out of the stringified PostToolUse tool_response,
   * which under background dispatch is launch metadata with no commands in it at all.
   */
  function offAllowlistBashCommands(toolUses) {
    const found = [];
    for (const use of toolUses) {
      if (use.name !== 'Bash') continue;
      const cmd = typeof use.input.command === 'string' ? use.input.command : '';
      if (!HARNESS_BASH_ALLOWLIST.some(pat => pat.test(cmd))
        || HARNESS_BASH_DENYLIST.some(pat => pat.test(cmd))) found.push(clip(cmd));
    }
    return found;
  }

  /**
   * Write calls that land outside bk/. The rule grants read-only agents "Write (reports
   * only)", and every report location the kit names is under bk/ — so a Write elsewhere is a
   * read-only agent creating or overwriting project files. A warning rather than an error:
   * the report path is dictated by the dispatch prompt, and a conductor may name another.
   */
  function writesOutsideBk(toolUses, root) {
    const path = require('path');
    const fs = require('fs');
    // Compare resolved paths: the hook's root comes from cwd, which is always the realpath,
    // while an agent may write through an alias (macOS /var → /private/var), and an unresolved
    // comparison called a bk/ report "outside bk/".
    const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
    const realRoot = real(root);
    const found = [];
    for (const use of toolUses) {
      if (use.name !== 'Write') continue;
      const target = typeof use.input.file_path === 'string' ? use.input.file_path : '';
      if (!target) continue;
      const rel = path.relative(realRoot, real(path.resolve(root, target))).split(path.sep).join('/');
      if (!rel.startsWith('bk/')) found.push(clip(target));
    }
    return found;
  }

  async function main() {
    const timer = createHookTimer('verify-output');
    try {
      const fs = require('fs');
      const path = require('path');
      const { isHookEnabled, readWorkflowState, sharedDir } = require('./lib/bk-config-utils.cjs');
      const { readStopIdentity, isCompletion } = require('./lib/subagent-stop-identity.cjs');
      const { readAgentRun, filesWrittenBy } = require('./lib/agent-run-evidence.cjs');
      const { resolveReport } = require('./lib/agent-report-contract.cjs');

      if (!isHookEnabled('verify-output')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      // A settings.json that still wires this hook to PostToolUse(Task|Agent) — a hand-merged
      // one after `bk update --conflict keep`, say — must not resurrect the launch-time check.
      // Such a payload names its agent only in tool_input, so the completion gate below would
      // drop it anyway; saying so explicitly keeps the log honest about why.
      if (data.hook_event_name && data.hook_event_name !== 'SubagentStop') {
        timer.end({ status: 'not_subagent_stop', exit: 0 });
        process.exit(0);
      }

      // Most SubagentStop events are not an agent finishing — only the ones that name it are.
      // See lib/subagent-stop-identity.cjs for the field numbers (4 dispatches, 50 events).
      const identity = readStopIdentity(data);
      if (!isCompletion(identity)) {
        timer.end({ status: 'not_a_completion', exit: 0 });
        process.exit(0);
      }
      const agentType = identity.name;

      const root = resolveProjectRoot();
      const RETRY_STATE_FILE = path.join(sharedDir(root), '.retry-state.json');
      const sessionId = data.session_id || data.sessionId || null;

      const state = readWorkflowState();
      const feature = (state && state.feature) || null;
      const platform = process.env.BK_PLATFORM || (state && state.platform) || null;
      const planDir = state && typeof state.plan_dir === 'string' && state.plan_dir
        ? path.resolve(root, state.plan_dir)
        : null;

      const { resolveWorkflowId } = require('./lib/workflow-identity.cjs');
      const retryScope = resolveWorkflowId(state, sessionId);
      const retryKey = `${agentType}@${retryScope}`;

      /**
       * How long a recorded failure stays evidence about the run happening now.
       *
       * 2 hours. The counter feeds a signal that says "<agent> failed Nx on <feature>", which
       * the conductor acts on by dispatching a different agent — so it has to describe the work
       * in front of it. It did not: trustcall_ios still held
       * `bk-ios-developer:critical-security-fixes {count: 3}` from 2026-09-15 a week later,
       * because count is only ever reset by a success and nothing pruned the file. Reuse that
       * feature name weeks on and the FIRST stop fires agent_stuck with no failure in the
       * session at all.
       *
       * 2 hours is chosen to be longer than any plausible fix loop on one feature — the field's
       * longest single agent ran 638s, and a developer→reviewer→developer cycle is minutes, not
       * hours — and short enough that yesterday's failures cannot speak for today. Deliberately
       * not session-scoped: a compaction or a crash starts a new session mid-feature, and a
       * genuine repeat across that boundary is exactly what the signal is for.
       */
      const RETRY_EVIDENCE_TTL_MS = 2 * 60 * 60 * 1000;

      /** Enough to see the pattern, bounded so a state file users read stays readable. */
      const MAX_RECORDED_ERRORS = 5;

      /** Stable ids of completions already judged under this key — see the duplicate gate. */
      const MAX_RECORDED_STOPS = 10;

      /** Is this entry's last failure recent enough to still count? */
      function retryEvidenceIsFresh(entry, nowMs) {
        if (!entry || !entry.lastError) return false;
        const at = Date.parse(entry.lastError);
        return Number.isFinite(at) && (nowMs - at) < RETRY_EVIDENCE_TTL_MS;
      }

      function readRetryState() {
        try { return JSON.parse(fs.readFileSync(RETRY_STATE_FILE, 'utf8')) || {}; } catch (e) { return {}; }
      }

      // --- 0. Duplicate completion gate ---
      //
      // A completion can be reported twice (lib/subagent-stop-identity.cjs: a bk-project-manager
      // run whose second event read a longer transcript). Judged twice, one failed run would
      // count 2 and fire agent_stuck on its own. The stable ids this key has already judged are
      // kept on the entry; the entry lives as long as its failure evidence, which is the only
      // case where a repeat could change anything — re-judging a success is idempotent.
      {
        const seen = readRetryState()[retryKey];
        if (identity.id && seen && Array.isArray(seen.stops) && seen.stops.includes(identity.id)
            && retryEvidenceIsFresh(seen, Date.now())) {
          timer.end({ status: 'duplicate_stop', agent: agentType, exit: 0 });
          process.exit(0);
        }
      }

      // What the agent did, from its own transcript: when it started, and every tool it called.
      const run = readAgentRun(identity.transcript);

      // The first end_turn of an agent that has not yet called SubagentHandback is not its end:
      // the harness forces it to continue, and its report is usually written after this stop.
      // The real completion fires another SubagentStop, which is the one to judge.
      if (run.handbackPending) {
        timer.end({ status: 'handback_pending', agent: agentType, exit: 0 });
        process.exit(0);
      }

      const errors = [];
      const warnings = [];

      // --- 1. The report this agent owes, if it owes one ---
      //
      // lib/agent-report-contract.cjs holds which agents owe a file and where, and why that is a
      // list of places rather than one. An agent with no contract (bk-git-manager, the platform
      // developers, Explore, …) is never rejected for a missing file.
      //
      // The first evidence is the agent's own Write/Edit calls: any .md it wrote under bk/ this
      // run is its report, whatever it named it (X-Game-Pro 2026-09-25: 11 of 13 rejections were
      // reports under a name the glob list lacked). The glob list is only the fallback.
      const report = resolveReport(agentType, {
        root,
        reportsDir: path.join(sharedDir(root), 'reports'),
        feature,
        platform,
        planDir
      }, run.startMs, filesWrittenBy(run.toolUses));

      if (report.status === 'missing') {
        errors.push(
          `MISSING output file — the agent wrote no .md under bk/ this run, and none of these exist: ` +
          report.expected.join(', ')
        );
      } else if (report.status === 'stale') {
        errors.push(
          `STALE output file: ${report.path} was last modified before this agent started — ` +
          'it did not write its report this run'
        );
      }

      // --- 2. Report format (output-gate.md governs bk/dev/shared/reports/** only) ---
      if (report.status === 'found' && report.gated) {
        const expectedPath = report.path;
        const qContent = fs.readFileSync(expectedPath, 'utf8');

        // Validate Markdown structure (header + metadata footer)
        if (!/^## /m.test(qContent)) {
          errors.push(`Report missing ## header: ${expectedPath}`);
        }
        if (!/<!-- metadata:/.test(qContent)) {
          warnings.push(`Report missing metadata footer: ${expectedPath}`);
        }

        const qLines = qContent.split('\n');

        // Check minimum content length (not just format)
        if (qLines.length < 15) {
          warnings.push(`Report too short (${qLines.length} lines): ${expectedPath}`);
        }

        // Check for placeholder content
        const placeholderPatterns = [
          { pat: /\{\{.*\}\}/, label: 'Handlebars not rendered' },
          { pat: /TODO:/i,      label: 'Leftover TODO' },
          { pat: /TBD/i,        label: 'TBD placeholder' },
          { pat: /PLACEHOLDER/i, label: 'Explicit placeholder' },
        ];

        for (const line of qLines) {
          for (const { pat, label } of placeholderPatterns) {
            if (pat.test(line)) {
              warnings.push(`Possible placeholder in output (${label}): "${line.trim().substring(0, 60)}..."`);
              break;
            }
          }
        }

        // Check excessive "Not detected" fields
        const notDetectedMatches = qContent.match(/Not detected/gi);
        const notDetectedCount = notDetectedMatches ? notDetectedMatches.length : 0;
        if (notDetectedCount > 3) {
          warnings.push(`Too many "Not detected" fields (${notDetectedCount}) — scan may be incomplete`);
        }

        // Check for required sections based on agent type (fuzzy heading match)
        const requiredSections = {
          'bk-code-reviewer': [/^#{2,3}\s*findings/im, /^#{2,3}\s*summary/im],
          'bk-unit-test-agent': [/^#{2,3}\s*test\s*results?/im],
          'bk-security-auditor': [/^#{2,3}\s*vulnerabilit/im, /^#{2,3}\s*summary/im],
          'bk-performance-analyzer': [/^#{2,3}\s*findings/im, /^#{2,3}\s*summary/im],
        };

        const required = requiredSections[agentType];
        if (required) {
          for (const pattern of required) {
            if (!pattern.test(qContent)) {
              errors.push(`Missing required section matching ${pattern} in ${agentType} output`);
            }
          }
        }
      }

      // --- 3. Tool restriction, from the tools the agent actually called ---
      //
      // Read from the agent transcript's tool_use blocks. When the transcript cannot be read the
      // check is skipped, not guessed: it is a report after the fact, not a sandbox, and the
      // agent frontmatter's disallowedTools remains the primary boundary.
      if (run.readable && (READ_ONLY_AGENTS.has(agentType) || CODE_IMMUTABLE_AGENTS.has(agentType))) {
        const harness = CODE_IMMUTABLE_AGENTS.has(agentType);
        const label = harness ? 'Read-only+Harness' : 'Read-only';

        // A refused call (`denied`) is the boundary working, not crossed: skip it everywhere below.
        const used = run.toolUses.filter((u) => !u.denied);

        const forbidden = [...new Set(used
          .map((u) => u.name)
          .filter((n) => EDIT_TOOLS.has(n) || (!harness && n === 'Bash')))];
        if (forbidden.length > 0) {
          errors.push(`[TOOL-RESTRICT] ${label} agent "${agentType}" used forbidden tool (${forbidden.join(', ')})`);
        }

        // Bash is granted to the harness agent for the review harness only — flag anything else.
        if (harness) {
          for (const cmd of offAllowlistBashCommands(used)) {
            errors.push(`[TOOL-RESTRICT] Agent "${agentType}" ran a Bash command outside the harness allowlist: ${cmd}`);
          }
        }

        for (const target of writesOutsideBk(used, root)) {
          warnings.push(`[TOOL-RESTRICT] ${label} agent "${agentType}" wrote outside bk/: ${target}`);
        }
      }

      // --- 4. Worker preamble violation check ---
      //
      // Was a phrase match ("dispatched an agent", "used the Task tool") over the tool_response
      // text; the transcript says directly whether the agent called a dispatch tool.
      if (agentType !== 'visual-orchestrator' && run.toolUses.some((u) => DISPATCH_TOOLS.has(u.name))) {
        warnings.push(`[PREAMBLE-VIOLATION] Agent "${agentType}" appears to have dispatched sub-agents`);
      }

      // --- 5. Retry tracking (reactive signal) ---
      function trackRetry(success, failureReasons) {
        const retryState = readRetryState();
        const nowMs = Date.now();

        // Prune every key whose evidence has aged out, not just this one. The file is read by
        // users and by `bk doctor`; leaving week-old counters in it is what made a stale entry
        // look like current state in the first place.
        for (const k of Object.keys(retryState)) {
          if (!retryEvidenceIsFresh(retryState[k], nowMs)) delete retryState[k];
        }

        // agent @ workflow id. `@` rather than `:` because the workflow id contains a colon
        // of its own ("bk-debug:crash-fixes-critical"), and an unambiguous separator keeps the
        // key readable in a file users open.
        //
        // No migration for the old `agent:feature` keys: they simply stop matching, and the 2h
        // evidence horizon above prunes them on the next write. Nothing else reads this file —
        // cmd-init.mjs only names the path in its gitignore list.
        if (!retryState[retryKey]) retryState[retryKey] = { count: 0, errors: [] };
        const entry = retryState[retryKey];

        if (!success) {
          entry.count++;
          entry.lastError = new Date(nowMs).toISOString();
          // `errors` was initialized and never written to: every field entry carried a timestamp
          // and an empty array, so nothing recorded WHAT failed. It now holds the most recent
          // rejection reasons, newest last, capped.
          const reasons = Array.isArray(failureReasons) ? failureReasons.filter(Boolean) : [];
          entry.errors = [...(entry.errors || []), ...reasons].slice(-MAX_RECORDED_ERRORS);
        } else {
          entry.count = 0; // Reset on success
          entry.errors = [];
        }

        // Kept across a success too: a failed stop re-reported after a later success must still
        // be recognised as the same run, not counted as a fresh failure.
        if (identity.id) {
          entry.stops = [...(entry.stops || []).filter((id) => id !== identity.id), identity.id]
            .slice(-MAX_RECORDED_STOPS);
        }

        try { fs.writeFileSync(RETRY_STATE_FILE, JSON.stringify(retryState, null, 2)); } catch (e) { /* ignore */ }

        return entry.count;
      }

      // Track retry count per agent + workflow.
      //
      // This used to be gated on `feature && agentType`, and an ad-hoc session — one not driven
      // by a /bk-* skill — has feature null in workflow state. So trackRetry was never called
      // and agent_stuck never fired, which is the signal that tells the conductor to stop
      // retrying a stuck agent and dispatch bk-brainstormer instead: ad-hoc work had no
      // stuck-agent escape at all. Measured on 2026-09-22 with both field repos on 0.10.0:
      // fusionworkomni, which works ad-hoc, has run whole sessions (one with 11 agents) and has
      // no .retry-state.json file whatsoever, while trustcall_ios, which goes through /bk-debug,
      // holds 20 keys. The only difference was whether a feature was set.
      //
      // resolveWorkflowId is the kit's existing answer to "what is this workflow" — the same one
      // subagent-cost-capture, budget-guard and session-init use. Passing the session id is what
      // scopes ad-hoc work to THIS session ("session:<id>") rather than letting two unrelated
      // ad-hoc topics pile into one shared "session:unscoped" bucket and fire a false signal.
      {
        // The key and the label are different concerns. "failed 2x on
        // \"session:488d5917-7d67-...\"" tells the model nothing, so the message names the
        // feature when there is one and says "this session" when there is not.
        const retryLabel = feature ? `"${feature}"` : 'this session';

        const outputValid = errors.length === 0;
        const retryCount = trackRetry(outputValid, errors);
        if (retryCount >= 2) {
          const retrySignal =
            `[REACTIVE-SIGNAL: agent_stuck] (HIGH) "${agentType}" failed ${retryCount}x on ${retryLabel} — ` +
            'Task(bk-brainstormer). Detail: rules/reactive-orchestration.md §3.';
          warnings.push(retrySignal);
        }
      }

      // --- 6. Agent telemetry: stop trace ---
      try {
        const { traceAgent } = require('./lib/agent-telemetry.cjs');
        traceAgent('stop', {
          agent: agentType,
          feature: feature || undefined,
          status: errors.length > 0 ? 'error' : 'ok',
          errors: errors.length,
          warnings: warnings.length
        });
      } catch { /* telemetry is best-effort */ }

      // --- Queue the verdict for the conductor ---
      if (errors.length === 0 && warnings.length === 0) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Five of a kind is enough to act on — a placeholder scan can produce one warning per
      // line, and the tail of that list never changed what the conductor had to do.
      const MAX_ITEMS = 5;
      const listOf = (items) => {
        const shown = items.slice(0, MAX_ITEMS).map((i) => `  - ${i}`);
        if (items.length > shown.length) shown.push(`  - (+${items.length - shown.length} more)`);
        return shown;
      };

      const lines = [];
      if (errors.length > 0) {
        lines.push(`[AGENT-OUTPUT-REJECTED] "${agentType}" — re-dispatch with a corrected prompt:`);
        lines.push(...listOf(errors));
      }
      if (warnings.length > 0) {
        lines.push(`[AGENT-OUTPUT-WARNING] "${agentType}":`);
        lines.push(...listOf(warnings));
      }

      // Not stdout: SubagentStop output lands in the subagent's own transcript and never reaches
      // the conductor (lib/conductor-inbox.cjs). The message is queued for this session and
      // delivered by conductor-inbox-drain on the conductor's next event, where the shared
      // injection budget is applied.
      const { postToConductor } = require('./lib/conductor-inbox.cjs');
      const queued = postToConductor(root, sessionId, { source: 'verify-output', text: lines.join('\n') });

      timer.end({ status: errors.length > 0 ? 'error' : 'warn', queued, exit: 0 });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'verify-output', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'verify-output', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
