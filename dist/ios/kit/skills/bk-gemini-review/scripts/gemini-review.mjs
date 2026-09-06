#!/usr/bin/env node
/**
 * gemini-review.mjs — Automated code review runner powered by Gemini CLI.
 *
 * Usage:
 *   node gemini-review.mjs [--feature <name>] [--platform <ios|android|flutter>] [--model <model>] [--fast] [--files <f1,f2>]
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to find project root (looking for package.json or .git or bk/)
function findProjectRoot() {
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(cur, '.git')) || existsSync(join(cur, 'bk')) || existsSync(join(cur, 'package.json'))) {
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();

// Parse CLI arguments
const args = process.argv.slice(2);
let feature = 'unnamed-feature';
let platform = null;
let fastMode = false;
let customModel = null;
let explicitFiles = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--feature' && i + 1 < args.length) {
    feature = args[++i];
  } else if (arg === '--platform' && i + 1 < args.length) {
    platform = args[++i].toLowerCase();
  } else if (arg === '--model' && i + 1 < args.length) {
    customModel = args[++i];
  } else if (arg === '--fast') {
    fastMode = true;
  } else if (arg === '--files' && i + 1 < args.length) {
    explicitFiles = args[++i].split(',').map(f => f.trim()).filter(Boolean);
  }
}

// Resolve the platform. Order matters: an explicit --platform is the caller's intent and
// must win over auto-detection. Guessing a default here would silently review an Android
// or Flutter project against iOS rules, so if nothing resolves we stop instead.
function readJsonField(filePath, field) {
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8'))[field];
    return typeof value === 'string' && value ? value.toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

const SUPPORTED_PLATFORMS = ['ios', 'android', 'flutter'];
let platformSource = 'the --platform flag';

if (!platform) {
  platform = readJsonField(join(PROJECT_ROOT, '.claude', 'platform-context.json'), 'platform');
  if (platform) platformSource = '.claude/platform-context.json';
}
if (!platform) {
  platform = readJsonField(join(PROJECT_ROOT, '.bk-version.json'), 'platform');
  if (platform) platformSource = '.bk-version.json';
}

if (!platform) {
  console.error('\n❌ ERROR: Could not determine the target platform.');
  console.error('  Pass --platform <ios|android|flutter>, or run from a project with');
  console.error('  .claude/platform-context.json or .bk-version.json.');
  process.exit(1);
}

if (!SUPPORTED_PLATFORMS.includes(platform)) {
  console.error(`\n❌ ERROR: Unsupported platform "${platform}" (from ${platformSource}).`);
  console.error(`  Expected one of: ${SUPPORTED_PLATFORMS.join(', ')}`);
  process.exit(1);
}

// Model selection.
//
// Model ids come from Antigravity CLI (`agy models`), not the retired Gemini CLI. All three
// below were verified answering on 2026-09-06 — including `gemini-3.1-pro-high`, which the
// old CLI refused with a free-tier quota of 0. `agy` routes through a different entitlement,
// so `--fast` means something again.
const DEFAULT_MODEL = 'gemini-3.1-pro-high';
const FAST_MODEL = 'gemini-3.8-flash-high';

// Models served only by the retired Gemini CLI. Passing one is a leftover config, not a
// choice — say so rather than letting it fail at the API.
const RETIRED_MODELS = new Set([
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'
]);

// The whole point of this agent is that a different model reviews what Claude wrote.
// `agy models` offers Claude models, so selecting one silently restores the confirmation
// bias this agent exists to remove. Refuse rather than quietly defeat the purpose.
const SELF_REVIEW_MODELS = /^claude[-.]/i;

const selectedModel = customModel
  || process.env.AGY_MODEL
  || process.env.GEMINI_MODEL          // pre-migration name, still honoured
  || (fastMode ? FAST_MODEL : DEFAULT_MODEL);

if (SELF_REVIEW_MODELS.test(selectedModel)) {
  console.error(`\n❌ ERROR: "${selectedModel}" is a Claude model.`);
  console.error('  This agent exists to have a DIFFERENT model review what Claude wrote;');
  console.error('  pointing it at Claude restores the bias it removes.');
  console.error('  Use a Gemini model here, or run /bk-review --engine claude instead.\n');
  process.exit(1);
}

if (RETIRED_MODELS.has(selectedModel)) {
  console.warn(`\n⚠️  Model "${selectedModel}" belongs to the retired Gemini CLI and is not an`);
  console.warn(`   Antigravity model id. Run "agy models" to list what is available.`);
  console.warn(`   Falling back to ${DEFAULT_MODEL}.\n`);
}
// Fall back to the tier the caller asked for: --fast should not silently upgrade to the
// heavy default just because the requested model was a retired id.
const effectiveModel = RETIRED_MODELS.has(selectedModel)
  ? (fastMode ? FAST_MODEL : DEFAULT_MODEL)
  : selectedModel;

console.log(`[bk-gemini-review] Initializing Gemini Code Review (via Antigravity CLI)`);
console.log(`  Feature:  ${feature}`);
console.log(`  Platform: ${platform} (from ${platformSource})`);
console.log(`  Model:    ${effectiveModel}`);

// 1. Locate the agy binary. `which` is absent on Windows and not guaranteed by POSIX;
//    `where` is the Windows equivalent, `command -v` the portable shell builtin.
const agyBin = process.env.AGY_CLI_PATH
  || process.env.GEMINI_CLI_PATH       // pre-migration name, still honoured
  || (() => {
    const probe = process.platform === 'win32' ? 'where agy' : 'command -v agy';
    try {
      // `where` can list several matches — take the first.
      return execSync(probe, { encoding: 'utf8' }).split('\n')[0].trim() || null;
    } catch (_) {
      return null;
    }
  })();

if (!agyBin) {
  console.error('\n❌ ERROR: Antigravity CLI ("agy") not found in PATH.');
  console.error('');
  console.error('  Google replaced Gemini CLI with Antigravity CLI on 2026-06-18.');
  console.error('  Install it (runs natively on macOS, Linux and Windows):');
  if (process.platform === 'darwin') {
    console.error('    brew install --cask antigravity-cli');
    console.error('    or: curl -fsSL https://antigravity.google/cli/install.sh | bash');
  } else if (process.platform === 'win32') {
    console.error('    See https://antigravity.google/docs/cli/install/ for the Windows installer');
  } else {
    console.error('    curl -fsSL https://antigravity.google/cli/install.sh | bash');
  }
  console.error('    then run "agy" once to authenticate.');
  console.error('');
  console.error('  Or skip it entirely and use the Claude reviewer:');
  console.error('    /bk-review --engine claude');
  console.error('');
  process.exit(1);
}

// 2. Identify files and collect diff
let changedFiles = [...explicitFiles];
let diffText = '';

try {
  if (changedFiles.length === 0) {
    const gitDiffFiles = execSync('git diff --name-only HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' })
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);

    const gitUntracked = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(l => l.startsWith('?? '))
      .map(l => l.slice(3).trim())
      .filter(Boolean);

    changedFiles = Array.from(new Set([...gitDiffFiles, ...gitUntracked]));
  }

  // Filter out non-code, lockfiles, hidden directories
  const ignorePatterns = [/node_modules\//, /\.git\//, /\.claude\//, /dist\//, /package-lock\.json/, /\.png$/, /\.jpg$/];
  changedFiles = changedFiles.filter(f => !ignorePatterns.some(pat => pat.test(f)));

  // Get diff
  try {
    diffText = execSync('git diff HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (_) {
    diffText = '';
  }
} catch (err) {
  console.warn(`[bk-gemini-review] Warning: Could not collect git diff: ${err.message}`);
}

if (changedFiles.length === 0) {
  console.log('[bk-gemini-review] No changed files detected for review.');
  // Write clean pass report
  writeReport({
    verdict: 'approve',
    summary: { critical: 0, major: 0, minor: 0, info: 0 },
    findings: []
  }, []);
  process.exit(0);
}

console.log(`[bk-gemini-review] Files to review (${changedFiles.length}):`);
for (const f of changedFiles.slice(0, 10)) {
  console.log(`  - ${f}`);
}
if (changedFiles.length > 10) {
  console.log(`  ... and ${changedFiles.length - 10} more files`);
}

// 3. Load Architecture and Platform rules
let archRules = '';
const archPath = join(PROJECT_ROOT, 'bk', 'docs', 'foundation', 'architecture.md');
if (existsSync(archPath)) {
  try {
    archRules = readFileSync(archPath, 'utf8').slice(0, 4000);
  } catch (_) {}
}

let platformRules = '';
const pRulePath = join(PROJECT_ROOT, '.claude', 'rules', `${platform}-rules.md`);
if (existsSync(pRulePath)) {
  try {
    platformRules = readFileSync(pRulePath, 'utf8').slice(0, 4000);
  } catch (_) {}
}

// 4. Load System Prompt Template
const templatePath = join(__dirname, '..', 'references', 'review-prompt-template.md');
let promptTemplate = '';
if (existsSync(templatePath)) {
  promptTemplate = readFileSync(templatePath, 'utf8');
} else {
  promptTemplate = 'You are a senior code reviewer. Review the following code for architecture, concurrency, security, and error handling. Output JSON only.';
}

// `agy --json-schema` constrains the model to our result shape. It narrows the "answered in
// prose" failure class but does not close it — identical runs have still produced output
// JSON.parse rejects — so the defensive parsing below stays. Passing the flag is optional:
// if the schema file is missing, run without it rather than failing the review.
const schemaFile = join(__dirname, '..', 'references', 'output-schema.json');
const schemaPath = existsSync(schemaFile) ? schemaFile : null;

// 5. Read contents of key changed files (up to max limit)
let fileContentsText = '';
let totalChars = 0;
const MAX_TOTAL_CHARS = 150000; // ~40k tokens safe chunk

for (const file of changedFiles) {
  const fullPath = join(PROJECT_ROOT, file);
  if (existsSync(fullPath)) {
    try {
      const content = readFileSync(fullPath, 'utf8');
      if (totalChars + content.length <= MAX_TOTAL_CHARS) {
        fileContentsText += `\n\n--- FILE: ${file} ---\n${content}`;
        totalChars += content.length;
      }
    } catch (_) {}
  }
}

// Assemble the review request in two parts.
//
// Everything — instructions and the bulk payload alike — travels in one stream-json message
// on stdin. Argv is never used for content, so the Linux MAX_ARG_STRLEN cap (128 KB per
// argument) that dictated the previous split cannot be hit. Verified against a 150 KB
// payload; see docs/antigravity-cli-migration.md.
//
// REQUIRED, not decorative. `agy` is an agent, not a completion endpoint: handed a review
// task inside a real repo it will reach for tools on its own — the platform sections name
// lint commands like `swiftlint lint --strict`, and it tries to RUN them. In headless mode
// that request cannot be prompted, so it is auto-denied and the run returns
// `status: "SUCCESS"` with an empty response. Measured 2026-09-06: without this preamble
// 0 bytes and a denied `command` permission; with it, a full review and clean stderr.
//
// The fix belongs here rather than in a permission grant. Handing the reviewer tool access
// would breach the Read-only+Harness boundary in rules/agent-protocols/tool-restriction.md,
// and `--dangerously-skip-permissions` would hand it everything. Do not remove this block,
// and do not add lint-command text below it without re-testing.
const NO_TOOLS_PREAMBLE = `## CRITICAL: You have no tools

Do NOT attempt to run commands, read files, or search the codebase — every tool call will be
denied and the review will return empty. Everything you need is already in this message.
Any lint command named below is context describing the project's standards; it is NOT an
instruction to execute it. Answer directly with the JSON object.

`;

const reviewMessage = `${NO_TOOLS_PREAMBLE}${promptTemplate}

## Platform Context
Target Platform: ${platform}
${platformRules ? `Platform Rules:\n${platformRules}\n` : ''}
${archRules ? `Architecture Guidelines:\n${archRules}\n` : ''}

## Changed Files List
${changedFiles.map(f => `- ${f}`).join('\n')}

## Git Diff
${diffText.slice(0, 50000)}

## Source Files Content
${fileContentsText}

Remember: Output ONLY the strict JSON object with fields: "verdict", "summary", "findings". Do NOT wrap in markdown fences.`;

// NDJSON, one message per line. The key is `event`, not `type` — an undocumented detail
// recovered by probing; a wrong shape is rejected with `input_tokens: 0`.
const streamMessage = JSON.stringify({
  event: 'user',
  message: { role: 'user', content: [{ type: 'text', text: reviewMessage }] }
}) + '\n';

// 6. Invoke Antigravity CLI
console.log(`[bk-gemini-review] Sending review to Antigravity CLI (${effectiveModel})...`);
console.log(`  Payload: ${(Buffer.byteLength(reviewMessage) / 1024).toFixed(1)} KB via stream-json`);

// `-p` swallows the following token as its value, so the attached form `-p=` is required
// whenever the prompt comes from stdin rather than argv.
const agyArgs = [
  '-p=',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--model', effectiveModel,
  ...(schemaPath ? ['--json-schema', schemaPath] : [])
];

function runAgy() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(agyBin, agyArgs, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // The entire review — instructions and code — goes in as one NDJSON message.
    child.stdin.on('error', err => rejectPromise(err));
    child.stdin.end(streamMessage, 'utf8');

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', chunk => {
      stdoutData += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderrData += chunk.toString();
    });

    child.on('close', code => {
      if (code !== 0) {
        rejectPromise(new Error(`Antigravity CLI exited with code ${code}: ${stderrData || stdoutData}`));
        return;
      }
      // A zero exit is not success. `agy` reports transport-level failures inside the
      // result event — a denied tool, for instance, returns status SUCCESS with an empty
      // response. Surface the CLI's own error before the payload is parsed.
      const result = extractResultEvent(stdoutData);
      if (!result) {
        rejectPromise(new Error(`No result event in Antigravity CLI output: ${stderrData || stdoutData.slice(0, 500)}`));
        return;
      }
      if (result.status && result.status !== 'SUCCESS') {
        rejectPromise(new Error(`Antigravity CLI returned status ${result.status}: ${result.error || '(no detail)'}`));
        return;
      }
      // An empty response under status SUCCESS means the model produced nothing. The usual
      // cause is a denied tool request, which `agy` reports only on stderr — without this
      // check the failure surfaces as a misleading "could not be parsed" further down.
      if (!result.response) {
        const denied = /permission|auto-denied/i.test(stderrData);
        rejectPromise(new Error(
          denied
            ? `Antigravity CLI produced no output: a tool permission was auto-denied in headless `
              + `mode. The reviewer is supposed to need no tools — check that the no-tools preamble `
              + `is still present in the prompt. CLI said: ${stderrData.trim().slice(0, 300)}`
            : `Antigravity CLI returned an empty response with status SUCCESS. `
              + `${stderrData.trim().slice(0, 300) || '(no stderr)'}`
        ));
        return;
      }
      resolvePromise(result.response);
    });

    child.on('error', err => {
      rejectPromise(err);
    });
  });
}

/**
 * `--output-format stream-json` emits an NDJSON event stream (`init`, `step_update`,
 * `result`), not a single object — parsing the whole of stdout never works. Pull the
 * terminal `result` event and hand back its payload.
 */
