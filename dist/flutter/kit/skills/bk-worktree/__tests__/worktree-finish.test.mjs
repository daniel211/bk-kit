/**
 * worktree-finish.test.mjs — Integration tests for `worktree.cjs finish`.
 *
 * These run against real git repositories. The command's whole job is reasoning about
 * branches, merge-bases and worktrees, and a mocked git would only prove the mock agrees
 * with itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'worktree.cjs');

/** Run a git command in `cwd`, throwing on failure. */
function git(cwd, cmd) {
  return execFileSync('git', cmd.split(' '), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Run worktree.cjs, capturing output whether it exits 0 or not. */
function runFinish(cwd, args) {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, 'finish', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

/** A repo with one commit on `main`. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'bk-wt-'));
  git(root, 'init -q -b main');
  git(root, 'config user.email test@example.com');
  git(root, 'config user.name Test');
  writeFileSync(join(root, 'README.md'), 'base\n');
  git(root, 'add -A');
  git(root, 'commit -qm init');
  return root;
}

/** Add a worktree with one commit in it. `base` defaults to the current branch. */
function addWorktreeWithWork(root, name, file, base = '') {
  git(root, `worktree add -q .wt/${name} -b worktree-${name}${base ? ` ${base}` : ''}`);
  const wt = join(root, '.wt', name);
  mkdirSync(join(wt, 'docs'), { recursive: true });
  writeFileSync(join(wt, 'docs', file), '# generated\n');
  git(wt, 'add -A');
  git(wt, 'commit -qm docs');
}

test('finish: brings a worktree branch home and cleans up', () => {
  const root = makeRepo();
  try {
    addWorktreeWithWork(root, 'foundation', 'architecture.md');
    const { code, out } = runFinish(root, ['foundation']);

    assert.equal(code, 0, out);
    assert.ok(existsSync(join(root, 'docs', 'architecture.md')), 'the work must land in the main checkout');
    assert.equal(git(root, 'worktree list').trim().split('\n').length, 1, 'worktree removed');
    assert.equal(git(root, 'branch --list worktree-foundation').trim(), '', 'merged branch deleted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finish: refuses a branch cut from another lineage', () => {
  // The real case: /bk-bootstrap created a worktree from origin/develop while the
  // developer stood on a release branch. The branch held one docs commit and 160 commits
  // of develop across 747 files; merging it would have emptied develop into the release.
  const root = makeRepo();
  try {
    git(root, 'checkout -q -b develop');
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(root, `f${i}.swift`), `${i}\n`);
      git(root, 'add -A');
      git(root, `commit -qm dev${i}`);
    }
    git(root, 'checkout -q main');
    git(root, 'checkout -q -b release');
    addWorktreeWithWork(root, 'foundation', 'architecture.md', 'develop');

    const { code, out } = runFinish(root, ['foundation']);

    assert.equal(code, 1, 'must not merge an unrelated lineage by default');
    assert.match(out, /BRANCH_FROM_ANOTHER_LINEAGE/);
    assert.match(out, /26 commits/, 'says how much would come in');
    assert.match(out, /git checkout worktree-foundation -- /, 'offers the targeted alternative');
    assert.ok(!existsSync(join(root, 'f0.swift')), 'the unrelated work must not have landed');
    assert.equal(git(root, 'branch --list worktree-foundation').trim() === '', false, 'branch is left intact');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finish --force: merges a divergent branch when asked explicitly', () => {
  const root = makeRepo();
  try {
    git(root, 'checkout -q -b develop');
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(root, `f${i}.swift`), `${i}\n`);
      git(root, 'add -A');
      git(root, `commit -qm dev${i}`);
    }
    git(root, 'checkout -q main');
    addWorktreeWithWork(root, 'foundation', 'architecture.md', 'develop');

    const { code } = runFinish(root, ['foundation', '--force']);
    assert.equal(code, 0);
    assert.ok(existsSync(join(root, 'docs', 'architecture.md')));
    assert.ok(existsSync(join(root, 'f0.swift')), '--force accepts the whole lineage');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finish --no-merge: removes the worktree and keeps the branch holding the work', () => {
  const root = makeRepo();
  try {
    addWorktreeWithWork(root, 'spare', 'notes.md');
    const { code, out } = runFinish(root, ['spare', '--no-merge']);

    assert.equal(code, 0, out);
    assert.equal(git(root, 'worktree list').trim().split('\n').length, 1, 'worktree removed');
    assert.ok(!existsSync(join(root, 'docs', 'notes.md')), 'nothing merged');
    assert.match(git(root, 'branch --list worktree-spare'), /worktree-spare/,
      'the branch is the only thing still holding the work, so it must survive');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finish: refuses when the worktree has uncommitted changes', () => {
  const root = makeRepo();
  try {
    addWorktreeWithWork(root, 'dirty', 'a.md');
    writeFileSync(join(root, '.wt', 'dirty', 'docs', 'a.md'), '# edited, not committed\n');

    const { code, out } = runFinish(root, ['dirty']);
    assert.equal(code, 1);
    assert.match(out, /WORKTREE_DIRTY/);
    assert.equal(git(root, 'worktree list').trim().split('\n').length, 2, 'worktree left in place');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finish: the kit\'s own telemetry does not count as uncommitted work', () => {
  // Hooks write .bk-metrics/ into whichever tree they run in, so a kit-created worktree is
  // untracked-dirty the moment an agent works in it. Treating that as user work made
  // `finish` impossible on exactly the worktrees the kit creates — the same self-defeating
  // check that had to be relaxed for the main checkout.
  const root = makeRepo();
  try {
    addWorktreeWithWork(root, 'feat', 'a.md');
    const wt = join(root, '.wt', 'feat');
    mkdirSync(join(wt, '.bk-metrics'), { recursive: true });
    writeFileSync(join(wt, '.bk-metrics', 'violations.jsonl'), '{}\n');

    const { code, out } = runFinish(root, ['feat']);
    assert.equal(code, 0, out);
    assert.ok(existsSync(join(root, 'docs', 'a.md')), 'the work still lands');
    assert.equal(git(root, 'worktree list').trim().split('\n').length, 1, 'worktree removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finish: an untracked file the user wrote still blocks', () => {
  // The relaxation must not become "ignore everything untracked".
  const root = makeRepo();
  try {
    addWorktreeWithWork(root, 'feat', 'a.md');
    const wt = join(root, '.wt', 'feat');
    mkdirSync(join(wt, '.bk-metrics'), { recursive: true });
    writeFileSync(join(wt, '.bk-metrics', 'violations.jsonl'), '{}\n');
    writeFileSync(join(wt, 'important.swift'), 'let x = 1\n');

    const { code, out } = runFinish(root, ['feat']);
    assert.equal(code, 1);
    assert.match(out, /WORKTREE_DIRTY/);
    assert.equal(git(root, 'worktree list').trim().split('\n').length, 2, 'worktree left alone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
