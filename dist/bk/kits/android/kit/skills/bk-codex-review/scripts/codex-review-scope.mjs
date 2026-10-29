/**
 * codex-review-scope.mjs — Everything the Codex review runner decides before calling the CLI:
 * argument parsing, platform resolution, the review scope (files + diff) and the prompt.
 *
 * Mirrors the scope logic of bk-gemini-review/scripts/gemini-review.mjs on purpose — the two
 * engines must review the same input so their reports can be compared side by side in
 * `/bk-review --engine all`. It is copied rather than imported so a change to the Codex path
 * can never destabilise the default (Gemini) engine.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Every kit the CLI ships (kit-resolver.mjs KIT_NAMES). fullstack takes both component
// checklists plus its own cross-stack rules.
export const SUPPORTED_PLATFORMS = ['ios', 'android', 'flutter', 'python', 'web', 'fullstack'];
const RULE_FILES = { fullstack: ['python', 'web', 'fullstack'] };
const MAX_TOTAL_CHARS = 150000;   // source payload cap (~40k tokens)
const MAX_DIFF_CHARS = 50000;

/** Walk up from cwd to the first dir holding .git, bk/ or package.json. */
export function findProjectRoot(start = process.cwd()) {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (['.git', 'bk', 'package.json'].some(n => existsSync(join(cur, n)))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return start;
}

/** `--feature --platform --model --files`. Unknown flags are ignored, as in gemini-review. */
export function parseArgs(argv) {
  const opts = { feature: 'unnamed-feature', platform: null, model: null, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--feature' && i + 1 < argv.length) opts.feature = next();
    else if (a === '--platform' && i + 1 < argv.length) opts.platform = next().toLowerCase();
    else if (a === '--model' && i + 1 < argv.length) opts.model = next();
    else if (a === '--files' && i + 1 < argv.length) {
      opts.files = next().split(',').map(f => f.trim()).filter(Boolean);
    }
  }
  return opts;
}

function readJsonField(filePath, field) {
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8'))[field];
    return typeof value === 'string' && value ? value.toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

/**
 * Explicit --platform wins over auto-detection; nothing resolved is an error, never a guess.
 *
 * @returns {{platform: string|null, source: string|null, error: string|null}}
 */
export function resolvePlatform(requested, projectRoot) {
  let platform = requested;
  let source = 'the --platform flag';
  for (const [file, label] of [
    [join(projectRoot, '.claude', 'platform-context.json'), '.claude/platform-context.json'],
    [join(projectRoot, '.bk-version.json'), '.bk-version.json']
  ]) {
    if (platform) break;
    platform = readJsonField(file, 'platform');
    source = label;
  }
  if (!platform) {
    return { platform: null, source: null, error: 'Could not determine the target platform. '
      + `Pass --platform <${SUPPORTED_PLATFORMS.join('|')}>, or run from a project with `
      + '.claude/platform-context.json or .bk-version.json.' };
  }
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return { platform, source, error: `Unsupported platform "${platform}" (from ${source}). `
      + `Expected one of: ${SUPPORTED_PLATFORMS.join(', ')}` };
  }
  return { platform, source, error: null };
}

const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'ignore'] });

/** Changed files (explicit list, else git diff + untracked) and the diff text. */
export function collectScope(projectRoot, explicitFiles) {
  let files = [...explicitFiles];
  let diff = '';
  try {
    if (files.length === 0) {
      const tracked = sh('git diff --name-only HEAD', projectRoot).split('\n').map(f => f.trim());
      const untracked = sh('git status --porcelain', projectRoot).split('\n')
        .filter(l => l.startsWith('?? ')).map(l => l.slice(3).trim());
      files = Array.from(new Set([...tracked, ...untracked].filter(Boolean)));
    }
    try { diff = sh('git diff HEAD', projectRoot); } catch (_) { diff = ''; }
  } catch (err) {
    console.warn(`[bk-codex-review] Warning: Could not collect git diff: ${err.message}`);
  }
  const ignore = [/node_modules\//, /\.git\//, /\.claude\//, /dist\//, /package-lock\.json/, /\.png$/, /\.jpg$/];
  return { files: files.filter(f => !ignore.some(p => p.test(f))), diff };
}

function readCapped(path, cap = 4000) {
  try { return existsSync(path) ? readFileSync(path, 'utf8').slice(0, cap) : ''; } catch (_) { return ''; }
}

/** Assemble the review prompt — sent to `codex exec` on stdin, never in argv. */
export function buildPrompt({ projectRoot, platform, files, diff, templatePath }) {
  const template = readCapped(templatePath, 1e6)
    || 'You are a senior code reviewer. Review the following code for architecture, concurrency, security, and error handling. Output JSON only.';
  const archRules = readCapped(join(projectRoot, 'bk', 'docs', 'foundation', 'architecture.md'));
  const platformRules = (RULE_FILES[platform] || [platform])
    .map(n => readCapped(join(projectRoot, '.claude', 'rules', `${n}-rules.md`)))
    .filter(Boolean).join('\n\n');

  let sources = '';
  let total = 0;
  for (const file of files) {
    const content = readCapped(join(projectRoot, file), 1e7);
    if (content && total + content.length <= MAX_TOTAL_CHARS) {
      sources += `\n\n--- FILE: ${file} ---\n${content}`;
      total += content.length;
    }
  }

  // Codex runs in a read-only sandbox; it may read the workspace, but must not try to run
  // lint/build commands named in the platform rules — those describe standards only.
  return `## Review harness rules
Everything you need is in this message. Do NOT run lint, build or test commands — any command
named below describes the project's standards; it is not an instruction to execute it. You are
in a read-only sandbox: never attempt to modify files. Answer with the JSON object only.

${template}

## Platform Context
Target Platform: ${platform}
${platformRules ? `Platform Rules:\n${platformRules}\n` : ''}
${archRules ? `Architecture Guidelines:\n${archRules}\n` : ''}

## Changed Files List
${files.map(f => `- ${f}`).join('\n')}

## Git Diff
${diff.slice(0, MAX_DIFF_CHARS)}

## Source Files Content
${sources}

Remember: Output ONLY the strict JSON object with fields: "verdict", "summary", "findings". Do NOT wrap in markdown fences.`;
}