function extractResultEvent(stdoutData) {
  for (const line of stdoutData.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (_) {
      continue;              // progress lines and CLI chatter are not all valid JSON
    }
    if (event && event.event === 'result' && event.result) return event.result;
  }
  return null;
}

function stripFences(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
}

/**
 * Yield each complete top-level `{...}` in `text`, tracking string state so braces inside
 * string literals do not throw the depth count off.
 *
 * Needed because `--json-schema` makes `agy` append its own schema-conformant object after
 * the model's answer: the response is two JSON objects back to back, and `JSON.parse` on
 * the whole string dies at the boundary.
 */
function* jsonObjectsIn(text) {
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) continue;               // stray brace, ignore
      depth--;
      if (depth === 0 && start >= 0) {
        yield text.slice(start, i + 1);
        start = -1;
      }
    }
  }
}

/**
 * Pull the review object out of the model's answer.
 *
 * Deliberately keyed on the presence of a `findings` array rather than on parse success:
 * several shapes here are valid JSON without being the review — an `--output-format json`
 * envelope, or `agy`'s trailing structured-output object.
 */
function parseGeminiOutput(rawOutput) {
  const text = stripFences(rawOutput);

  // Fast path: the whole response is exactly the review.
  try {
    const whole = JSON.parse(text);
    if (whole && Array.isArray(whole.findings)) return whole;
    // Legacy envelope: model text nested under `response`.
    if (whole && typeof whole.response === 'string') {
      const inner = JSON.parse(stripFences(whole.response));
      if (inner && Array.isArray(inner.findings)) return inner;
    }
  } catch (_) {
    // Fall through — concatenated or prose-wrapped output lands here.
  }

  // Scan for the first embedded object that actually looks like a review.
  for (const candidate of jsonObjectsIn(text)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && Array.isArray(parsed.findings)) return parsed;
    } catch (_) { /* not this one */ }
  }

  return null;
}

