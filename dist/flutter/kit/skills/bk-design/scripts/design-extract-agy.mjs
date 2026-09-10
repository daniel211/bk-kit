#!/usr/bin/env node
/**
 * design-extract-agy.mjs — Run a design extraction through the Antigravity CLI ("agy")
 * instead of the Claude design agents.
 *
 * Both engines write the same files, and the acceptance gate is the same for both: the
 * bk-design Self-Check plus the filesystem post-verify in the design workflow. Nothing
 * downstream — bk-generate, bk-code, bk-visual-verify — is told which engine ran.
 *
 * Figma is read here, in Node, over the REST API — never by the model. Fetching and
 * exporting are deterministic work, so leaving them to a model only adds a way for the run
 * to report data it never fetched. By the time agy is invoked, everything it needs is
 * already on disk as JSON, and its whole job is to write the spec from it. That is also why
 * it needs no MCP permission: read the flow directory, write the flow directory.
 *
 * Usage:
 *   node design-extract-agy.mjs --mode discovery --figma-url <url> --flow <dir> [...]
 *   node design-extract-agy.mjs --mode screen --node-id <id> --slug <slug> --flow <dir> [...]
 *
 * Exit codes:
 *   0  extraction produced the expected files
 *   2  agy cannot run here (preflight failed) — the caller should use the claude engine
 *   3  agy ran but the output did not satisfy the contract — retry, then fall back
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Locate the kit root — the directory holding both `skills/` and `scripts/`.
 *
 * The depth differs between the kit repo (`src/skills/_base/<skill>/scripts/`) and an
 * installed kit (`.claude/skills/<skill>/scripts/`), so a fixed number of `..` segments is
 * wrong in one of them. Kept inline because resolving the root is what makes importing from
 * the root possible.
 *
 * @returns {string}
 */
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
const { resolveModel } = await import(pathToFileURL(join(ROOT, 'scripts', 'agy-model-resolver.mjs')).href);
const figma = await import(pathToFileURL(join(ROOT, 'scripts', 'figma-rest.mjs')).href);
const { FigmaCache, sweepCache } = await import(pathToFileURL(join(ROOT, 'scripts', 'figma-cache.mjs')).href);
const { FigmaRest, parseFigmaUrl, readToken, serializeNode, textNodes, searchInstances,
        assetCandidates, frameChildren, slugify, duplicateNames, DEFAULT_NODE_DEPTH } = figma;
const { preflightAgyDesign, requiredAllowRules, allowRulesSnippet, classifyDenial, AGY_SETTINGS_PATH } =
  await import(pathToFileURL(join(ROOT, 'scripts', 'agy-preflight.mjs')).href);

// ---------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const opts = { mode: null, figmaUrl: null, fileKey: null, nodeId: null, slug: null, flow: null,
               techStack: null, model: null, fast: false, timeout: '15m', depth: null,
               preflightOnly: false };

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const next = () => args[++i];
  if (arg === '--mode') opts.mode = next();
  else if (arg === '--figma-url') opts.figmaUrl = next();
  else if (arg === '--file-key') opts.fileKey = next();
  else if (arg === '--node-id') opts.nodeId = next();
  else if (arg === '--slug') opts.slug = next();
  else if (arg === '--flow') opts.flow = next();
  else if (arg === '--tech-stack') opts.techStack = next();
  else if (arg === '--model') opts.model = next();
  else if (arg === '--fast') opts.fast = true;
  else if (arg === '--depth') opts.depth = next();
  else if (arg === '--timeout') opts.timeout = next();
  else if (arg === '--preflight-only') opts.preflightOnly = true;
}

function fail(code, message, detail) {
  console.error(`\n❌ ${message}`);
  if (detail) console.error(detail);
  process.exit(code);
}

// ---------------------------------------------------------------------------------------
// --preflight-only — answer "could agy do this flow" once, for the whole flow
// ---------------------------------------------------------------------------------------
//
// Handled before the argument validation below because it deliberately answers a smaller
// question: it needs only --flow, never --mode, and it reaches nothing outside the local
// filesystem. The conductor calls it once at the top of a flow instead of rediscovering the
// same answer on every screen — and it must be cheap enough that calling it is never a
// reason to skip it.
if (opts.preflightOnly) {
  if (!opts.flow) fail(1, 'Pass --flow <design flow directory>.');
  const report = preflightAgyDesign({ flowDir: resolve(opts.flow.replace(/\/+$/, '')) });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 2);
}

