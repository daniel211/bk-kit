#!/usr/bin/env node
/**
 * codex-review.mjs — Cross-model code review runner powered by the OpenAI Codex CLI.
 *
 * Usage:
 *   node codex-review.mjs [--feature <name>] [--platform <ios|android|flutter|python|web|fullstack>] [--model <id>] [--files <f1,f2>]
 *
 * Invokes (prompt on stdin):
 *   codex exec --sandbox read-only --skip-git-repo-check --json [-m <id>]
 *     --output-schema <schema.json> -o <tmpfile> -
 *
 * NEVER add `--dangerously-bypass-approvals-and-sandbox` or `--full-auto`: the reviewer reads,
 * it never writes. Without --model no `-m` is passed, so the user's own Codex config default
 * applies.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findProjectRoot, parseArgs, resolvePlatform, collectScope, buildPrompt } from './codex-review-scope.mjs';
import { writeReport } from './codex-review-report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Kit root = first ancestor holding both skills/ and scripts/ (repo and installed layouts). */
function kitRoot() {
  let cur = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, 'skills')) && existsSync(join(cur, 'scripts'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(`Could not locate the kit root (skills/ + scripts/) above ${__dirname}`);
}

const importKit = (name) => import(pathToFileURL(join(kitRoot(), 'scripts', name)).href);
const { readFinalMessage, extractStreamError, parseReviewJson } = await importKit('codex-stream.mjs');
const { preflightCodex } = await importKit('codex-preflight.mjs');

const PROJECT_ROOT = findProjectRoot();
const opts = parseArgs(process.argv.slice(2));
const TIMEOUT_MS = Number(process.env.CODEX_REVIEW_TIMEOUT_MS) || 20 * 60 * 1000;
const modelLabel = opts.model || 'codex-default';
let changedFiles = [];

const { platform, source, error: platformError } = resolvePlatform(opts.platform, PROJECT_ROOT);
if (platformError) {
  console.error(`\n❌ ERROR: ${platformError}`);
  process.exit(1);
}
// The point of this agent is that a non-Claude model reviews what Claude wrote.
if (opts.model && /claude|anthropic|opus|sonnet|haiku/i.test(opts.model)) {
  console.error(`\n❌ ERROR: "${opts.model}" is a Claude model — cross-model review needs a Codex/OpenAI model.`);
  console.error('  Omit --model to use your Codex default, or run /bk-review --engine claude instead.\n');
  process.exit(1);
}

console.log('[bk-codex-review] Initializing Codex Code Review (via OpenAI Codex CLI)');
console.log(`  Feature:  ${opts.feature}`);
console.log(`  Platform: ${platform} (from ${source})`);
console.log(`  Model:    ${opts.model || '(Codex config default)'}`);

/** Harness failure: ERROR report, no findings, non-zero exit — never a pass or a fail. */
function failHarness(message, remediation, rawOutput) {
  console.error(`\n❌ [bk-codex-review] ${message}`);
  console.error(`   ${remediation}`);
  const { mdPath } = writeReport({
    projectRoot: PROJECT_ROOT, feature: opts.feature, model: modelLabel, files: changedFiles, rawOutput,
    result: { verdict: 'error', summary: { critical: 0, major: 0, minor: 0, info: 0 }, findings: [],
      error: { message, remediation } }
  });
  console.error(`  Report:   ${mdPath}`);
  process.exit(1);
}

function remediationFor(msg) {
  const m = String(msg);
  const fallback = ' Or use /bk-review (Gemini, default) or /bk-review --engine claude.';
  if (/401|unauthori[sz]ed|not logged in|login|api key|authentication/i.test(m)) {
    return 'Authenticate Codex: run "codex login" (or export OPENAI_API_KEY), then re-run.' + fallback;
  }
  if (/429|rate limit|quota|usage limit|insufficient_quota/i.test(m)) {
    return 'Codex quota or rate limit reached. Wait for the window to reset, or pick another --model.' + fallback;
  }
  if (/model.*(not found|does not exist|not supported|unsupported)|unknown model|404/i.test(m)) {
    return `Model "${modelLabel}" is not available to this account. Omit --model to use the Codex default.` + fallback;
  }
  if (/output.schema|json schema|invalid_json_schema/i.test(m)) {
    return 'Codex rejected the output schema — report this as a bug in the bk-codex-review harness.' + fallback;
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|socket|stream disconnected/i.test(m)) {
    return 'Network error reaching the OpenAI API. Check connectivity and re-run.' + fallback;
  }
  return 'Check the error above. If Codex is unauthenticated run "codex login".' + fallback;
}

function runCodex(bin, prompt, outFile) {
  const schema = join(__dirname, '..', 'references', 'output-schema.json');
  const args = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json',
    ...(opts.model ? ['-m', opts.model] : []),
    ...(existsSync(schema) ? ['--output-schema', schema] : []),
    '-o', outFile, '-'];
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(bin, args, { cwd: PROJECT_ROOT, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.stdin.on('error', rejectRun);
    child.stdin.end(prompt, 'utf8');
    child.on('error', rejectRun);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const streamError = extractStreamError(stdout);
      if (signal) return rejectRun(new Error(`Codex CLI was stopped (${signal}) after ${TIMEOUT_MS} ms`));
      if (code !== 0) {
        return rejectRun(new Error(`Codex CLI exited with code ${code}: ${streamError || stderr.trim().slice(0, 500) || '(no detail)'}`));
      }
      const text = readFinalMessage(outFile, stdout);
      if (!text) {
        return rejectRun(new Error(`Codex CLI produced no final message. ${streamError || stderr.trim().slice(0, 300) || ''}`));
      }
      resolveRun(text);
    });
  });
}

