/**
 * handoff-writer.cjs — PreCompact hook: writes structured handoff doc for complex/architectural tier.
 *
 * Triggers: PreCompact event.
 * Scope: complexity_tier in [complex, architectural] only.
 * Output: bk/dev/shared/handoff/handoff-YYYYMMDD-HHMMSS.md (keeps latest 3).
 * Fail-open: any error → exit 0 silently.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readWorkflowState, isHookEnabled } = require('./lib/bk-config-utils.cjs');
const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

const COMPLEX_TIERS = new Set(['complex', 'architectural', 'Complex', 'Architectural']);
const MAX_HANDOFFS = 3;

/** Format Date as YYYYMMDD-HHMMSS */
function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Build handoff markdown from workflow state */
function buildHandoff(state) {
  const workflowId = state.workflowId || state.workflow_id || 'unknown';
  const phase = state.phase || 'unknown';
  const batch = state.batch || state.batchProgress || 'unknown';
  const tier = state.complexity_tier || 'complex';
  const completedTasks = Array.isArray(state.completedTasks) ? state.completedTasks : [];
  const remainingTasks = Array.isArray(state.remainingTasks) ? state.remainingTasks : [];
  const decisions = Array.isArray(state.decisions) ? state.decisions : [];
  const fileStatus = state.fileStatus || state.file_status || {};
  const mission = state.mission || state.description || `Continue ${workflowId} workflow.`;

  const completedList = completedTasks.length
    ? completedTasks.map(t => `- [x] ${t}`).join('\n')
    : '- (none recorded)';

  const remainingList = remainingTasks.length
    ? remainingTasks.map(t => `- [ ] ${t}`).join('\n')
    : '- (check plan file for remaining tasks)';

  const decisionList = decisions.length
    ? decisions.map(d => `- ${d}`).join('\n')
    : '- (no explicit decisions recorded)';

  const fileLines = Object.keys(fileStatus).length
    ? Object.entries(fileStatus).map(([f, s]) => `- \`${f}\`: ${s}`).join('\n')
    : '- (no file status recorded)';

  return `# Handoff — ${workflowId}

## Mission
${mission}

## State
- Phase: ${phase}
- Batch: ${batch}
- Complexity tier: ${tier}
- Updated at: ${state.updated_at || new Date().toISOString()}

## Completed
${completedList}

## Remaining
${remainingList}

## Decisions (WHY)
${decisionList}

## File status
${fileLines}

## Next agent instructions
1. Read this handoff doc first.
2. Read \`bk/dev/shared/.workflow-state.json\` for full state.
3. Continue from the **Remaining** tasks above.
4. Maintain the same complexity tier: **${tier}**.
5. Do NOT restart completed tasks.
`;
}

/** Prune handoff directory to keep only latest N files */
function pruneHandoffs(dir) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('handoff-') && f.endsWith('.md'))
      .sort();
    while (files.length > MAX_HANDOFFS) {
      fs.unlinkSync(path.join(dir, files.shift()));
    }
  } catch { /* fail silently */ }
}

async function main() {
  try {
    if (!isHookEnabled('handoff-writer')) process.exit(0);

    const state = readWorkflowState();
    if (!state) process.exit(0);

    const tier = state.complexity_tier;
    if (!tier || !COMPLEX_TIERS.has(tier)) process.exit(0);

    const root = resolveProjectRoot();
    const handoffDir = path.join(root, 'bk', 'dev', 'shared', 'handoff');
    fs.mkdirSync(handoffDir, { recursive: true });

    const ts = formatTimestamp(new Date());
    const filename = `handoff-${ts}.md`;
    const filePath = path.join(handoffDir, filename);

    const content = buildHandoff(state);
    fs.writeFileSync(filePath, content);

    pruneHandoffs(handoffDir);
  } catch {
    // Fail-open
  }
  process.exit(0);
}

main();