if (!['discovery', 'screen'].includes(opts.mode)) {
  fail(1, 'Pass --mode discovery or --mode screen.');
}
if (!opts.flow) fail(1, 'Pass --flow <design flow directory>.');
if (opts.mode === 'discovery' && !opts.figmaUrl) fail(1, 'Discovery needs --figma-url.');
if (opts.mode === 'screen' && (!opts.nodeId || !opts.slug)) {
  fail(1, 'Screen extraction needs --node-id and --slug.');
}
if (opts.mode === 'screen' && !opts.fileKey && !opts.figmaUrl) {
  fail(1, 'Screen extraction needs --file-key (or --figma-url to derive it).');
}

// Absolute throughout. agy resolves a relative path against its own workspace rather than
// this process's directory, so a relative flow path can land the output in another project
// entirely — observed, not theorised.
const FLOW = resolve(opts.flow.replace(/\/+$/, ''));

// ---------------------------------------------------------------------------------------
// Preflight — decide before spending a single token
// ---------------------------------------------------------------------------------------
//
// The order here is deliberate. The Figma token is checked now, because both modes read
// Figma and neither can do anything without it. The agy preflight is NOT checked now: it
// waits until the screen-mode branch, because discovery is pure REST plus Node and exits
// before agy is ever invoked. Demanding the binary up front refused work that would have
// succeeded — a machine without agy could not even list the screens in a flow.

if (!readToken()) {
  console.error('\n⚠️  No Figma token, so there is nothing for either engine to read.');
  console.error('   Set FIGMA_API_KEY, or put it in ~/.config/beer-kit/figma.env.\n');
  process.exit(2);
}

const { model, warnings: modelWarnings, error: modelError } = resolveModel({
  requested: opts.model,
  fast: opts.fast
  // rejectClaude stays off: extraction is not a cross-model check, so a Claude model here
  // is a legitimate (if pointless) choice rather than a defeated purpose.
});
if (modelError) fail(1, modelError);
for (const w of modelWarnings) console.warn(`\n⚠️  ${w}\n`);

const allowRules = requiredAllowRules(FLOW);

console.log(`[design-extract-agy] mode=${opts.mode} model=${model}`);
console.log(`  Figma:  REST API (scripts/figma-cli.mjs)`);
console.log(`  Flow:   ${FLOW}`);

// ---------------------------------------------------------------------------------------
// Prompt — the methodology is the skill's, not this script's
// ---------------------------------------------------------------------------------------

const SKILL_DIR = resolve(__dirname, '..');

/**
 * Read a bk-design reference, or return '' when it is missing.
 *
 * The references are the contract the claude engine follows. Sending the same text to agy
 * is what keeps the two engines producing the same design.md — restating the rules here
 * would create a second, quietly diverging specification.
 *
 * @param {string} name
 * @returns {string}
 */
