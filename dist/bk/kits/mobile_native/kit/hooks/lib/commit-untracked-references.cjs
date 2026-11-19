/**
 * commit-untracked-references.cjs - which still-untracked files does the just-made commit use?
 *
 * post-commit already warns that files are untracked after a commit, but in a multi-commit
 * sequence every commit has legitimately-later untracked files, so that warning cannot tell
 * "lands in the next commit" from "forgotten, and this commit depends on it". X-Game-Pro
 * KAN-46: five sequential commits, `ParticipantSignal.swift` left untracked until the last one,
 * so the earlier commit using `ParticipantSignal` did not build alone and the PR was not
 * bisectable.
 *
 * This answers the sharper question: does anything this commit ADDED mention the file's
 * identifier (its stem), word-boundary matched? One `git show HEAD -U0` supplies the added
 * lines per changed file; that is language-agnostic (Swift/Kotlin/Dart/TS), skips binaries
 * (git prints no hunks for them) and is bounded by MAX_DIFF_BYTES and MAX_FILES.
 *
 * Advisory only: every failure returns an empty result.
 */

'use strict';

const path = require('path');

const MAX_FILES = 30;               // untracked candidates checked
const MAX_DIFF_BYTES = 1024 * 1024; // diff text scanned
const MIN_STEM = 4;

// Names too common to prove a dependency (a `main` or `utils` appears in every commit).
const GENERIC_STEMS = new Set([
  'index', 'main', 'utils', 'util', 'helpers', 'helper', 'types', 'type', 'mod', 'app', 'readme',
  'test', 'tests', 'spec', 'specs', 'constants', 'config', 'common', 'base', 'model', 'models',
  'view', 'views', 'init', 'setup', 'license', 'changelog', 'package', 'build', 'extensions',
  'extension', 'strings', 'colors', 'styles', 'theme', 'data', 'core', 'shared', 'mock', 'mocks',
]);

// A commit that only mentions a name in prose or data is not a build dependency.
const NON_CODE_EXT = new Set(['.md', '.markdown', '.txt', '.json', '.lock', '.yml', '.yaml', '.csv', '.log']);

/** Identifier a source file defines: basename up to the first dot (`Foo.g.dart` -> `Foo`). */
function stemOf(file) {
  return path.basename(file).split('.')[0];
}

/** null when the stem proves nothing (too short / generic), else 'ident' or 'plain'. */
function classifyStem(stem) {
  if (!stem || stem.length < MIN_STEM) return null;
  if (GENERIC_STEMS.has(stem.toLowerCase())) return null;
  // Distinctive identifier: CamelCase, snake_case, kebab-case, digits. A plain lowercase word
  // ("login") also appears in ordinary code and prose, so it must look like a path/module ref.
  return /^[A-Z]|[_\-0-9]|[a-z][A-Z]/.test(stem) ? 'ident' : 'plain';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function stemRegex(stem, kind) {
  const e = escapeRe(stem);
  if (kind === 'plain') return new RegExp(`(?:^|[\\/'"\`])${e}(?:\\.[A-Za-z]+)?(?:['"\`]|$)`, 'm');
  return new RegExp(`(?<![A-Za-z0-9_])${e}(?![A-Za-z0-9_])`);
}

/** Added lines per changed file of `HEAD`: Map<file, string>. Bounded by MAX_DIFF_BYTES. */
function addedLinesByFile(cwd, execSync) {
  const out = execSync('git show HEAD --format= --no-color --no-ext-diff -U0', {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    cwd: cwd || undefined, timeout: 3000, maxBuffer: MAX_DIFF_BYTES * 4,
  });
  const files = new Map();
  let current = null;
  let scanned = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) {
      const m = line.match(/^\+\+\+ b\/(.+)$/);
      current = m ? m[1] : null;
      if (current) files.set(current, '');
      continue;
    }
    if (current && line.startsWith('+')) {
      scanned += line.length;
      if (scanned > MAX_DIFF_BYTES) break;
      files.set(current, files.get(current) + line.slice(1) + '\n');
    }
  }
  return files;
}

/**
 * @param {string[]} untracked  untracked paths (repo-relative; `dir/` entries are expanded)
 * @param {string} [cwd]
 * @returns {{referenced: {file: string, usedBy: string[]}[], checked: number}}
 */
function findReferencedUntracked(untracked, cwd) {
  const result = { referenced: [], checked: 0 };
  try {
    const { execSync } = require('child_process');
    // git collapses a wholly-untracked directory to one `dir/` line; a new feature folder is
    // exactly where the missed file lives, so list its files (bounded).
    const flat = [];
    for (const f of untracked || []) {
      if (flat.length >= MAX_FILES * 2) break;
      if (!f.endsWith('/')) { flat.push(f); continue; }
      try {
        const listed = execSync('git ls-files --others --exclude-standard -- ' + JSON.stringify(f), {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
          cwd: cwd || undefined, timeout: 2000, maxBuffer: 256 * 1024,
        });
        for (const l of listed.split('\n')) if (l.trim()) flat.push(l.trim());
      } catch { /* skip this directory */ }
    }
    const candidates = [];
    for (const f of flat) {
      if (candidates.length >= MAX_FILES) break;
      const kind = classifyStem(stemOf(f));
      if (kind) candidates.push({ file: f, stem: stemOf(f), kind });
    }
    result.checked = candidates.length;
    if (!candidates.length) return result;

    const added = addedLinesByFile(cwd, execSync);
    const sources = [...added].filter(([f]) => !NON_CODE_EXT.has(path.extname(f).toLowerCase()));
    if (!sources.length) return result;

    for (const c of candidates) {
      const re = stemRegex(c.stem, c.kind);
      const usedBy = sources.filter(([, text]) => text && re.test(text)).map(([f]) => f);
      if (usedBy.length) result.referenced.push({ file: c.file, usedBy });
    }
  } catch { /* advisory: any git/parse failure means "no finding" */ }
  return result;
}

module.exports = { findReferencedUntracked, classifyStem, stemOf, MAX_FILES, MAX_DIFF_BYTES };
