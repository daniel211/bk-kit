#!/usr/bin/env node
// subagent-iteration-cap.cjs - PreToolUse Task hook.
// Blocks a conductor that is looping on one agent for one feature.
//
// The unit being capped is a loop *iteration*, not a dispatch, and it is counted inside a
// sliding window (`window_minutes`) rather than for the lifetime of the project. Concurrent
// fan-out of the same agent for the same feature (`batch_coalesce_ms`) is one iteration.
// Iterations are further scoped to a progress signature (`progress_scoped`), so only tries
// that committed nothing and completed no batch accumulate against the cap.
// Orchestration agents (`exempt_agents`) are not capped at all — they are dispatched once
// per commit or per doc, which a loop cap has nothing useful to say about.
//
// Fail-open on crash.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const { loadHarnessPolicy, trackRedSignal, trackViolation } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled, readWorkflowState, writeWorkflowState } = require('./lib/bk-config-utils.cjs');
  const { AGENT_DISPATCH_TOOLS } = require('./lib/hook-event-accessor.cjs');

  /**
   * Parse override env: BK_HARNESS_DISPATCH_OVERRIDE=agentType=N
   * Returns the override cap for an agent type, or null if not set.
   */
  function parseOverrideCap(agentType) {
    const envVal = process.env.BK_HARNESS_DISPATCH_OVERRIDE;
    if (!envVal) return null;
    // Format: "agentType=N" or "agentType=+N"
    const parts = envVal.split(',');
    for (const part of parts) {
      const match = part.trim().match(/^(.+?)=\+?(\d+)$/);
      if (match && match[1] === agentType) {
        return parseInt(match[2], 10);
      }
    }
    return null;
  }

  /**
   * Extract subagent type from Task tool input.
   *
   * The name pattern is matched against `description` only, never the prompt. A dispatch
   * prompt routinely mentions other agents ("as bk-code-reviewer noted"), and scanning it
   * would charge the dispatch to whichever agent happened to be named first.
   *
   * Both shipped agent prefixes are recognised. `bk-` alone predates the `design-*` agents
   * (design-agy-extractor, design-spec-writer, design-asset-exporter, design-validator)
   * shipping in the kit, so a description-only dispatch of one of those extracted nothing,
   * returned null, and ran completely uncapped — the opposite failure from a cap that is too
   * low, and an invisible one, because an unattributed dispatch is never recorded either.
   */
  function extractAgentType(toolInput) {
    if (!toolInput) return null;
    if (toolInput.subagent_type) return toolInput.subagent_type;
    const text = toolInput.description || '';
    if (!text) return null;
    const match = text.match(/\b((?:bk|design)-[a-z][a-z0-9-]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Which feature this dispatch belongs to.
   *
   * The cap is meant to catch a conductor looping on ONE feature, so the count has to be
   * scoped to one. `state.feature` cannot carry that alone: it exists in the state file but
   * nothing ever writes a value into it, so every dispatch a project ever made shared a
   * single bucket and the counter became a ratchet — agents hit their cap permanently,
   * across features and across sessions, and the block claimed a feature scope it did not
   * have.
   *
   * The identity is in the dispatch itself. Every workflow addresses a feature by path —
   * `bk/dev/{feature-slug}/...` — so the prompt names it even when the state file does not.
   *
   * @param {object} toolInput
   * @param {object} state
   * @returns {string} a feature key; 'unscoped' when nothing identifies one
   */
  function extractFeatureKey(toolInput, state) {
    const text = `${toolInput.prompt || ''}\n${toolInput.description || ''}`;
    // `shared` is the cross-feature scratch directory, not a feature.
    const match = text.match(/\bbk\/(?:dev|specs)\/(?!shared\b)([a-z0-9][a-z0-9._-]*)\//i);
    if (match) return match[1];
    if (state && typeof state.feature === 'string' && state.feature) return state.feature;
    return 'unscoped';
  }

  /**
   * Read counts for one feature, migrating the old flat shape.
   *
   * The previous shape was `{ [agent]: n }` with no feature dimension. Those numbers cannot
   * be attributed to a feature after the fact, and carrying them forward would preserve
   * exactly the ratchet this change exists to remove — a project would stay blocked on a
   * count it accumulated weeks ago. They are dropped; `agent_dispatch_history` keeps the
   * timestamped record.
   *
   * @param {object} state
   * @param {string} featureKey
   * @returns {{counts: object, all: object}}
   */
  function readCounts(state, featureKey) {
    const raw = state.agent_dispatch_count || {};
    const isLegacy = Object.values(raw).some((v) => typeof v === 'number');
    const all = isLegacy ? {} : raw;
    return { counts: { ...(all[featureKey] || {}) }, all };
  }

  /**
   * What "no progress since" means, as a single comparable string.
   *
   * Time alone cannot tell a retry from a step forward. The field measurement is
   * unambiguous: a fan-out wave is 2-15 s apart and legitimate batch-to-batch progression is
   * 80 s to 8 min, so the two distributions touch and no threshold separates them — the
   * shipped 5 s coalesce missed real waves, and raising it far enough to cover a wave starts
   * swallowing genuine retries. Progress is the thing that actually differs: a conductor that
   * moved on has committed something, or finished a batch, or advanced the batch number; a
   * conductor stuck in a loop has done none of the three.
   *
   * `current_phase` is deliberately NOT part of this. A coding↔review ping-pong changes the
   * phase on every lap while producing nothing, and that is exactly the loop the cap must
   * still catch — including it would hand such a loop a fresh budget every lap.
   *
   * @param {object} state
   * @returns {string}
   */
  function progressSignature(state) {
    const s = state || {};
    const commit = s.last_commit_hash || '-';
    const done = Array.isArray(s.completed_batches) ? s.completed_batches.length : 0;
    const batch = s.batch ?? '-';
    return `${commit}|${done}|${batch}`;
  }

  /**
   * How much dispatch history to keep.
   *
   * The block decision is now a windowed count read out of `agent_dispatch_history`, so the
   * tail has to be long enough to hold a whole window — the old `slice(-50)` was not. One
   * iteration of a fan-out is 5-8 concurrent dispatches, and a busy conductor sustains
   * roughly one iteration a minute across several agents; at 60 default minutes that is a
   * few hundred entries. 400 covers it with room to spare while keeping the state file
   * small (an entry is ~60 bytes, so ~24KB worst case).
   *
   * Age is the primary prune and the entry count is the backstop: pruning by age alone
   * cannot bound the array if a session dispatches pathologically fast, and pruning by count
   * alone silently shortens the window under fan-out — which is the bug being fixed.
   */
  const HISTORY_MAX_ENTRIES = 400;

  /** Never keep less than a day of tail, so the audit view stays useful on quiet projects. */
  const HISTORY_MIN_RETENTION_MS = 24 * 60 * 60 * 1000;

  /**
   * Drop history that can no longer affect any decision, then bound the array.
   *
   * Retention is at least the configured window — pruning inside the window would make the
   * count decay early and let a real loop through.
   */
  function pruneHistory(history, windowMs, now) {
    const retentionMs = Math.max(HISTORY_MIN_RETENTION_MS, windowMs);
    const cutoff = now - retentionMs;
    return history
      .filter((h) => h && typeof h.ts === 'number' && h.ts >= cutoff)
      .slice(-HISTORY_MAX_ENTRIES);
  }

  /**
   * How many *iterations* this agent has spent on this feature inside the window.
   *
   * Two things separate this from the raw dispatch count:
   *
   * 1. It is windowed. The lifetime counter could not tell a conductor looping from a
   *    feature that is simply large: a 15-screen feature exhausts `default_cap: 3` honestly
   *    and was then blocked forever, with `--reset-counts` the only way out. A loop is a
   *    burst in time, so the count has to decay with time.
   * 2. It coalesces fan-out. The cap is meant to count loop iterations, but it counted
   *    dispatches — so dispatching 5 developers concurrently for one feature, the exact
   *    multi-agent behaviour this kit exists to encourage, burned a cap of 3 instantly.
   *    Dispatches of the same agent+feature closer together than `batch_coalesce_ms` are one
   *    logical iteration.
   *
   * Grouping chains off the previous entry rather than off the group's start, so a fan-out
   * that trickles out over more than one coalesce span still collapses. The cost is that an
   * unbroken stream spaced under the threshold stays one iteration; that is not a shape a
   * real loop takes, because each dispatch has to wait for a subagent to finish.
   *
   * The dispatch being decided is counted too — callers append it to `history` before calling
   * this. It has to be, and it has to be done for every member of a fan-out wave alike:
   * `history` is read before the write, so the FIRST dispatch of a wave saw only the previous
   * waves while its siblings, arriving milliseconds later, already saw its row and counted one
   * iteration more. The cap then tripped part-way through a wave — the field's
   * `design-agy-extractor` got wave 1, wave 2, and exactly one dispatch of wave 3 before
   * `subagent_cap_exceeded` fired on the rest of wave 3. Counting the current dispatch makes
   * every member of a wave see the same number, and the decision below is `>` rather than
   * `>=` to match: a cap of N permits N iterations and blocks the N+1th.
   *
   * 3. It is scoped to the current progress signature. Windowing and coalescing still could
   *    not tell "retried the same batch three times" from "worked through three batches" —
   *    the field's bk-flutter-developer was denied its 4th dispatch while the state file
   *    showed batch 2 of 4, a growing `completed_batches` and a changing `last_commit_hash`
   *    between every one of them. Only rows carrying the CURRENT signature count, so a
   *    conductor that commits or completes a batch starts the next one with a fresh budget.
   *
   *    This is safe because a genuine retry loop produces no progress by definition: its
   *    signature never changes, every one of its rows keeps counting, and the tally still
   *    climbs to the cap exactly as before. The oscillation shapes that do change something
   *    trivially between laps are covered by the other deadloop hooks —
   *    tool-repetition-detector, no-progress-detector and phase-recurrence.
   *
   *    Rows with no `sig` key at all were written by an earlier kit version and are ignored
   *    rather than treated as matching. Their progress context cannot be reconstructed after
   *    the fact, so counting them would block an upgrade on a signature they never had. This
   *    is the same one-time upgrade amnesty `readCounts` above already applies to the legacy
   *    flat count shape.
   *
   * @param {Array<{ts:number, agent:string, feature:string, sig?:string}>} history
   * @param {string} agentType
   * @param {string} featureKey
   * @param {number} windowMs  0 = lifetime (no cutoff)
   * @param {number} coalesceMs
   * @param {number} now
   * @param {string|null} sig  current progress signature; null disables progress scoping
   * @returns {number}
   */
  function countWindowedIterations(history, agentType, featureKey, windowMs, coalesceMs, now, sig) {
    const cutoff = windowMs > 0 ? now - windowMs : 0;
    const stamps = (history || [])
      .filter((h) =>
        h && typeof h.ts === 'number' && h.ts >= cutoff &&
        h.agent === agentType && (h.feature || 'unscoped') === featureKey &&
        (sig === null || h.sig === sig))
      .map((h) => h.ts)
      .sort((a, b) => a - b);

    if (stamps.length === 0) return 0;

    let iterations = 1;
    for (let i = 1; i < stamps.length; i++) {
      if (stamps[i] - stamps[i - 1] > coalesceMs) iterations++;
    }
    return iterations;
  }

  async function main() {
    // Read stdin via stream
    let raw = '';
    try {
      for await (const chunk of process.stdin) raw += chunk;
    } catch { process.exit(0); }

    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

    if (!isHookEnabled('subagent-iteration-cap')) process.exit(0);

    const policy = loadHarnessPolicy();
    const cfg = policy.deadloop.subagent_iteration;
    if (!cfg.enabled) process.exit(0);

    const toolName = input.tool_name || '';

    // Only handle Task tool
    if (!AGENT_DISPATCH_TOOLS.includes(toolName)) process.exit(0);

    const toolInput = input.tool_input || {};
    const agentType = extractAgentType(toolInput);

    if (!agentType) {
      // Can't determine agent type — pass through
      process.exit(0);
    }

    const state = readWorkflowState() || {};
    const featureKey = extractFeatureKey(toolInput, state);
    const { counts } = readCounts(state, featureKey);
    const lifetimeCount = counts[agentType] || 0;

    const now = Date.now();
    const windowMinutes = Number.isInteger(cfg.window_minutes) ? cfg.window_minutes : 60;
    const windowMs = Math.max(0, windowMinutes) * 60 * 1000;
    // 30s, not the 5s this shipped with: the field's fan-out waves span up to ~15 s between
    // members, so 5 s split a single wave into several "iterations" and burned the cap on one
    // batch. Progress scoping below is what keeps the wider span from hiding a real loop.
    const coalesceMs = Number.isInteger(cfg.batch_coalesce_ms) ? cfg.batch_coalesce_ms : 30000;

    // Default on when the policy is silent, so an existing project gets the fix without
    // editing its policy file. `window_minutes: 0` (legacy lifetime mode) ignores it, the
    // same way it ignores windowing and coalescing.
    const progressScoped = cfg.progress_scoped !== false;
    const currentSig = progressSignature(state);

    // `window_minutes: 0` is the legacy escape hatch: no window, no coalescing, decide on
    // the lifetime counter exactly as this hook always did. Everything else decides on the
    // windowed iteration count.
    //
    // The two numbers deliberately disagree from here on. `agent_dispatch_count` stays a
    // monotonic lifetime tally because the dashboard and `bk-health --reset-counts` read it
    // and it is the honest answer to "how much work went into this feature". The *block*
    // decision cannot use it — a tally that only grows is a ratchet, and it was blocking
    // long legitimate features permanently in the field.
    //
    // Either way the number INCLUDES the dispatch being decided — `lifetimeCount + 1` is what
    // the tally will read once this dispatch is written, and the windowed count is taken over
    // the history with this dispatch appended. The cap is then a limit on iterations that
    // actually happen, so `>` below lets the Nth through and blocks the N+1th.
    const currentCount = windowMs === 0
      ? lifetimeCount + 1
      : countWindowedIterations(
        [
          ...(state.agent_dispatch_history || []),
          { ts: now, agent: agentType, feature: featureKey, sig: currentSig }
        ],
        agentType, featureKey, windowMs, coalesceMs, now,
        progressScoped ? currentSig : null);

    // Determine cap
    const perAgentCaps = cfg.per_agent_caps || {};
    const defaultCap = cfg.default_cap || 3;
    const policyCap = perAgentCaps[agentType] !== undefined ? perAgentCaps[agentType] : defaultCap;

    // Check override env
    const overrideCap = parseOverrideCap(agentType);
    const effectiveCap = overrideCap !== null ? overrideCap : policyCap;

    // Orchestration agents (git manager, project manager, docs writer) are not implementers:
    // they are dispatched once per commit, per status update, per doc. Capping them at the
    // implementer default meant a feature was allowed 3 commits total, ever — 6 of the 8
    // field blocks were exactly this. They skip the cap but are still recorded below, because
    // the history is the audit trail and observability must not regress.
    const exemptAgents = Array.isArray(cfg.exempt_agents) ? cfg.exempt_agents : [];
    const isExempt = exemptAgents.includes(agentType);

    // `>`, not `>=`: `currentCount` already counts this dispatch, so a cap of N permits N
    // iterations and blocks the N+1th, which is what the policy number says it does.
    if (!isExempt && currentCount > effectiveCap) {
      // BLOCK
      const history = (state.agent_dispatch_history || []).slice(-10);
      const histTable = history.map(h =>
        `  ${new Date(h.ts).toISOString()} ${h.agent}${h.feature ? ` (${h.feature})` : ''}`
      ).join('\n');

      const scopeNote = featureKey === 'unscoped'
        ? `No feature could be identified from this dispatch, so the count is shared by every\n` +
          `dispatch that also names none. If that is the whole story here, the count may not\n` +
          `reflect a real loop — check the history below before decomposing anything.\n\n`
        : '';

      // The count is windowed and fan-out-coalesced, so the message has to say so — "3
      // dispatches" and "3 iterations in the last hour" call for very different responses.
      // `currentCount` counts this dispatch, which is being denied — so the message says
      // "would be", not "was". Reporting it as work already done sends the reader looking
      // for a dispatch that never ran.
      const windowNote = windowMs === 0
        ? `would be dispatch ${currentCount} (lifetime count — window_minutes is 0)`
        : `would be iteration ${currentCount} in the last ${windowMinutes} min ` +
          `(parallel fan-out within ${coalesceMs}ms counts as one)`;

      // Without this the number reads as "N units of work", and a conductor part-way through
      // a multi-batch plan concludes the cap is wrong. Scoped to the signature, the count
      // says something much narrower and much more actionable.
      const progressNote = (windowMs !== 0 && progressScoped)
        ? `\nThe count is scoped to the current progress signature ` +
          `(commit|completed_batches|batch = ${currentSig}): these are ${currentCount} tries ` +
          `with nothing committed, no batch completed and no batch advanced in between — ` +
          `not ${currentCount} units of work. Committing or finishing a batch starts a fresh ` +
          `budget.\n`
        : '';

      const reason =
        `AGENT DISPATCH CAP EXCEEDED — "${agentType}" ${windowNote} ` +
        `for feature "${featureKey}".\n` +
        `Limit (policy): ${effectiveCap}\n` +
        progressNote + `\n` +
        scopeNote +
        `Nếu đây thực sự là vòng lặp, nguyên nhân thường là:\n` +
        `1. Conductor đang retry mù thay vì escalate\n` +
        `2. Approach hiện tại không thể giải, cần breakthrough\n` +
        `3. Feature quá lớn, cần decompose\n\n` +
        `HÀNH ĐỘNG:\n` +
        `- KHÔNG retry cùng agent.\n` +
        `- AskUserQuestion với options:\n` +
        `  • "Decompose feature and restart" — break into sub-features\n` +
        `  • "Escalate to human review" — stop, ask specific question\n` +
        `  • "Reset the count" — RARELY the right answer now: the count decays on its own, ` +
        `so waiting out the window clears it. Only reset when the history below is stale ` +
        `noise. This clears BOTH the tally and the matching history rows, so it does unblock: ` +
        `node .claude/cli/bk-health/index.cjs --reset-counts --agent ${agentType} ` +
        `--force\n` +
        `  • "Override cap (+5 dispatches)" — set ` +
        `BK_HARNESS_DISPATCH_OVERRIDE=${agentType}=${currentCount + 5}. This only takes ` +
        `effect in a NEW session: hooks inherit the environment of the CLI process that is ` +
        `already running, so exporting it here changes nothing until that process restarts.\n\n` +
        `Dispatch history (last 10, all features):\n${histTable || '  (none)'}`;

      process.stderr.write(`[subagent-iteration-cap] BLOCK: ${agentType} at count=${currentCount} (cap=${effectiveCap})\n`);

      trackRedSignal('subagent_cap_exceeded', {
        agent: agentType, count: currentCount, cap: effectiveCap, window_minutes: windowMinutes
      });
      trackViolation({
        hook: 'subagent-iteration-cap',
        violation_type: 'subagent_cap_exceeded',
        tool: toolName,
        agent: agentType,
        blocked: true,
        severity: 'red',
        context: {
          count: currentCount,
          cap: effectiveCap,
          window_minutes: windowMinutes,
          lifetime_count: lifetimeCount,
          feature: featureKey
        }
      });

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason
        }
      }) + '\n');
      process.exit(2);
    }

    // Under cap (or exempt) — increment this feature's count and append to history, both
    // derived from the state read under the write lock. Parallel dispatches of the same agent
    // reach this hook together; counting from `state` read above lets them all write "n + 1"
    // and the cap then never trips. Coalescing does not change that: it happens at
    // read/decide time above, the write below stays one row per dispatch, under the lock.
    try {
      writeWorkflowState((fresh) => {
        // readCounts, not fresh.agent_dispatch_count directly — the legacy flat shape has to
        // be migrated here too, or a write would resurrect the counts it drops.
        const { counts: freshCounts, all: freshAll } = readCounts(fresh, featureKey);
        freshCounts[agentType] = (freshCounts[agentType] || 0) + 1;
        // Every dispatch is recorded individually even when it coalesces into an existing
        // iteration — coalescing is a read/decide-time grouping, never a suppressed write.
        // Collapsing writes would hide real fan-out from the dashboard and the audit trail.
        // The signature is taken from `fresh`, not from the pre-read copy: a commit or a
        // batch completion can land between the read above and this write, and stamping the
        // stale signature would file this dispatch under progress it no longer belongs to.
        const freshSig = progressSignature(fresh);
        const freshHistory = pruneHistory([
          ...(fresh.agent_dispatch_history || []),
          { ts: now, agent: agentType, feature: featureKey, sig: freshSig }
        ], windowMs, now);
        return {
          agent_dispatch_count: { ...freshAll, [featureKey]: freshCounts },
          agent_dispatch_history: freshHistory,
          // Other hooks read state.feature and have only ever seen null. Record what this
          // dispatch identified so they stop guessing too.
          ...(featureKey !== 'unscoped' ? { feature: featureKey } : {})
        };
      });
    } catch { /* fail-open */ }

    process.exit(0);
  }

  main().catch(() => process.exit(0));
} catch (e) {
  try {
    process.stderr.write(`[subagent-iteration-cap] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
