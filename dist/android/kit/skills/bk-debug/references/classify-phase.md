# Classify Phase

Transition: `(none) → classify`

## 6-Dimension Scoring

Score each dimension 1-5:

| Dim | Name | 1 (Low) | 5 (High) |
|-----|------|---------|----------|
| D1 | Domain | Well-known module | Unfamiliar/undocumented area |
| D2 | Impact | Single user/edge case | All users/core flow |
| D3 | Technical | Single file, clear cause | Multi-file, unclear cause |
| D4 | Risk | UI glitch | Data corruption/security |
| D5 | Context | Clear report, first attempt | Vague report, multiple failed attempts |
| D6 | Skill Gap | Standard platform knowledge | Specialized knowledge required |

**Total = D1 + D2 + D3 + D4 + D5 + D6**

## Tier Thresholds

| Tier | Score | Pipeline |
|------|-------|----------|
| Trivial | 6-10 | classify → code (main session) → commit |
| Standard | 11-20 | classify → analyze → code → test → review → commit |
| Complex | 21-30 | classify → analyze → brainstorm → code → test → review → commit |

## Issue Type Detection

After scoring, detect issue type from keywords/signals:

| Keywords / Signals | Type | Workflow Override |
|-------------------|------|-------------------|
| "build fail", "compile error", "gradle", "xcodebuild", `BUILD FAILED` | build | `references/workflow-build.md` |
| "crash", "ANR", "SIGABRT", "EXC_BAD_ACCESS", "fatal exception" | crash | `references/workflow-crash.md` |
| "only on [device]", "specific device", "OS version", "API level" | device | `references/workflow-device.md` |
| "slow", "memory leak", "battery", "janky", "frame drop", "OOM" | perf | `references/workflow-perf.md` |
| Everything else | general | Standard FSM pipeline |

If specialized workflow detected → load that reference and follow its steps.

## Trivial Shortcut

If Trivial:
- Fix directly in main session — no agent dispatch
- Skip analyze, test, and review phases
- Jump to Phase 3 (Code), then Phase 6 (Commit)

## State Output

Write to `mk/dev/shared/.workflow-state.json`:
```json
{
  "command": "bk-debug",
  "current_phase": "classify",
  "complexity_tier": "Trivial|Standard|Complex",
  "issue_type": "general|build|crash|device|perf",
  "platform": "{detected}",
  "review_mode": "{from arguments}"
}
```