/**
 * A harness failure (CLI missing/unauthenticated, network down, unparseable
 * response) is NOT a code defect. Report it as verdict "error" with no findings
 * and exit non-zero, so a commit gate keyed on `critical == 0` neither blocks on
 * a fabricated finding nor passes on a review that never ran.
 */
function failHarness(message, remediation, rawOutput) {
  console.error(`\n❌ [bk-gemini-review] ${message}`);
  console.error(`   ${remediation}`);
  writeReport({
    verdict: 'error',
    summary: { critical: 0, major: 0, minor: 0, info: 0 },
    findings: [],
    error: { message, remediation }
  }, changedFiles, rawOutput);
  process.exit(1);
}

/**
 * Point the user at the actual cause. A blanket "authenticate the CLI" sends someone
 * whose model was retired or whose quota is exhausted off in the wrong direction.
 */
function remediationFor(errMessage) {
  const m = String(errMessage);
  if (/no longer available|not found|ModelNotFoundError|unknown model|\b404\b/i.test(m)) {
    // Do not suggest the model that just failed.
    const alt = effectiveModel === DEFAULT_MODEL
      ? `Run "agy models" to list what this account can reach`
      : `Try --model ${DEFAULT_MODEL}, or run "agy models" to list what is available`;
    return `Model "${effectiveModel}" is not available to this account. ${alt}. `
      + 'Or use /bk-review --engine claude.';
  }
  if (/quota|rate limit|RESOURCE_EXHAUSTED|limit: 0|retry in/i.test(m)) {
    return 'Quota exhausted for this model on this account. Wait for the quota window to reset, '
      + 'pick a lighter --model (or --fast), or use /bk-review --engine claude.';
  }
  if (/auth|credential|API key|login|not signed in|unauthenticated/i.test(m)) {
    return 'Authenticate Antigravity CLI: run "agy" once interactively, then re-run the review.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|socket/i.test(m)) {
    return 'Network error reaching the Antigravity API. Check connectivity and re-run.';
  }
  if (/permission|auto-denied|dangerously-skip-permissions/i.test(m)) {
    // Should be unreachable: the review is handed its context and needs no tools. If it
    // fires, something reintroduced workspace reading.
    return 'The CLI requested a tool permission. This reviewer is designed to need no tools — '
      + 'the code is supplied in the prompt. Do NOT pass --dangerously-skip-permissions; '
      + 'report this as a bug in the review harness.';
  }
  return 'Check the error above. If the CLI is unauthenticated run "agy"; if the model is '
    + `unavailable try --model ${DEFAULT_MODEL}, or use /bk-review --engine claude.`;
}

