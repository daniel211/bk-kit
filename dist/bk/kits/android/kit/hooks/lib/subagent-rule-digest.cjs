'use strict';
/**
 * subagent-rule-digest.cjs — The part of the kit's always-on rules a kit subagent needs,
 * delivered by subagent-init at SubagentStart instead of by CLAUDE.md + `.claude/rules/`.
 *
 * Why this exists (field measurement, X-Game-Pro, kit 0.12.x, 6 sessions, 193 subagent runs):
 * every subagent transcript carried the same `instructions` attachment — the kit's CLAUDE.md,
 * the 15 always-on rules and the user's MEMORY.md, ~58k chars / ~14.5k tokens — re-read from
 * cache on each of ~3,770 subagent requests (~55M of 324M subagent cache-read tokens). ~10.5k
 * tokens of it are conductor procedure a subagent never acts on (dispatch labeling, approval
 * gates, task scheduling, reactive routing...).
 *
 * Every kit agent now sets `omitClaudeMd: true` (Claude Code >= 2.1.271, verified in a sandbox
 * probe against the subagent transcripts): the subagent then loads NONE of CLAUDE.md, its
 * @imports or the always-on rules. Path-scoped rules still load when it Reads a matching file.
 * The main session is unaffected and keeps every rule always-on.
 *
 * What a subagent actually relied on is summarised below, per role, and points at the rule
 * file for details — a digest, not a copy. RULE_DECISIONS records the per-rule call so a new
 * always-on rule cannot slip in without one (__tests__/subagent-rule-digest.test.mjs).
 *
 * Also lost with omitClaudeMd: the user's ~/.claude/CLAUDE.md, the project-root CLAUDE.md /
 * CLAUDE.local.md and the auto-memory index. subagent-init hands those back, bounded, through
 * lib/subagent-user-context.cjs — kept out of this module so the digest stays a static,
 * budgetable size (scripts/build/token-budget-rules-and-digest.mjs requires this module).
 *
 * Opt-out: `.bk.json` `subagents.fullContext: true` makes `bk init/update` install kit agents
 * WITHOUT the flag (the flag is frontmatter; nothing a hook does can change what Claude Code
 * loads). Such a kit agent loads everything natively and still gets this digest, under a
 * header that says so — see agentContextMode.
 */

const fs = require('fs');
const path = require('path');

/**
 * Per always-on rule: 'digest' = its subagent-facing part is summarised here;
 * 'conductor' = main-session procedure only, nothing a subagent acts on.
 * Keys are rule names as shipped in `.claude/rules/` (platform rules share one key).
 */
const RULE_DECISIONS = {
  'core-rules': 'digest', // §5 behavioural rules (do what was asked, read before edit); rest is routing
  'development-rules': 'digest', // code standards, no test-dodging, file handling, plan compliance
  'coding-intelligence-priority': 'digest', // Serena → LSP → Grep → Read lookup order
  'mobile-shared-rules': 'digest', // architecture/API/security/UI-state standards for code agents (ios/android/flutter kits)
  'backend-shared-rules': 'digest', // layering/API contract/migrations/security for code agents (python kit)
  'web-shared-rules': 'digest', // layering/server state/XSS-CSP/UI states for code agents (web kit)
  'platform-rules': 'digest', // {platform}-rules.md: essentials + pointer
  'team-rules': 'digest', // Output:/Files: contract and [SIGNAL: x] markers; rest is conductor/bk-team lead
  'user-interaction-protocol': 'digest', // §5 confidence in output metadata; rest is AskUserQuestion policy
  'approval-rules': 'conductor', // gates + thresholds; each reviewer carries its own severity line
  'conductor-role': 'conductor', // delegation table, required dispatches, tiers
  'conductor-brief': 'conductor', // condensed copy of the conductor rules
  'reactive-orchestration': 'conductor', // conductor's response to signals (agents only emit them)
  'dispatch-labeling': 'conductor', // Task() description/model labelling
  'task-scheduling': 'conductor', // dispatch timeouts
  'metrics-collection': 'conductor', // conductor writes metrics files
  'context-reset-rules': 'conductor', // main-session /clear + handoff protocol
  'skill-chain': 'conductor' // next-skill suggestions at workflow end
};

/** Role per kit agent. Unlisted kit agents (user-made from _template.md) get 'review'. */
const AGENT_ROLES = {
  'bk-ios-developer': 'implement',
  'bk-android-developer': 'implement',
  'bk-flutter-developer': 'implement',
  'bk-python-developer': 'implement',
  'bk-web-developer': 'implement',
  'bk-code-simplifier': 'implement',
  'bk-unit-test-agent': 'implement',
  'bk-device-test-agent': 'implement',
  'bk-debugger': 'implement',
  'bk-code-reviewer': 'review',
  'bk-gemini-reviewer': 'review',
  'bk-security-auditor': 'review',
  'bk-performance-analyzer': 'review',
  'bk-test-architect': 'review',
  'bk-planner': 'review',
  'bk-brainstormer': 'review',
  'bk-researcher': 'ops',
  'bk-git-manager': 'ops',
  'bk-docs-writer': 'ops',
  'bk-project-manager': 'ops',
  'design-validator': 'ops',
  'design-spec-writer': 'ops',
  'design-asset-exporter': 'ops',
  'design-agy-extractor': 'ops'
};

