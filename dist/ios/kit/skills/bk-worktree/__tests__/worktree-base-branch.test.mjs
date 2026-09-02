/**
 * worktree-base-branch.test.mjs — Which branch a new worktree is cut from.
 *
 * Real git repositories again: the behaviour under test is entirely about branch topology.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'worktree.cjs');

function git(cwd, cmd) {
  return execFileSync('git', cmd.split(' '), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function run(cwd, args) {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

/**
 * A repo shaped like the one that exposed this: `develop` well ahead of a release branch,
 * with the developer standing on the release branch.
 */
function makeDivergedRepo() {
  const root = mkdtempSync(join(tmpdir(), 'bk-wtbase-'));
  git(root, 'init -q -b main');
  git(root, 'config user.email test@example.com');
  git(root, 'config user.name Test');
  writeFileSync(join(root, 'README.md'), 'base\n');
  git(root, 'add -A');
  git(root, 'commit -qm init');

  git(root, 'checkout -q -b develop');
  for (let i = 0; i < 25; i++) {
    writeFileSync(join(root, `f${i}.swift`), `${i}\n`);
    git(root, 'add -A');
    git(root, `commit -qm dev${i}`);
  }
  git(root, 'checkout -q main');
  git(root, 'checkout -q -b release/golive');
  writeFileSync(join(root, 'r.md'), 'release\n');
  git(root, 'add -A');
  git(root, 'commit -qm release');
  return root;
}

/** The branch `create` made, i.e. the one that is neither main, develop nor the release. */
function newBranch(root) {
  return git(root, 'branch --format=%(refname:short)')
    .split('\n').map(b => b.trim())
    .find(b => b && !['main', 'develop', 'release/golive'].includes(b));
}

test('create: a worktree is cut from the branch the developer is on', () => {
  // Regression: the base branch was the first of dev/develop/main/master that existed,
  // ignoring the current branch. Standing on release/golive in a repo that has develop
  // produced a worktree carrying all of develop — 160 commits over 747 files in the real
  // case — which `finish` would then have merged into the release branch.
  const root = makeDivergedRepo();
  try {
    const { code } = run(root, ['create', 'foundation', '--worktree-root', join(root, '.wt')]);
    assert.equal(code, 0);

    const branch = newBranch(root);
    assert.ok(branch, 'create must make a branch');
    assert.equal(git(root, `rev-list --count release/golive..${branch}`).trim(), '0',
      'the new branch must start level with the current branch');
    assert.equal(git(root, `rev-list --count develop..${branch}`).trim(), '1',
      'and must not have inherited develop');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('create --base: an explicit base is still honoured', () => {
  const root = makeDivergedRepo();
  try {
    run(root, ['create', 'other', '--base', 'develop', '--worktree-root', join(root, '.wt')]);
    const branch = newBranch(root);
    assert.equal(git(root, `rev-list --count develop..${branch}`).trim(), '0',
      'asking for develop must give develop');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('create: a detached HEAD falls back to a conventional branch', () => {
  const root = makeDivergedRepo();
  try {
    git(root, 'checkout -q --detach HEAD');
    const { code, out } = run(root, ['create', 'det', '--worktree-root', join(root, '.wt')]);
    assert.equal(code, 0, out);
    assert.ok(newBranch(root), 'a branch is still created when there is no current one to inherit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
