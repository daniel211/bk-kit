---
name: bk-worktree
description: "Create isolated git worktree for parallel development in monorepos and mobile projects."
argument-hint: "[feature-description] OR [project] [feature]"
---

# Git Worktree

Create an isolated git worktree for parallel feature development.

## Workflow

### Step 1: Get Repo Info

```bash
node scripts/worktree.cjs info --json
```

Parse JSON response for: `repoType`, `baseBranch`, `projects`, `worktreeRoot`, `worktreeRootSource`.

### Step 2: Detect Branch Prefix

From user's description:
- "fix", "bug", "error", "issue", "crash", "ANR" → `fix`
- "refactor", "restructure", "rewrite" → `refactor`
- "docs", "documentation", "readme" → `docs`
- "test", "spec", "coverage" → `test`
- "chore", "cleanup", "deps" → `chore`
- "perf", "performance", "optimize" → `perf`
- "screen", "view", "widget", "component", "composable" → `feat`
- Default → `feat`

### Step 3: Convert to Slug

"add authentication system" → `add-auth`
"fix login bug" → `login-bug`
Max 50 chars, kebab-case.

### Step 4: Handle Monorepo

If `repoType === "monorepo"` and project not specified, use AskUserQuestion:
```javascript
AskUserQuestion({
  questions: [{
    header: "Project",
    question: "Which project for the worktree?",
    options: projects.map(p => ({ label: p.name, description: p.path })),
    multiSelect: false
  }]
})
```

### Step 5: Execute

**Monorepo:**
```bash
node scripts/worktree.cjs create "<PROJECT>" "<SLUG>" --prefix <TYPE>
```

**Standalone:**
```bash
node scripts/worktree.cjs create "<SLUG>" --prefix <TYPE>
```

**Options:**
- `--prefix` - Branch type: feat|fix|refactor|docs|test|chore|perf
- `--worktree-root <path>` - Override default location (only if needed)
- `--json` - JSON output
- `--dry-run` - Preview

### Step 6: Install Dependencies

Based on project context, run in background:
- `bun.lock` → `bun install`
- `pnpm-lock.yaml` → `pnpm install`
- `yarn.lock` → `yarn install`
- `package-lock.json` → `npm install`
- `poetry.lock` → `poetry install`
- `requirements.txt` → `pip install -r requirements.txt`
- `Cargo.toml` → `cargo build`
- `go.mod` → `go mod download`
- `Podfile` → `pod install`
- `build.gradle` / `build.gradle.kts` → `./gradlew build`
- `pubspec.yaml` → `flutter pub get`

## Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `create` | `create [project] <feature>` | Create worktree |
| `finish` | `finish <name-or-path> [--no-merge] [--keep-branch]` | Merge the worktree's commits back into the current branch, then remove it |
| `remove` | `remove <name-or-path>` | Remove worktree (discards uncommitted changes; keeps an unmerged branch) |
| `info` | `info` | Repo info with worktree location |
| `list` | `list` | List worktrees |

## Finishing a worktree

Work done in a worktree lives on its own branch and is invisible in the main checkout
until something merges it. `finish` closes that loop:

```bash
node worktree.cjs finish <name> [--dry-run]
```

It refuses rather than guesses. An uncommitted change in the worktree, an uncommitted
change to a *tracked* file in the main checkout, or a branch with nothing the current
branch lacks each stop the command and say why. Untracked files in the main checkout are
ignored on purpose — the kit's own worktrees live under `.claude/worktrees/`, which would
otherwise leave every project permanently "dirty".

- `--no-merge` — remove the worktree and keep its branch, when the work should not land yet
- `--keep-branch` — merge, remove the worktree, keep the branch
- `--force` — merge even when the branch belongs to another lineage (see below)

### Which branch a worktree starts from

`create` branches from the branch you are on. Pass `--base <branch>` to start somewhere
else deliberately; a detached HEAD falls back to `dev`/`develop`/`main`/`master`.

This used to work the other way round — the base was the first of those conventional
branches that existed, whatever branch you were standing on. In a repository with a
`develop` branch, a worktree created from `release/golive-3.4.4` was cut from `develop`
and carried 160 unrelated commits, which is what made `finish` dangerous in the first
place.

### When the branch came from somewhere else

A worktree branch is meant to carry the work done in that worktree. If it carries more
than 20 commits the current branch lacks, `finish` stops: the branch was cut from a
different base, and merging it would bring that whole history along.

This is not hypothetical. A `/bk-bootstrap` run created its worktree from `origin/develop`
while the developer was on `release/golive-3.4.4`. The branch held one documentation commit
**and 160 commits of develop touching 747 files** — `.gitignore`, the Xcode project,
localisation strings. Merging it into a release branch days before go-live would have been
an incident, and nothing in the command's name hints that it might.

When that happens, take only what the worktree produced:

```bash
git checkout <branch> -- bk/docs/foundation
node worktree.cjs finish <name> --no-merge
```

`--force` merges anyway, once you know what it brings.

**Always prefer `finish` over `remove` after an agent has worked in a worktree.** `remove`
discards uncommitted changes and leaves an unmerged branch behind without saying where the
work went — which is how a `/bk-bootstrap` run once finished "successfully" with seven
generated documents stranded on a branch nobody looked at.

## Notes

- Script auto-detects superproject, monorepo, and standalone repos
- Default worktree location is smart: superproject > monorepo > sibling
- Use `--worktree-root` only to override defaults
- Env templates (`.env*.example`) auto-copied with `.example` suffix removed
- Mobile config templates also auto-copied: `.xcconfig.example` → `.xcconfig`, `local.properties.example` → `local.properties`
