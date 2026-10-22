# Auto-Split Logic

Decision tree and examples for automatically suggesting commit splits in bk-commit Step 3.

## Decision Tree

```
Analyze staged changes
        |
        v
Count change types (feat/fix/refactor/test/docs/chore)
        |
    > 1 type? ──YES──> Suggest split by type
        |
       NO
        |
Count scopes (directories/modules affected)
        |
    > 1 scope? ──YES──> Suggest split by scope
        |
       NO
        |
Config + code mixed? ──YES──> Suggest split (config separate)
        |
       NO
        |
Files > 10 AND unrelated? ──YES──> Suggest split
        |
       NO
        |
   Single commit ✓
```

## Single Commit Conditions (no split needed)

All of the following must be true:
- Same conventional commit type (all feat, or all fix, etc.)
- Same scope (all in same module/directory)
- 3 files or fewer
- 50 lines or fewer total changes

## Split Trigger Rules

| Rule | Condition | Example |
|------|-----------|---------|
| Mixed types | feat + fix in same staged set | New feature + unrelated bug fix |
| Multi-scope | Changes in >1 unrelated module | `src/auth/` + `src/payments/` |
| Config + code | `.json`/`.yaml`/`.plist` + `.swift`/`.ts` | Config change bundled with feature |
| Large batch | >10 files with no single theme | Cleanup + feature + test all at once |
| Test isolation | Test files + source files from different features | Tests for auth + implementation for payments |

## Change Type Detection

Infer commit type from file paths and changes:

| Type | Indicators |
|------|-----------|
| `feat` | New files, new functions, `+` heavy diffs in feature dirs |
| `fix` | Bug-fix keywords in diff, small targeted changes |
| `refactor` | Rename operations, code restructure, no net new behavior |
| `test` | `*Test*`, `*Spec*`, `*_test.*`, `__tests__/` |
| `docs` | `*.md`, `bk/docs/`, comments-only changes |
| `chore` | `package.json`, lockfiles, `.gitignore`, build config |

## Scope Detection

Group files by their top-level module/directory:
```
src/auth/LoginView.swift      → scope: auth
src/auth/AuthService.swift    → scope: auth
src/payments/Cart.swift       → scope: payments
bk/docs/README.md             → scope: docs
```

## Presentation Format

When split is recommended, present to user:

```
Auto-Split Analysis: 3 logical commits detected

  1) feat(auth): add login screen
     Files: src/auth/LoginView.swift, src/auth/LoginViewModel.swift
     Changes: +120 lines

  2) fix(api): handle timeout error
     Files: src/api/NetworkClient.swift
     Changes: +15 lines

  3) docs: update API integration guide
     Files: bk/docs/api-guide.md
     Changes: +8 lines

Options:
  a) Split into 3 commits (recommended)
  b) Single commit with combined message
  c) Custom grouping — I'll describe my preferred split
```

## Single Commit Format (no split)

When changes are cohesive, skip the split suggestion and go directly to approval gate with auto-proposed message:

```
Single commit detected:
  Files: 2 files (+45 lines)
  Suggested: feat(auth): add password validation

Options:
  1) Commit with this message
  2) Edit message
  3) Cancel
```

## Examples

### Example A: Split Recommended

Staged: `src/login/LoginView.swift`, `src/login/LoginModel.swift`, `tests/LoginTests.swift`, `CHANGELOG.md`, `src/profile/ProfileView.swift`

Analysis:
- `src/login/*` → feat(login)
- `tests/LoginTests.swift` → test(login) — keep with feat if same scope
- `CHANGELOG.md` → docs
- `src/profile/ProfileView.swift` → different scope, split out

Suggestion:
1. `feat(login): implement login screen` (login files + tests)
2. `feat(profile): add profile view` (profile file)
3. `docs: update changelog` (CHANGELOG.md)

### Example B: Single Commit

Staged: `src/auth/ResetPasswordView.swift`, `src/auth/ResetPasswordViewModel.swift`

Analysis: Same type (feat), same scope (auth), 2 files, ~60 lines.
Suggestion: `feat(auth): add reset password flow` — single commit.

### Example C: Config + Code Split

Staged: `src/feature/NewFeature.swift`, `Config/AppConfig.plist`, `Config/dev.xcconfig`

Analysis: Code change + config changes — config should be separate.
Suggestion:
1. `feat(feature): add new feature implementation`
2. `chore(config): update app configuration for new feature`