async function main() {
  let rawOutput = '';
  try {
    rawOutput = await runAgy();
  } catch (err) {
    failHarness(
      `Antigravity CLI execution failed: ${err.message}`,
      remediationFor(err.message)
    );
    return;
  }

  const result = parseGeminiOutput(rawOutput);

  if (!result || !Array.isArray(result.findings)) {
    failHarness(
      'Gemini returned a response that could not be parsed into the review schema.',
      'The raw response was saved next to the report — inspect it, then re-run the review.',
      rawOutput
    );
    return;
  }

  writeReport(result, changedFiles);
}

function writeReport(result, files, rawOutput) {
  const reportsDir = join(PROJECT_ROOT, 'bk', 'dev', 'shared', 'reports');
  mkdirSync(reportsDir, { recursive: true });

  // Canonical paths for this agent are gemini-suffixed. bk-code-reviewer owns the
  // unsuffixed `code-review-{feature}.*`; writing there too would make `/bk-review
  // --engine dual` clobber whichever model finished first.
  const jsonReportPath = join(reportsDir, `code-review-gemini-${feature}.json`);
  const mdReportPath = join(reportsDir, `code-review-gemini-${feature}.md`);

  if (rawOutput) {
    const rawPath = join(reportsDir, `code-review-gemini-${feature}.raw.txt`);
    try {
      writeFileSync(rawPath, rawOutput, 'utf8');
      console.error(`   Raw response saved to: ${rawPath}`);
    } catch (_) {}
  }

  const critical = result.summary?.critical ?? result.findings.filter(f => f.severity === 'critical').length;
  const major = result.summary?.major ?? result.findings.filter(f => f.severity === 'major').length;
  const minor = result.summary?.minor ?? result.findings.filter(f => f.severity === 'minor').length;
  const info = result.summary?.info ?? result.findings.filter(f => f.severity === 'info').length;

  const verdict = result.verdict || (critical > 0 || major > 0 ? 'request_changes' : 'approve');

  // Format Markdown Report
  let md = `## Code Review (Gemini): ${feature}
**Agent**: bk-gemini-reviewer | **Model**: ${effectiveModel} | **Date**: ${new Date().toISOString()} | **Verdict**: ${verdict}

### Files Reviewed
${files.length > 0 ? files.map(f => `- ${f}`).join('\n') : '- No changed files'}

### Findings
| # | Severity | File | Line | Rule | Message | Suggestion |
|---|----------|------|------|------|---------|------------|
`;

  if (result.findings.length === 0 && verdict === 'error') {
    md += `| - | - | - | - | - | Review did not run to completion — see Harness Error below. | - |\n`;
  } else if (result.findings.length === 0) {
    md += `| - | info | - | - | clean-arch | No issues found. Code passes architectural and safety inspection. | - |\n`;
  } else {
    result.findings.forEach((f, idx) => {
      const msg = (f.message || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const sug = (f.suggestion || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      md += `| ${idx + 1} | ${f.severity} | ${f.file} | ${f.line || 1} | ${f.rule} | ${msg} | ${sug} |\n`;
    });
  }

  if (result.error) {
    md += `
### Harness Error
The Gemini review harness did not complete. This is a tooling failure, **not** a finding
about the code under review — do not treat this report as a passed or failed review.

- **What happened**: ${result.error.message}
- **How to fix**: ${result.error.remediation}
`;
  }

  const status = verdict === 'error' ? 'error' : 'complete';

  md += `
### Summary
- Critical: ${critical} | Major: ${major} | Minor: ${minor} | Info: ${info}
- **Verdict**: ${verdict}

<!-- metadata: {"schema_version":"1.0","agent":"bk-gemini-reviewer","model":"${effectiveModel}","feature":"${feature}","verdict":"${verdict}","status":"${status}"} -->
`;

  writeFileSync(jsonReportPath, JSON.stringify(result, null, 2), 'utf8');
  writeFileSync(mdReportPath, md, 'utf8');

  if (verdict === 'error') {
    console.error(`  Report:   ${mdReportPath}`);
    return;
  }

  console.log(`\n✅ Gemini Code Review Complete!`);
  console.log(`  Verdict:  ${verdict.toUpperCase()}`);
  console.log(`  Findings: Critical=${critical}, Major=${major}, Minor=${minor}, Info=${info}`);
  console.log(`  Report:   ${mdReportPath}`);
}

main().catch(e => {
  console.error('Fatal error in gemini-review.mjs:', e);
  process.exit(1);
});
