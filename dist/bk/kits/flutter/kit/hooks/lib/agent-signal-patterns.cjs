/**
 * agent-signal-patterns.cjs — the reactive-signal vocabulary, in one place.
 *
 * These patterns used to live inside agent-signal-detector.cjs, which is a PostToolUse(Task)
 * hook. That made them unreachable from SubagentStop, and SubagentStop is where the status of
 * a finished agent gets recorded. The consequence was measured in both field repos: every one
 * of the 42 rows in .bk-metrics/agent-trace.jsonl read `status: "unknown"`, because
 * workflow-metrics read `data.status` and the captured SubagentStop payload shape
 * (.bk-metrics/subagent-stop-payload-keys.json, observed independently in trustcall_ios and
 * fusionworkomni) carries no `status` key at all — its keys are agent_id,
 * agent_transcript_path, agent_type, background_tasks, cwd, effort, hook_event_name,
 * last_assistant_message, permission_mode, prompt_id, scratchpad_dir, session_crons,
 * session_id, stop_hook_active, transcript_path.
 *
 * Extracting the vocabulary lets workflow-metrics classify `last_assistant_message` with the
 * exact same rules the detector applies to a Task result, so `status` and `fix_loops` become
 * measurements instead of structural zeros.
 */

'use strict';

/** Agents can emit `[SIGNAL: type]` for explicit, unambiguous detection. */
const STRUCTURED_SIGNAL = /\[SIGNAL:\s*(\w+)\]/i;

/**
 * Every signal name the kit recognises. A structured `[SIGNAL: x]` naming anything else is
 * ignored — the detector checks the same set by way of its RECOMMENDATIONS map, so the two
 * paths accept exactly the same vocabulary.
 */
const KNOWN_SIGNALS = [
  'agent_stuck',
  'fix_loop_stuck',
  'unknown_api',
  'confidence_low',
  'conflicting_results',
  'architecture_concern',
  'performance_issue',
];

/**
 * Conservative (default) — multi-word/contextual phrases only.
 *
 * Tightened in P2-2: broad single-word regexes (e.g. /stuck/, /ambiguous/) had a high
 * false-positive rate and drowned out real signals in additionalContext.
 */
const CONSERVATIVE_SIGNAL_PATTERNS = [
  { pattern: /unable to (resolve|fix|complete|implement) (the|this|that)/i, signal: 'agent_stuck', priority: 'HIGH' },
  { pattern: /(cannot|can't) (determine|identify|find) (the|a|any)/i, signal: 'agent_stuck', priority: 'HIGH' },
  { pattern: /no clear path (forward|to proceed)/i, signal: 'agent_stuck', priority: 'HIGH' },
  { pattern: /beyond (my|the) (scope|capability|expertise)/i, signal: 'agent_stuck', priority: 'HIGH' },
  // fix_loop_stuck: error repeating
  { pattern: /same (error|issue|problem) (again|persists|remains|still)/i, signal: 'fix_loop_stuck', priority: 'HIGH' },
  { pattern: /error (persists|not resolved|still occurring|keeps happening)/i, signal: 'fix_loop_stuck', priority: 'HIGH' },
  // unknown_api
  { pattern: /unknown (API|framework|method|class|module|package)/i, signal: 'unknown_api', priority: 'HIGH' },
  // confidence_low — explicit declarations only
  { pattern: /confidence:\s*(low|\d{1,4}[0-6]\d?%)/i, signal: 'confidence_low', priority: 'HIGH' },
  { pattern: /need(s)? (more|additional) (context|information|clarification) to/i, signal: 'confidence_low', priority: 'HIGH' },
  // conflicting_results — explicit "X and Y disagree" framing
  { pattern: /(conflicting|contradicting) (results|findings|recommendations)/i, signal: 'conflicting_results', priority: 'MEDIUM' },
  // architecture_concern
  { pattern: /architecture (violation|concern|mismatch)/i, signal: 'architecture_concern', priority: 'MEDIUM' },
  // performance_issue
  { pattern: /performance (critical|severe|bottleneck|blocking main)/i, signal: 'performance_issue', priority: 'MEDIUM' },
];

/** Aggressive (legacy) — opt-in via BK_SIGNAL_DETECTOR_BROAD=1. */
const BROAD_SIGNAL_PATTERNS = [
  { pattern: /cannot determine|unable to identify|unclear root cause/i, signal: 'agent_stuck', priority: 'HIGH' },
  { pattern: /stuck|blocked|deadlocked|no progress/i, signal: 'agent_stuck', priority: 'HIGH' },
  { pattern: /not (fully )?confident|uncertain about|ambiguous/i, signal: 'confidence_low', priority: 'HIGH' },
  { pattern: /tried (multiple|several|different) approaches/i, signal: 'agent_stuck', priority: 'HIGH' },
];

/**
 * @param {boolean} broad — true selects the legacy aggressive list.
 */
function signalPatternsFor(broad) {
  return broad ? BROAD_SIGNAL_PATTERNS : CONSERVATIVE_SIGNAL_PATTERNS;
}

/**
 * Classify a block of agent text into deduped signal names, HIGH before MEDIUM, structured
 * markers first.
 *
 * Defaults to the conservative list even when BK_SIGNAL_DETECTOR_BROAD is set: that env var
 * tunes how loudly the detector injects advice into a live turn, and a recorded metric must
 * not change shape because somebody turned the advice up. Pass `{ broad: true }` to opt in.
 *
 * @param {string} text
 * @param {{ broad?: boolean }} [options]
 * @returns {string[]} signal names in priority order, no duplicates
 */
function classifyAgentOutput(text, options = {}) {
  if (!text || typeof text !== 'string') return [];

  const hits = [];

  // 1. Structured markers are always trusted, and come first.
  const structRegex = new RegExp(STRUCTURED_SIGNAL.source, 'gi');
  let m;
  while ((m = structRegex.exec(text)) !== null) {
    const name = String(m[1]).toLowerCase();
    if (KNOWN_SIGNALS.includes(name)) hits.push({ signal: name, priority: 'HIGH' });
  }

  // 2. Regex fallback.
  for (const { pattern, signal, priority } of signalPatternsFor(options.broad === true)) {
    if (pattern.test(text)) hits.push({ signal, priority });
  }

  const unique = [...new Map(hits.map((h) => [h.signal, h])).values()];
  unique.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'HIGH' ? -1 : 1));
  return unique.map((h) => h.signal);
}

module.exports = {
  STRUCTURED_SIGNAL,
  KNOWN_SIGNALS,
  CONSERVATIVE_SIGNAL_PATTERNS,
  BROAD_SIGNAL_PATTERNS,
  signalPatternsFor,
  classifyAgentOutput,
};
