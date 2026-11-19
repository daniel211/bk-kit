# Harness Monitoring Subcommands (bk-health)

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

# Resume a halted or paused workflow (interactive confirmation).
# From a recurrence pause it also resets phase_recurrence_count + the history window.
node .claude/cli/bk-health/index.cjs --resume
node .claude/cli/bk-health/index.cjs --resume --force  # skip confirmation

# Reset phase recurrence (count + history window) + agent dispatch counters
node .claude/cli/bk-health/index.cjs --reset-counts
node .claude/cli/bk-health/index.cjs --reset-counts --agent bk-ios-developer  # single agent
node .claude/cli/bk-health/index.cjs --reset-counts --force  # skip confirmation
```

**Duration formats**: `24h`, `7d`, `30m`

**Files read**:
- `.bk-metrics/violations.jsonl` — security/fsm/privacy violations
- `.bk-metrics/decisions.jsonl` — agent architectural decisions
- `.bk-metrics/red-signals.jsonl` — harness red signals (deadloops, caps) — these count toward a halt
- `.bk-metrics/yellow-signals.jsonl` — lint warnings; recorded for visibility, never count toward a halt
- `.bk-metrics/workflow-summary.jsonl` — agent workflow summaries
- `.bk-metrics/ashby-warnings.jsonl` — sensor silent warnings
- `bk/dev/shared/.workflow-state.json` — FSM state

**Source**: `src/cli/bk-health/` (runs from source — no build step required)
