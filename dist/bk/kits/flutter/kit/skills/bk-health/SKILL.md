---
name: bk-health
description: "Assess project health: dependency freshness, test coverage, code quality, architecture drift. Also provides harness monitoring dashboard and subcommands."
user-invocable: true
argument-hint: "[project-path] [--quick|--deep] | [--dashboard] | [--timeline] | [--ashby] | [--resume] | [--reset-counts]"
---

# Health Check: $ARGUMENTS

## Harness Monitoring Subcommands (H2)

In addition to project health assessment, `bk-health` provides harness monitoring subcommands via the CLI script:

```bash
# Full harness dashboard (violations, decisions, red signals, health score)
node .claude/cli/bk-health/index.cjs --dashboard

# Dashboard with custom time window
node .claude/cli/bk-health/index.cjs --dashboard --last 7d

# Machine-readable JSON output
node .claude/cli/bk-health/index.cjs --dashboard --json

# Event timeline (violations + decisions + red signals sorted by time)
node .claude/cli/bk-health/index.cjs --timeline --last 24h

# Ashby sensor health check (detects silent sensors)
node .claude/cli/bk-health/index.cjs --ashby

# Resume a halted or paused workflow (interactive confirmation)
node .claude/cli/bk-health/index.cjs --resume
node .claude/cli/bk-health/index.cjs --resume --force  # skip confirmation

# Reset phase recurrence + agent dispatch counters
node .claude/cli/bk-health/index.cjs --reset-counts
node .claude/cli/bk-health/index.cjs --reset-counts --agent bk-ios-developer  # single agent
node .claude/cli/bk-health/index.cjs --reset-counts --force  # skip confirmation
```

**Duration formats**: `24h`, `7d`, `30m`

**Files read**:
- `.bk-metrics/violations.jsonl` — security/fsm/privacy violations
- `.bk-metrics/decisions.jsonl` — agent architectural decisions
- `.bk-metrics/red-signals.jsonl` — harness red signals (deadloops, caps)
- `.bk-metrics/workflow-summary.jsonl` — agent workflow summaries
- `.bk-metrics/ashby-warnings.jsonl` — sensor silent warnings
- `bk/dev/shared/.workflow-state.json` — FSM state

**Source**: `src/cli/bk-health/` (runs from source — no build step required)

Assess project health across dependency freshness, test coverage, code quality, and architecture drift.
Output: `bk/docs/health-report.md`

<Use_When>
- User says "health check", "project health", "check dependencies", "audit project"
- Invoked via `/bk-health`
- Called from bk-bootstrap when health signals are detected
</Use_When>

<Do_Not_Use_When>
- User wants code review on specific files — use bk-review instead
- User wants security audit only — use bk-security-auditor instead
</Do_Not_Use_When>

## CRITICAL CONSTRAINTS

- **Read-only** — NEVER modify project code, only write to `bk/docs/health-report.md`
- **Quick mode**: no agent dispatch (inline conductor scan only)
- **Evidence-based**: cite file + line for every finding
- Quick mode target: complete in < 60s

## Workflow

### Step 1: Parse Arguments

Parse `$ARGUMENTS`:
- Extract project path (default: CWD)
- Detect mode flag: `--quick` (default if no flag or < 50 source files) or `--deep`

Auto-detect mode if no flag:
- Project < 50 source files → Quick mode
- Project ≥ 50 source files → Deep mode (unless --quick explicitly set)

### Step 2: Mode Detection

| Flag | Mode | Behavior |
|------|------|----------|
| `--quick` | Quick | Inline conductor scan only, no agent dispatch, < 60s |
| `--deep` | Deep | Dispatch specialized agents for deeper analysis |
| (auto) | Auto | Detect from project size |

### Step 3: Quick Scan (conductor inline, always runs in both modes)