function reference(name) {
  const path = join(SKILL_DIR, 'references', name);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const SKILL_MD = existsSync(join(SKILL_DIR, 'SKILL.md'))
  ? readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
  : '';

// ---------------------------------------------------------------------------------------
// Fetch — deterministic, in Node, before the model is involved at all
// ---------------------------------------------------------------------------------------

const client = new FigmaRest();

/**
 * Serve this file's responses from the on-disk cache, scoped to the version it is at now.
 *
 * The agy path refetches every screen of a flow on every run, which is the same waste the
 * CLI path had. One depth=1 metadata call decides whether the cached copies still describe
 * the current design; a probe that fails simply means no cache, never a stale spec.
 *
 * @param {string} fileKey
 * @returns {Promise<void>}
 */
async function attachCache(fileKey) {
  if (process.env.BK_FIGMA_NO_CACHE) return;
  try {
    const { version } = await client.getFileMeta(fileKey);
    if (!version) return;
    client.cache = new FigmaCache({ fileKey, version });
    sweepCache();
  } catch (_) { /* no cache this run */ }
}
const rawDir = join(FLOW, opts.mode === 'discovery' ? 'raw' : `${opts.slug}/raw`);
mkdirSync(rawDir, { recursive: true });

/**
 * Write one fetched artefact and report where it went.
 *
 * @param {string} name
 * @param {any} data
 * @returns {string} the path written
 */
function writeArtefact(name, data) {
  const path = join(rawDir, name);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return path;
}

let prompt;
let schemaName;

if (opts.mode === 'discovery') {
  const { fileKey, nodeId } = parseFigmaUrl(opts.figmaUrl);
  if (!fileKey || !nodeId) fail(1, `Could not parse a file key and node id from ${opts.figmaUrl}`);
  await attachCache(fileKey);

  const fetched = await client.getNodes(fileKey, [nodeId], 2);
  const root = fetched[nodeId]?.document;
  if (!root) fail(1, `Node ${nodeId} not found in file ${fileKey}`);

  const isSingle = root.type === 'FRAME';
  const screens = (isSingle ? [root] : frameChildren(root)).map((frame, i) => ({
    nodeId: frame.id,
    slug: slugify(frame.name, i + 1, frame.id),
    name: frame.name,
    width: frame.absoluteBoundingBox?.width ?? null,
    height: frame.absoluteBoundingBox?.height ?? null
  }));
  const duplicates = duplicateNames(screens);

  // Discovery has no judgement in it — parse, filter, slugify — so the model is not asked
  // to do it. Handing this to a model would only add a way for the screen list to be wrong.
  const discovery = {
    source: { figma_url: opts.figmaUrl, file_key: fileKey, section_node_id: nodeId, section_name: root.name },
    detection: { mode: root.type, total_children: (root.children || []).length, frame_count: screens.length },
    warnings: duplicates.length
      ? [{ code: 'duplicate_frame_names',
           message: `${duplicates.reduce((n, d) => n + d.count, 0)} of ${screens.length} frames share a name.`,
           duplicates }]
      : [],
    screens
  };
  writeFileSync(join(FLOW, 'raw', 'discovery.json'), JSON.stringify(discovery, null, 2) + '\n', 'utf8');

  const contracts = { components: fetched[nodeId]?.components || {},
                      componentSets: fetched[nodeId]?.componentSets || {} };
  writeFileSync(join(FLOW, 'raw', 'component-contracts.json'), JSON.stringify(contracts, null, 2) + '\n', 'utf8');

  console.log(`  Screens: ${screens.length} (${discovery.detection.mode})`);
  for (const warning of discovery.warnings) console.warn(`  ⚠️  ${warning.message}`);

  // Nothing is left for the model to do, so nothing is sent to it.
  console.log(`\n✅ DONE: discovery via REST → raw/discovery.json, raw/component-contracts.json`);
  process.exit(0);
}

// --- screen mode -------------------------------------------------------------------------

// This is the first line of this run that actually needs agy, so it is the first line that
// asks for it. The full design preflight is used rather than the binary probe alone: a
// missing allow-rule is just as fatal as a missing binary, and finding it here costs one
// file read, while finding it later costs a whole run that is auto-denied after the model
// has already been paid for.
const pre = preflightAgyDesign({ flowDir: FLOW });
if (!pre.ok) {
  console.error(`\n⚠️  agy cannot run this extraction: ${pre.reason}`);
  if (pre.remedy) console.error(`   ${pre.remedy}`);
  if (pre.snippet) console.error(`\n${pre.snippet}\n`);
  console.error('   Falling back to the claude engine is the correct outcome here.\n');
  process.exit(2);
}

const fileKey = opts.figmaUrl ? parseFigmaUrl(opts.figmaUrl).fileKey : opts.fileKey;
if (!fileKey) fail(1, 'Screen extraction needs --file-key or --figma-url.');
await attachCache(fileKey);

const fetched = await client.getNodes(fileKey, [opts.nodeId]);
const entry = fetched[opts.nodeId];
if (!entry?.document) fail(1, `Node ${opts.nodeId} not found in file ${fileKey}`);

const nodeDepth = opts.depth ? Number(opts.depth) : DEFAULT_NODE_DEPTH;

const artefacts = [
  // Depth-limited by default: one real screen serialises to 3.1 MB unpruned, which no model
  // can read. Truncated branches announce themselves, and the deep detail that matters most
  // — every text string, every instance — is carried in full by the files beside this one.
  writeArtefact('node.json', serializeNode(entry.document, { depth: nodeDepth })),
  writeArtefact('text.json', textNodes(entry.document)),
  writeArtefact('components.json', {
    components: entry.components || {},
    componentSets: entry.componentSets || {},
    instances: searchInstances(entry.document)
  }),
  writeArtefact('styles.json', entry.styles || {}),
  // Walked at full depth on purpose — see assetCandidates.
  writeArtefact('asset-candidates.json', assetCandidates(entry.document))
];

try {
  artefacts.push(writeArtefact('variables.json', await client.getLocalVariables(fileKey)));
} catch (err) {
  // Normal, not a failure: the Variables API needs file_variables:read and a Figma
  // Enterprise plan. The spec falls back to style names and raw values.
  console.warn('  ⚠️  Variables API unavailable — tokens come from styles.json and raw values.');
}

// The screenshot is fetched here too, for the same reason as everything else: a model
// cannot losslessly save a binary it merely saw.
try {
  const urls = await client.getImageUrls(fileKey, [opts.nodeId], { format: 'png', scale: 2 });
  const url = urls[opts.nodeId];
  if (url) await figma.downloadImage(url, join(FLOW, opts.slug, 'screenshot.png'));
  else console.warn('  ⚠️  Figma returned no screenshot for this node.');
} catch (err) {
  console.warn(`  ⚠️  Screenshot failed: ${err.message}`);
}

console.log(`  Fetched: ${artefacts.length} artefacts → ${rawDir}`);

const TOOLS_PREAMBLE = `## Tools

Everything you need has already been fetched and is on disk. Use:
- read_file — to read the JSON under ${rawDir}/
- write_file — to write your output under ${FLOW}/${opts.slug}/

Do NOT run shell commands and do NOT try to reach Figma; neither permission is granted, and
neither is needed. The data is already here.

`;

prompt = `${TOOLS_PREAMBLE}You are writing a design spec for ONE screen from data already fetched from Figma.

Screen nodeId: ${opts.nodeId}
Screen slug:   ${opts.slug}
Tech stack:    ${opts.techStack || 'unspecified'}

Input files (read these):
- ${rawDir}/node.json       — the node tree, pruned to spec-relevant fields
- ${rawDir}/text.json       — every text node, with characters verbatim
- ${rawDir}/components.json — component masters, sets, and the instances on this screen
- ${rawDir}/styles.json     — style ids resolved to names
- ${rawDir}/asset-candidates.json — every icon/image node on the screen, walked at full
  depth. node.json is depth-limited and does NOT reach these, so Section 8 and assets.json
  must be built from this file.
- ${rawDir}/variables.json  — design tokens with modes, when the plan allows the API

Follow this methodology exactly — it is the same contract the other engine is held to:

${SKILL_MD}

## design.md format (authoritative)

${reference('design-md-format.md')}

## Extraction workflow

${reference('extraction-workflow.md')}

Write two files, using these ABSOLUTE paths exactly:
- ${join(FLOW, opts.slug, 'design.md')}   (all 9 sections)
- ${join(FLOW, opts.slug, 'assets.json')}

The design.md format below is a TEMPLATE describing the required structure. Do not copy its
title or its example values — the document you write is about this screen, so its first line
is "# ${opts.slug}".

assets.json must be an object, not a bare array:
{"screen": "${opts.slug}", "assets": [{"name": "ic-...", "nodeId": "...", "format": "PDF|SVG|PNG", "rendering": "template|original"}]}

The screenshot has already been saved for you; do not attempt to create it.
Copy text from text.json verbatim — never retype it, especially Vietnamese diacritics.

Then reply with the assets.json content as your final answer, matching the required schema.`;

schemaName = 'assets.schema.json';

const schemaFile = join(__dirname, 'schemas', schemaName);

// ---------------------------------------------------------------------------------------
// Invoke
// ---------------------------------------------------------------------------------------

// NDJSON, one message per line. The key is `event`, not `type` — see gemini-review.mjs,
// where a wrong shape was rejected with input_tokens: 0.
const streamMessage = JSON.stringify({
  event: 'user',
  message: { role: 'user', content: [{ type: 'text', text: prompt }] }
}) + '\n';

// `-p` swallows the following token as its value, so the attached `-p=` form is required
// when the prompt arrives on stdin.
const agyArgs = [
  '-p=',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--model', model,
  '--mode', 'accept-edits',
  '--add-dir', FLOW,
  '--print-timeout', opts.timeout,
  ...(existsSync(schemaFile) ? ['--json-schema', schemaFile] : [])
];

const child = spawn(pre.binary, agyArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
let stdoutData = '';
let stderrData = '';

child.stdin.on('error', () => { /* agy closed stdin early; the result event still explains why */ });
child.stdin.end(streamMessage, 'utf8');
child.stdout.on('data', (c) => { stdoutData += c.toString(); });
child.stderr.on('data', (c) => { stderrData += c.toString(); });

const exitCode = await new Promise((res) => child.on('close', res));

// A denial is the failure this runner exists to explain well. Headless agy cannot prompt,
// so an un-approved tool is auto-denied and the run returns SUCCESS with nothing done.
const denial = classifyDenial(stderrData);
if (denial === 'allowable') {
  console.error('\n❌ agy denied a tool it needed, because headless mode cannot ask.');

  // Show the path agy actually asked for. Without it the user is left comparing a rule they
  // wrote against a path they cannot see — and agy resolves paths against its own workspace,
  // so the path it asked for is frequently not the one they expect.
  // Both streams are searched: agy reports step-level tool errors on stderr, while the
  // result event arrives on stdout. Looking in only one is how this diagnostic came up empty
  // the first time.
  const denied = [...new Set(
    (`${stderrData}\n${stdoutData}`.match(/permission check failed for [a-z_]+ "([^"]+)"/g) || [])
      .map((line) => line.replace(/^.*"([^"]+)".*$/, '$1'))
  )];
  if (denied.length) {
    console.error('   agy asked to write:');
    for (const path of denied) console.error(`     ${path}`);
  }

  console.error(`\n   Add these rules to ${AGY_SETTINGS_PATH} and re-run:\n`);
  console.error(allowRulesSnippet(allowRules));
  console.error('\n   The kit does not edit that file for you: it is shared with every other');
  console.error('   agy session on this machine, and widening its own permissions is not');
  console.error('   something a tool should do quietly.');
  const note = stderrData.split('\n').find((line) => /auto-denied/.test(line));
  if (note) console.error(`\n   agy said: ${note.trim().slice(0, 300)}`);
  console.error('');
  process.exit(3);
}
if (denial === 'unallowable') {
  console.error('\n❌ agy denied a tool that allow-rules cannot cover.');
  console.error('   The only override is --dangerously-skip-permissions, which auto-approves');
  console.error('   every tool including shell commands on your repo. This kit does not pass');
  console.error('   it. Use the claude engine for this run.\n');
  process.exit(2);
}

// ---------------------------------------------------------------------------------------
// Verify what actually landed on disk
// ---------------------------------------------------------------------------------------
//
// The model's own account of its work is not evidence. Only files are — which is also how
// the design workflow post-verifies the claude engine, so both engines are judged the same.
//
// That applies to the exit code too, which is the CLI's account rather than the model's but
// is still not the work. A real run wrote a complete, correct spec and then exited 1; failing
// on the code alone would have thrown away finished work. So the contract is checked first,
// and the exit code only decides what to say about a run that did NOT meet it.

// Screen mode is the only path that reaches here; discovery needs no model and exits above.
const expected = [
  join(FLOW, opts.slug, 'design.md'),
  join(FLOW, opts.slug, 'assets.json')
];

const missing = expected.filter((f) => !existsSync(f));
if (missing.length > 0) {
  fail(3, exitCode === 0
        ? 'agy reported success but did not write the expected files.'
        : `agy exited with code ${exitCode} and did not write the expected files.`,
    [...missing.map((f) => `   missing: ${f}`),
     stderrData.trim() ? `   agy said: ${stderrData.trim().split('\n').pop().slice(0, 300)}` : '']
      .filter(Boolean).join('\n'));
}

// assets.json feeds the export pipeline directly, so a wrong shape here fails later and
// somewhere else. The first real run returned a bare `[]`, which passed an existence check.
try {
  const assets = JSON.parse(readFileSync(join(FLOW, opts.slug, 'assets.json'), 'utf8'));
  if (Array.isArray(assets) || !Array.isArray(assets?.assets)) {
    fail(3, 'assets.json must be an object with an `assets` array.',
      `   Got: ${JSON.stringify(assets).slice(0, 120)}`);
  }
} catch (err) {
  if (err.name === 'SyntaxError') fail(3, `assets.json is not valid JSON: ${err.message}`);
  throw err;
}

// A design.md that is missing sections is worse than no design.md: it looks finished.
const designMd = readFileSync(join(FLOW, opts.slug, 'design.md'), 'utf8');
const sections = (designMd.match(/^##\s+\d\./gm) || []).length;
if (sections < 9) {
  fail(3, `design.md has ${sections} of the 9 required sections.`,
    '   Re-run, then fall back to the claude engine.');
}

if (exitCode !== 0) {
  console.warn(`\n⚠️  agy exited with code ${exitCode}, but the output meets the contract. `
    + 'Keeping it.');
}

console.log(`\n✅ DONE: ${opts.mode} via agy → ${expected.map((f) => f.replace(`${FLOW}/`, '')).join(', ')}`);