async function main() {
  const pre = preflightCodex(process.env);
  if (!pre.binary) {
    console.error(`\n❌ ERROR: ${pre.problem}\n  ${pre.remediation}\n`);
    process.exit(1);
  }
  const scope = collectScope(PROJECT_ROOT, opts.files);
  changedFiles = scope.files;
  if (!pre.ok) failHarness(pre.problem, pre.remediation);

  if (changedFiles.length === 0) {
    console.log('[bk-codex-review] No changed files detected for review.');
    writeReport({ projectRoot: PROJECT_ROOT, feature: opts.feature, model: modelLabel, files: [],
      result: { verdict: 'approve', summary: { critical: 0, major: 0, minor: 0, info: 0 }, findings: [] } });
    return;
  }
  console.log(`[bk-codex-review] Files to review (${changedFiles.length}):`);
  changedFiles.slice(0, 10).forEach(f => console.log(`  - ${f}`));
  if (changedFiles.length > 10) console.log(`  ... and ${changedFiles.length - 10} more files`);

  const prompt = buildPrompt({ projectRoot: PROJECT_ROOT, platform, files: changedFiles, diff: scope.diff,
    templatePath: join(__dirname, '..', 'references', 'review-prompt-template.md') });
  console.log(`[bk-codex-review] Sending review to Codex CLI (${(Buffer.byteLength(prompt) / 1024).toFixed(1)} KB via stdin)...`);

  const tmp = mkdtempSync(join(tmpdir(), 'bk-codex-review-'));
  let raw = '';
  let runError = null;
  try {
    raw = await runCodex(pre.binary, prompt, join(tmp, 'last-message.txt'));
  } catch (err) {
    runError = err;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // After cleanup: failHarness exits the process, which would skip a `finally`.
  if (runError) failHarness(`Codex CLI execution failed: ${runError.message}`, remediationFor(runError.message));

  const result = parseReviewJson(raw);
  if (!result) {
    failHarness('Codex returned a response that could not be parsed into the review schema.',
      'The raw response was saved next to the report — inspect it, then re-run the review.', raw);
  }
  const { mdPath, verdict, counts } = writeReport({ projectRoot: PROJECT_ROOT, feature: opts.feature,
    model: modelLabel, files: changedFiles, result });
  console.log('\n✅ Codex Code Review Complete!');
  console.log(`  Verdict:  ${verdict.toUpperCase()}`);
  console.log(`  Findings: Critical=${counts.critical}, Major=${counts.major}, Minor=${counts.minor}, Info=${counts.info}`);
  console.log(`  Report:   ${mdPath}`);
}

main().catch(e => {
  console.error('Fatal error in codex-review.mjs:', e);
  process.exit(1);
});