#### 3a. Dependency Freshness
Read lock files and check modification dates:
```
Podfile.lock          → iOS CocoaPods
Package.resolved      → Swift Package Manager
build.gradle.kts      → Android Gradle
pubspec.lock          → Flutter/Dart
package-lock.json     → Node.js
yarn.lock             → Yarn
```
- Stat each file: days since last modified
- Flag: > 180 days old → WARNING
- Flag: > 365 days old → CRITICAL

#### 3b. TODO/FIXME Count
```
Grep("TODO|FIXME|HACK|XXX", source_files)
```
- Count total occurrences
- Group by file (top 5 files with most)
- Flag: > 20 total → WARNING
- Flag: > 50 total → HIGH

#### 3c. File Size Check
```
Glob("**/*.{swift,kt,dart,java,ts,js}")
```
- Count lines per file (use wc -l or read file)
- Flag files > 500 LOC → WARNING (potential god class)
- Flag files > 1000 LOC → HIGH

#### 3d. Test Ratio
```
Glob("**/*{Test,Spec,test,spec}*.*")  → test file count
Glob("**/*.{swift,kt,dart,java}")     → source file count (exclude tests)
```
- Ratio = test_files / source_files
- Flag: ratio < 0.2 → WARNING (low test coverage)
- Flag: ratio < 0.05 → CRITICAL (no meaningful tests)

### Step 4: Deep Scan (--deep mode only, dispatch agents)

```
IF deep mode:
  # 4a: Architecture compliance
  Task(subagent_type: "bk-code-reviewer", model: "sonnet", run_in_background: true,
    description: "Architecture compliance check for health report",
    prompt: "
      Perform architecture compliance check.
      Read: bk/docs/foundation/architecture.md (expected patterns)
      Scan: source files for actual patterns used
      Check: layer violations (UI calling data layer directly, etc.)
      Output: list of violations with file:line citations
      Write findings to: bk/docs/health-report-arch.md
    "
  )

  # 4b: Dependency vulnerability scan
  Task(subagent_type: "bk-security-auditor", model: "haiku", run_in_background: true,
    description: "Dependency vulnerability scan for health report",
    prompt: "
      Scan project dependencies for known vulnerabilities.
      Read lock files: Podfile.lock, Package.resolved, build.gradle.kts, pubspec.lock
      Check: outdated/vulnerable packages
      Output: list of vulnerable deps with CVE or advisory references where available
      Write findings to: bk/docs/health-report-security.md
    "
  )

  # Wait for both agents
  # Collect and merge findings into main report
```

### Step 5: Synthesize Health Report

Write `bk/docs/health-report.md` with priority-ordered findings:

```markdown
# Project Health Report
Generated: {ISO timestamp} | Mode: {quick|deep} | Project: {path}

## Summary
| Priority | Count | Areas |
|----------|-------|-------|
| Critical | N | {areas} |
| High | N | {areas} |
| Medium | N | {areas} |
| Low | N | {areas} |

## Dependency Freshness
{findings with file citations}

## Code Quality
### TODO/FIXME ({count} items)
{top 5 files with most items, with line citations}

### Large Files ({count} files > 500 LOC)
{file list with LOC count}

## Test Coverage
- Test ratio: {ratio} ({test_count} test files / {source_count} source files)
- Status: {OK|WARNING|CRITICAL}

## Architecture (Deep mode only)
{agent findings from bk-code-reviewer}

## Security (Deep mode only)
{agent findings from bk-security-auditor}

## Recommendations
(Priority ordered, actionable next steps)
1. [CRITICAL] ...
2. [HIGH] ...
3. [MEDIUM] ...
```

Priority levels:
- **Critical**: security vulnerabilities, zero test coverage
- **High**: deprecated APIs, severely outdated deps (> 365 days), large god files
- **Medium**: low test ratio, many TODO/FIXME items, stale deps (180-365 days)
- **Low**: style issues, minor code quality signals

### Step 6: Present Summary

Show user:
- Total findings by priority
- Top 3 most important recommendations
- Suggest `/bk-health --deep` if quick mode revealed significant issues
