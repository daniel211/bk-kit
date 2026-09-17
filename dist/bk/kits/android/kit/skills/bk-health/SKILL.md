---
name: bk-health
description: "Assess project health: dependency freshness, test coverage, code quality, architecture drift. Also provides harness monitoring dashboard and subcommands."
user-invocable: true
argument-hint: "[project-path] [--quick|--deep] | [--dashboard] | [--timeline] | [--ashby] | [--resume] | [--reset-counts]"
---

# Health Check: $ARGUMENTS

Assess project health across dependency freshness, test coverage, code quality, and architecture
drift. Output: `bk/docs/health-report.md`.

<Use_When>
- User says "health check", "project health", "check dependencies", "audit project"
- Invoked via `/bk-health`
- Called from bk-bootstrap when health signals are detected
</Use_When>

<Do_Not_Use_When>
- User wants code review on specific files — use bk-review instead
- User wants security audit only — use bk-security-auditor instead
</Do_Not_Use_When>

## Harness Monitoring Subcommands

`bk-health` also fronts the harness monitor: `node .claude/cli/bk-health/index.cjs` with
`--dashboard` (`--last 7d`, `--json`), `--timeline`, `--ashby` (silent-sensor check), `--resume`
and `--reset-counts` (`--agent`, `--force`). Durations: `24h`, `7d`, `30m`.
Flags, the `.bk-metrics/*.jsonl` files each one reads, and the source path:
`references/harness-monitoring.md`

## CRITICAL CONSTRAINTS

- **Read-only** — NEVER modify project code, only write to `bk/docs/health-report.md`
- **Quick mode**: no agent dispatch (inline conductor scan only)
- **Evidence-based**: cite file + line for every finding
- Quick mode target: complete in < 60s

## Workflow

1. **Parse Arguments** — project path (default CWD) + mode flag. Auto-detect when no flag:
   < 50 source files → Quick, ≥ 50 → Deep.

2. **Mode** — `--quick`: inline conductor scan only, no agent dispatch, < 60s.
   `--deep`: inline scan plus dispatched agents.

3. **Quick Scan** (runs in BOTH modes, conductor inline) — dependency freshness (lock-file age:
   >180d WARNING, >365d CRITICAL), TODO/FIXME count (>20 WARNING, >50 HIGH), file size
   (>500 LOC WARNING, >1000 HIGH), test ratio (<0.2 WARNING, <0.05 CRITICAL).
   Exact globs, lock files and thresholds: `references/scan-checks.md`

4. **Deep Scan** (`--deep` only) — dispatch in background: `bk-code-reviewer` (sonnet) for
   architecture compliance → `bk/docs/health-report-arch.md`, and `bk-security-auditor` (haiku)
   for dependency vulnerabilities → `bk/docs/health-report-security.md`. Wait for both, merge
   findings. Dispatch prompts: `references/scan-checks.md`

5. **Synthesize** — write `bk/docs/health-report.md`, findings ordered by priority:
   **Critical** security vulnerabilities, zero test coverage · **High** deprecated APIs, deps
   >365 days, god files · **Medium** low test ratio, many TODO/FIXME, deps 180–365 days ·
   **Low** style and minor quality signals. Report template: `references/report-template.md`

6. **Present Summary** — totals by priority, the top 3 recommendations, and suggest
   `/bk-health --deep` when quick mode revealed significant issues.