/** Platform essentials — the lines of {platform}-rules.md an agent most often gets wrong. */
const PLATFORM_ESSENTIALS = {
  ios: 'Swift, SwiftUI for new screens (no SwiftUI+UIKit mix in one screen), async/await + @MainActor, SPM; file named after its primary type',
  android: 'Kotlin only, Compose + Material 3 for new screens, Coroutines/Flow + StateFlow (no new LiveData), version catalog; file named after its primary class',
  flutter: 'Dart, snake_case files, one state-management approach per project, const constructors, widgets > 50 lines extracted',
  python: 'Python 3.11+, type hints everywhere (mypy clean), snake_case modules, router → service → repository, Pydantic v2 schemas at the boundary, async SQLAlchemy 2 + Alembic, settings from env; ruff + pytest',
  web: 'TypeScript strict (no `any`), React function components + hooks, kebab-case files (match the project if it uses PascalCase.tsx), server state in TanStack Query, forms with zod, accessible markup; tsc --noEmit + eslint + vitest'
};

/**
 * The shared rule file each kit ships, and its one-line digest. A kit ships exactly one of these
 * (bk-manifest.json scopes each to its platforms), so the digest names only the file the agent's
 * kit actually has. A platform with no entry — or an unresolved one — gets no shared-rules line
 * rather than a pointer to a file that may not exist.
 */
const SHARED_RULE_DIGESTS = {
  mobile: {
    platforms: ['ios', 'android', 'flutter'],
    rule: 'mobile-shared-rules',
    text: 'Mobile standards: Clean Architecture data → domain → presentation, MVVM + Repository + UseCase, DI; no secrets in source, tokens in Keychain/Keystore/SecureStorage; loading/empty/error-with-retry states'
  },
  backend: {
    platforms: ['python'],
    rule: 'backend-shared-rules',
    text: 'Backend standards: router → service → repository, DI, one error envelope, paginated lists, idempotent create/payment; authz before logic, owner/tenant filter on every ID lookup, parameterized queries only, secrets from env/vault, no PII/tokens in logs; migrations with downgrade'
  },
  web: {
    platforms: ['web'],
    rule: 'web-shared-rules',
    text: 'Web standards: components → hooks → services (no `fetch` in components), server state in TanStack Query only, zod at the API boundary; no `dangerouslySetInnerHTML`/`innerHTML` with user data, no tokens in localStorage, strict CSP; loading/empty/error-with-retry states, a11y'
  }
};

/** The shared-rules digest entry for a platform, or null. */
function sharedRuleDigestFor(platform) {
  return Object.values(SHARED_RULE_DIGESTS).find((d) => d.platforms.includes(platform)) || null;
}

const AGENT_NAME = /^[A-Za-z0-9_-]+$/;

