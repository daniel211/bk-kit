/**
 * untracked-fix-command.cjs - the one command that folds forgotten untracked files into a commit.
 *
 * post-commit used to say "if any belong to this commit it did not capture them" and leave the
 * model to work out what to run. The field (X-Game-Pro, fusionworkomni: 49 signals) shows it
 * mostly did not: Swift source, its tests and the plan dir stayed untracked after the commit.
 * Pure: strings in, strings out.
 */

'use strict';

// Paths that must never be put in a suggested `git add` (secrets / key material).
const SECRET_PATH = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|keystore|jks)|credentials(\..*)?|id_rsa.*)$/i;

/** POSIX single-quote a path so spaces and `+` survive the shell (Swift `Foo+Bar.swift`). */
function shellQuote(p) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string[]} files untracked paths as `git status --porcelain` printed them
 * @param {{ skip?: (f: string) => boolean, max?: number }} [opts] skip = collapsed dirs that also hold state
 * @returns {{ command: string|null, stageable: string[], withheld: string[] }}
 */
function buildFixCommand(files, opts = {}) {
  const max = opts.max || 12;
  const withheld = [];
  const stageable = [];
  for (const f of files) {
    if (SECRET_PATH.test(f.replace(/\/$/, '')) || (opts.skip && opts.skip(f))) withheld.push(f);
    else stageable.push(f);
  }
  if (!stageable.length) return { command: null, stageable, withheld };
  const shown = stageable.slice(0, max);
  const command = `git add -- ${shown.map(shellQuote).join(' ')}` +
    (stageable.length > max ? ' # + remaining files from git status' : '') +
    ' && git commit --amend --no-edit';
  return { command, stageable, withheld };
}

module.exports = { buildFixCommand, shellQuote };
