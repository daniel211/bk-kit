#!/usr/bin/env node
/**
 * visual-compare-agy.mjs — Score an implementation screenshot against its Figma export,
 * through the Antigravity CLI ("agy").
 *
 * Replaces the direct Gemini API path as the default. That path needed a GEMINI_API_KEY the
 * kit could not help anyone obtain, and pinned gemini-2.5-flash — a model the retired Gemini
 * CLI served and Antigravity does not. visual-compare.py stays as the fallback for machines
 * with a key but no CLI; between them, one of the two almost always works.
 *
 * Usage:
 *   node visual-compare-agy.mjs --figma <png> --screenshot <png> [--threshold 85] [--model m]
 *
 * Prints the same JSON shape visual-compare.py prints, so callers need no branch.
 *
 * Exit codes:
 *   0  compared, score >= threshold
 *   1  compared, score < threshold
 *   2  could not run here (no agy) — the caller should try visual-compare.py
 *   3  agy ran but produced no usable result
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Locate the kit root — the directory holding both `skills/` and `scripts/`. */
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

const ROOT = kitRoot();
const { resolveModel, FAST_MODEL } = await import(pathToFileURL(join(ROOT, 'scripts', 'agy-model-resolver.mjs')).href);
const { preflightAgyBinary, classifyDenial, allowRulesSnippet, AGY_SETTINGS_PATH } =
  await import(pathToFileURL(join(ROOT, 'scripts', 'agy-preflight.mjs')).href);
const { extractResultEvent, parseStructuredOutput } =
  await import(pathToFileURL(join(ROOT, 'scripts', 'agy-stream.mjs')).href);

const args = process.argv.slice(2);
const opts = { figma: null, screenshot: null, threshold: 85, model: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--figma') opts.figma = args[++i];
  else if (args[i] === '--screenshot') opts.screenshot = args[++i];
  else if (args[i] === '--threshold') opts.threshold = Number(args[++i]);
  else if (args[i] === '--model') opts.model = args[++i];
}

function emit(obj, code) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(code);
}

if (!opts.figma || !opts.screenshot) {
  emit({ error: 'Both --figma and --screenshot are required.' }, 3);
}
if (!(opts.threshold >= 0 && opts.threshold <= 100)) {
  emit({ error: 'Threshold must be between 0 and 100.' }, 3);
}
for (const file of [opts.figma, opts.screenshot]) {
  if (!existsSync(file)) emit({ error: `Not found: ${file}` }, 3);
  // 20MB is the documented per-image ceiling; a larger file fails deep inside the CLI with
  // a far less useful message.
  if (statSync(file).size > 20 * 1024 * 1024) {
    emit({ error: `Image larger than 20MB: ${file}` }, 3);
  }
}

const pre = preflightAgyBinary();
if (!pre.ok) {
  emit({
    error: pre.reason,
    remedy: `${pre.remedy} Or use the GEMINI_API_KEY path: scripts/visual-compare.py`
  }, 2);
}

// Vision comparison is a bounded, well-specified judgement, not deep reasoning — the flash
// tier answers it well and costs a fraction of the pro tier.
const { model, warnings } = resolveModel({ requested: opts.model || FAST_MODEL });
for (const w of warnings) console.error(`⚠️  ${w}`);

/**
 * The comparison prompt, taken from the skill's own reference.
 *
 * Read rather than restated so the two engines score against one rubric. If the reference is
 * missing, the run stops instead of quietly inventing a different rubric — a score produced
 * by unknown criteria is worse than no score.
 */
const templatePath = resolve(__dirname, '..', 'references', 'comparison-prompt-template.md');
if (!existsSync(templatePath)) {
  emit({ error: `Comparison rubric not found at ${templatePath}` }, 3);
}
const rubric = readFileSync(templatePath, 'utf8').replace(/THRESHOLD/g, String(opts.threshold));

const prompt = `${rubric}

## The two images

IMAGE 1 (Figma Design) — read this file: ${resolve(opts.figma)}
IMAGE 2 (App Screenshot) — read this file: ${resolve(opts.screenshot)}

Use the read_file tool to open both images. Do NOT run shell commands.
Answer with the JSON object only — no prose, no markdown fences.`;

const streamMessage = JSON.stringify({
  event: 'user',
  message: { role: 'user', content: [{ type: 'text', text: prompt }] }
}) + '\n';

const schemaFile = join(__dirname, 'schemas', 'visual-compare.schema.json');
const child = spawn(pre.binary, [
  '-p=',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--model', model,
  '--print-timeout', '5m',
  ...(existsSync(schemaFile) ? ['--json-schema', schemaFile] : [])
], { stdio: ['pipe', 'pipe', 'pipe'] });

let stdoutData = '';
let stderrData = '';
child.stdin.on('error', () => { /* the result event explains any early close */ });
child.stdin.end(streamMessage, 'utf8');
child.stdout.on('data', (c) => { stdoutData += c.toString(); });
child.stderr.on('data', (c) => { stderrData += c.toString(); });

const exitCode = await new Promise((res) => child.on('close', res));

if (classifyDenial(stderrData)) {
  emit({
    error: 'agy denied the file read it needed; headless mode cannot ask for approval.',
    remedy: `Add to ${AGY_SETTINGS_PATH}: ${allowRulesSnippet(['read_file(*)'])}`
  }, 2);
}
if (exitCode !== 0) {
  emit({ error: `agy exited with code ${exitCode}`, detail: stderrData.slice(0, 500) }, 3);
}

const event = extractResultEvent(stdoutData);
if (!event || !event.response) {
  emit({ error: 'agy returned no response.', detail: stderrData.slice(0, 500) }, 3);
}

// Keyed on the shape we need, not on parse success: with --json-schema agy appends its own
// object after the model's answer, so "it parsed" does not mean "it is the score".
const result = parseStructuredOutput(event.response,
  (o) => typeof o.score === 'number' && Array.isArray(o.discrepancies));
if (!result) {
  emit({ error: "Could not find a comparison result in agy's response.",
         raw: String(event.response).slice(0, 500) }, 3);
}

// The threshold is the caller's, not the model's: re-derive `pass` rather than trusting a
// field the model may have computed against a number it misread.
result.threshold = opts.threshold;
result.pass = (result.score || 0) >= opts.threshold;
result.engine = `agy:${model}`;

emit(result, result.pass ? 0 : 1);
