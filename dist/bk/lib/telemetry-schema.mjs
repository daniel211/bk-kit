/**
 * telemetry-schema.mjs — What `bk telemetry` may carry out of a project, field by field.
 *
 * This is an allowlist on purpose. Hooks add fields to these logs every few releases, and the
 * logs already hold things nobody meant to share: violations.jsonl keeps a whole source line in
 * `context` for arch-fitness rows, yellow-signals.jsonl keeps `plan_dir`. A field that is not
 * listed here is dropped, so a new hook field stays private until someone classifies it.
 *
 * Field classes (applied by telemetry-sanitizer.mjs):
 *   keep      number, boolean or null; any other type is dropped
 *   ts        epoch number or ISO timestamp
 *   token     short machine word written by the kit; anything else becomes [redacted]
 *   tokens    array of tokens
 *   id        opaque session/agent id; hashed unless it has a known opaque shape
 *   hash      always hashed — tool-argument digests, which a plain digest would not protect
 *   feature   feature name, hashed; `unknown` and empty stay readable
 *   workflow  `bk-code:<feature>` — the skill prefix stays, the feature part is hashed
 *   agent, skill, tool, script   kit and built-in names stay, everything else is hashed
 *   { object }   nested object, its own allowlist; a non-object value is dropped
 *   { arrayOf }  array of nested objects
 */

const CONTEXT = {
  object: {
    model: 'token', resolvedModel: 'token', workflow: 'token', from: 'token', to: 'token',
    allowed: 'tokens', phase: 'token', count: 'keep', cap: 'keep', window_minutes: 'keep',
    lifetime_count: 'keep', old_lines: 'keep', new_lines: 'keep', percent_lost: 'keep',
    feature: 'feature', agent: 'agent', hash: 'hash',
  },
};

const DIAGNOSTICS = {
  object: {
    transcript_bytes: 'keep', assistant_turns: 'keep', last_stop_reason: 'token',
    last_block_type: 'token', last_tool: 'tool',
  },
};

const HOOK_RUN = {
  arrayOf: { script: 'script', status: 'token', exitCode: 'keep', exited: 'keep', durationMs: 'keep' },
};

/** Output file name → where it comes from and what it may contain. */
export const TELEMETRY_FILES = {
  'cost-ledger.jsonl': {
    source: '.bk-metrics/cost-ledger.jsonl',
    fields: {
      ts: 'ts', type: 'token', scope: 'token', workflowId: 'workflow', workflowSubagentUsd: 'keep',
      tokensIn: 'keep', tokensOut: 'keep', costUsd: 'keep', subagentSumUsd: 'keep',
      allWorkflowsSubagentUsd: 'keep', source: 'token', accuracy: 'token', agent: 'agent',
      stableId: 'id', model: 'token', effort: 'token', rawInputTokens: 'keep',
      cacheReadTokens: 'keep', cacheCreationTokens: 'keep', thinkingTokens: 'keep',
      multiplierApplied: 'keep', sessionId: 'id', foreignAgent: 'keep',
    },
  },
  'workflow-summary.jsonl': {
    source: '.bk-metrics/workflow-summary.jsonl',
    fields: {
      ts: 'ts', skill: 'skill', feature: 'feature', phase: 'token', complexity_tier: 'token',
      total_agents: 'keep', total_duration_ms: 'keep', max_agent_duration_ms: 'keep',
      duration_source: 'token', duration_matched: 'keep', duration_total: 'keep', fix_loops: 'keep',
      reactive_signals: 'keep', closed_by: 'token', workflow_id: 'workflow', session_id: 'id',
    },
  },
  'agent-trace.jsonl': {
    source: '.bk-metrics/agent-trace.jsonl',
    fields: {
      ts: 'ts', agent: 'agent', stable_id: 'id', session_id: 'id', skill: 'skill',
      feature: 'feature', status: 'token', signals: 'tokens', complexity_tier: 'token',
      phase: 'token', batch: 'keep', reason: 'token', diagnostics: DIAGNOSTICS,
    },
  },
  'token-burn-window.jsonl': {
    source: '.bk-metrics/token-burn-window.jsonl',
    fields: { timestamp: 'ts', total_tokens: 'keep' },
  },
  'resume-log.jsonl': {
    source: '.bk-metrics/resume-log.jsonl',
    fields: { ts: 'ts', cleared: 'tokens', feature: 'feature' },
  },
  // Only the live file: the rotated .1 is up to 10 MB of the same shape and adds little.
  'hook-dispatch-report.jsonl': {
    source: '.bk-metrics/hook-dispatch-report.jsonl',
    fields: { ts: 'ts', event: 'token', tool: 'tool', durationMs: 'keep', exitCode: 'keep', hooks: HOOK_RUN },
  },
  'hook-log.jsonl': {
    source: '.claude/hooks/.logs/hook-log.jsonl',
    fields: { ts: 'ts', hook: 'token', tool: 'tool', dur: 'keep', status: 'token', exit: 'keep', error: 'token' },
  },
  'hooks-agent-trace.jsonl': {
    source: '.claude/hooks/.logs/agent-trace.jsonl',
    fields: {
      ts: 'ts', event: 'token', agent: 'agent', feature: 'feature', platform: 'token',
      phase: 'token', status: 'token', errors: 'keep', warnings: 'keep',
    },
  },
  'violations.jsonl': {
    source: '.bk-metrics/violations.jsonl',
    fields: {
      ts: 'ts', hook: 'token', violation_type: 'token', severity: 'token', blocked: 'keep',
      tool: 'tool', agent: 'agent', context: CONTEXT,
    },
  },
  'red-signals.jsonl': {
    source: '.bk-metrics/red-signals.jsonl',
    fields: {
      ts: 'ts', type: 'token', platform: 'token', agent: 'agent', count: 'keep', cap: 'keep',
      window_minutes: 'keep', tool: 'tool', hash: 'hash', errors: 'keep', warnings: 'keep',
      durationMs: 'keep', truncated: 'keep', phase: 'token', from: 'token',
    },
  },
  'yellow-signals.jsonl': {
    source: '.bk-metrics/yellow-signals.jsonl',
    fields: {
      ts: 'ts', type: 'token', count: 'keep', errors: 'keep', warnings: 'keep', durationMs: 'keep',
      truncated: 'keep', feature: 'feature', batch: 'keep',
    },
  },
  'subagent-live.jsonl': {
    source: '.bk-metrics/subagent-live.jsonl',
    fields: {
      ts: 'ts', event: 'token', session_id: 'id', subagent_id: 'id', name: 'agent', stable_id: 'id',
      agent_id: 'id', duration_ms: 'keep', tokens_in: 'keep', tokens_out: 'keep', cost_usd: 'keep',
      status: 'token', accuracy: 'token', reaped: 'keep',
    },
  },
};