/** `omitClaudeMd: true` as a frontmatter line (optional trailing comment). */
const OMIT_FLAG = /\nomitClaudeMd:\s*true\s*(#.*)?(\n|$)/;

/** Frontmatter of `.claude/agents/<agentType>.md`, or null (missing, unreadable, not a plain name). */
function agentFrontmatter(projectRoot, agentType) {
  if (!agentType || !AGENT_NAME.test(agentType)) return null;
  try {
    const src = fs.readFileSync(path.join(projectRoot, '.claude', 'agents', `${agentType}.md`), 'utf8');
    if (!src.startsWith('---')) return null;
    const end = src.indexOf('\n---', 3);
    return end < 0 ? '' : src.slice(0, end);
  } catch {
    return null;
  }
}

/**
 * True when `.claude/agents/<agentType>.md` exists and its frontmatter sets omitClaudeMd: true.
 * Only those agents lost CLAUDE.md + the rules, so only they get the digest — a built-in
 * (Explore, general-purpose) still loads everything and would just read it twice.
 */
function agentOmitsClaudeMd(projectRoot, agentType) {
  const frontmatter = agentFrontmatter(projectRoot, agentType);
  return frontmatter !== null && OMIT_FLAG.test(frontmatter);
}

/**
 * What an agent loads, which decides what subagent-init adds:
 *  - 'omit'   — omitClaudeMd: true. Gets the digest AND the user's CLAUDE.md files + auto memory.
 *  - 'full'   — a kit agent (AGENT_ROLES) installed without the flag, i.e. `.bk.json`
 *               `subagents.fullContext: true`. Loads CLAUDE.md, rules and memory natively, so it
 *               gets the digest only (the hand-back cap and signal names live nowhere else).
 *  - 'native' — built-ins and user agents without the flag: the short generic block.
 * The installed frontmatter is the source of truth, not `.bk.json`: until `bk update` applies a
 * toggled setting the agent still loads what its frontmatter says.
 * @returns {'omit'|'full'|'native'}
 */
function agentContextMode(projectRoot, agentType) {
  const frontmatter = agentFrontmatter(projectRoot, agentType);
  if (frontmatter === null) return 'native';
  if (OMIT_FLAG.test(frontmatter)) return 'omit';
  return Object.prototype.hasOwnProperty.call(AGENT_ROLES, agentType) ? 'full' : 'native';
}

/**
 * Build the digest lines for one kit agent.
 * @param {{ agentType: string, platform: string, fullContext?: boolean }} opts
 *   fullContext — the agent also loads CLAUDE.md + rules natively (agentContextMode 'full');
 *   only the header changes.
 * @returns {string[]}
 */
function buildSubagentRuleDigest({ agentType, platform, fullContext = false }) {
  const role = AGENT_ROLES[agentType] || 'review';
  const rulesRel = '.claude/rules';
  const lines = [];

  lines.push(fullContext
    ? '## Kit Rules (digest — full context mode: CLAUDE.md and the rules are loaded too; this is the part that applies to you)'
    : '## Kit Rules (digest — CLAUDE.md and always-on rules are not loaded for kit agents)');
  // core-rules §5 + development-rules "File Handling"
  lines.push('- Do what the dispatch asks, nothing more. Read before editing. Update existing files; never create -v2/enhanced copies or files you do not need.');
  // team-rules IRON LAW (agent side)
  lines.push('- Write results to the dispatch `Output:` path; modify only files in its `Files:` / `owns:` scope.');
  // The hand-back. Claude Code delivers a subagent's final message to the conductor, which keeps
  // it for the rest of the session and re-reads it on every later request. X-Game-Pro (kit
  // 0.12.x): 192 hand-backs, median 4,559 chars, p90 6,264, max 8,184 — ~216k tokens of
  // conductor history, most of it the report pasted a second time. The report file already
  // holds it (verify-output checks the file, and its required sections apply to the FILE), so
  // the reply carries only what the next dispatch decision needs. Signals stay in it:
  // agent-signal-detector and workflow-metrics classify the final message (`last_assistant_message`, or the
  // SubagentHandback message — lib/subagent-final-message.cjs) and nothing else. The structured names must be in KNOWN_SIGNALS (lib/agent-signal-patterns.cjs) —
  // this line used to say `[SIGNAL: stuck]`, which the classifier silently ignores.
  // The design-* agents' one-line return format is stricter and wins.
  lines.push('- Final message = short hand-back, not the report (the conductor keeps it all session): ≤ ~1,200 chars — `Status: complete|needs_info|blocked` (+ verdict / severity counts), report path(s), ≤ 5 bullets the next step needs (blockers, criticals, files changed). No report file: the essentials inline, same cap. A stricter format in your body or the dispatch wins.');
  // team-rules signal markers + user-interaction-protocol §5
  lines.push('- Stuck or unsure: put `[SIGNAL: agent_stuck]` / `[SIGNAL: confidence_low]` in the hand-back; add `"confidence": "high|medium|low"` to the report metadata comment.');

  if (role === 'implement' || role === 'review') {
    // coding-intelligence-priority (+ CLAUDE.md "background agents: no MCP")
    lines.push(`- Code lookup: Serena MCP → LSP → Grep/Glob → Read. Grep for counts/file discovery, semantic tools for refs/hierarchy; background agents have no MCP (\`${rulesRel}/coding-intelligence-priority.md\`).`);
    // {mobile,backend,web}-shared-rules — only the one this platform's kit ships
    const shared = sharedRuleDigestFor(platform);
    if (shared) lines.push(`- ${shared.text} (\`${rulesRel}/${shared.rule}.md\`).`);
    // {platform}-rules
    const essentials = PLATFORM_ESSENTIALS[platform];
    if (essentials) lines.push(`- ${platform}: ${essentials} (\`${rulesRel}/${platform}-rules.md\`; commands in \`.claude/platform-context.json\`).`);
    // traceability (the agent side; the rule itself is scoped to requirement files)
    lines.push(`- Requirement IDs (UC-/NFR-/REQ-/TC-) are copied verbatim into \`reqs:\`, \`// @trace\` and \`requirements_satisfied\` — never renumbered (\`${rulesRel}/traceability.md\`).`);
  }

  if (role === 'implement') {
    // development-rules Code Standards / Build & Test / Plan Compliance, and the pre-0.13 subagent-init block
    lines.push('- Files < 200 LOC; platform naming; localized string keys, no hardcoded UI text; lint + compile after each edit.');
    lines.push('- Failing test or build: fix the root cause — never skip, weaken or mock around it to pass. Follow the sub-task; report a needed deviation instead of widening scope.');
    lines.push('- Unknown SDK/API: load `bk-docs-seeker`; hard bug: `bk-sequential-thinking`.');
  }

  return lines;
}

module.exports = {
  RULE_DECISIONS,
  AGENT_ROLES,
  SHARED_RULE_DIGESTS,
  agentOmitsClaudeMd,
  agentContextMode,
  buildSubagentRuleDigest
};
