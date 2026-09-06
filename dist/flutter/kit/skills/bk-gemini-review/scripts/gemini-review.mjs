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

// Select Gemini Model: Default to latest Pro model, fallback to Flash when --fast is used
const selectedModel = customModel || process.env.GEMINI_MODEL || (fastMode ? 'gemini-2.5-flash' : 'gemini-2.5-pro');

console.log(`[bk-gemini-review] Initializing Gemini Code Review`);
console.log(`  Feature:  ${feature}`);
console.log(`  Platform: ${platform} (from ${platformSource})`);
console.log(`  Model:    ${selectedModel}`);

// 1. Locate gemini binary. `which` is absent on Windows and not guaranteed by POSIX;
//    `where` is the Windows equivalent, `command -v` the portable shell builtin.
const geminiBin = process.env.GEMINI_CLI_PATH || (() => {
  const probe = process.platform === 'win32' ? 'where gemini' : 'command -v gemini';
  try {
    // `where` can list several matches — take the first.
    return execSync(probe, { encoding: 'utf8' }).split('\n')[0].trim() || null;
  } catch (_) {
    return null;
  }
})();

if (!geminiBin) {
  console.error('\n❌ ERROR: Google Gemini CLI ("gemini") not found in PATH.');
  console.error('Please install it using:');
  console.error('  npm install -g @google/gemini-cli');
  if (process.platform === 'darwin') console.error('  or: brew install gemini-cli');
  console.error('Then authenticate with:');
  console.error('  gemini (select Google login or set GEMINI_API_KEY)\n');
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
// The bulk payload (diff + full file contents) can easily reach 200 KB. Linux caps a
// single argv string at MAX_ARG_STRLEN (128 KB), so passing it through `-p` fails with
// E2BIG on any non-trivial review. Instead: instructions go through `-p` (a few KB), and
// the bulk context is piped to the CLI on stdin, which has no size limit.
const instructionPrompt = `${promptTemplate}

## Platform Context
Target Platform: ${platform}
${platformRules ? `Platform Rules:\n${platformRules}\n` : ''}
${archRules ? `Architecture Guidelines:\n${archRules}\n` : ''}
The code under review (changed file list, git diff, and full source) is supplied on stdin above.

Remember: Output ONLY the strict JSON object with fields: "verdict", "summary", "findings". Do NOT wrap in markdown fences.`;

const contextPayload = `## Changed Files List
${changedFiles.map(f => `- ${f}`).join('\n')}

## Git Diff
${diffText.slice(0, 50000)}

## Source Files Content
${fileContentsText}
`;

// 6. Invoke Gemini CLI
console.log(`[bk-gemini-review] Sending review prompt to Gemini CLI (${selectedModel})...`);
console.log(`  Context payload: ${(contextPayload.length / 1024).toFixed(1)} KB via stdin`);

const geminiArgs = [
  '-m', selectedModel,
  '-p', instructionPrompt,
  '--output-format', 'json'
];

function runGemini() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(geminiBin, geminiArgs, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Feed the bulk review context on stdin (see note at instructionPrompt).
    child.stdin.on('error', err => rejectPromise(err));
    child.stdin.end(contextPayload, 'utf8');

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
        rejectPromise(new Error(`Gemini CLI exited with code ${code}: ${stderrData || stdoutData}`));
      } else {
        resolvePromise(stdoutData);
      }
    });

    child.on('error', err => {
      rejectPromise(err);
    });
  });
}

function stripFences(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
}

function parseGeminiOutput(rawOutput) {
  let parsed = null;
  try {
    parsed = JSON.parse(stripFences(rawOutput));
  } catch (_) {
    return null;
  }

  // `--output-format json` wraps the model's text in a `response` field, so the outer
  // parse succeeds but yields the envelope, not the review. Unwrap one level before
  // deciding the output is unusable. (Checking `findings` rather than parse success is
  // what makes this work — the envelope is itself valid JSON.)
  if (parsed && !Array.isArray(parsed.findings) && typeof parsed.response === 'string') {
    try {
      parsed = JSON.parse(stripFences(parsed.response));
    } catch (_) {
      return null;
    }
  }

  return parsed && Array.isArray(parsed.findings) ? parsed : null;
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

async function main() {
  let rawOutput = '';
  try {
    rawOutput = await runGemini();
  } catch (err) {
    failHarness(
      `Gemini CLI execution failed: ${err.message}`,
      'Authenticate the CLI (run "gemini", or set GEMINI_API_KEY), confirm network access, then re-run the review.'
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
**Agent**: bk-gemini-reviewer | **Model**: ${selectedModel} | **Date**: ${new Date().toISOString()} | **Verdict**: ${verdict}

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

<!-- metadata: {"schema_version":"1.0","agent":"bk-gemini-reviewer","model":"${selectedModel}","feature":"${feature}","verdict":"${verdict}","status":"${status}"} -->
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
