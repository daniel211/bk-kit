# AutoDream Integration (bk-plan Step 0b — optional)

Applies when an AutoDream artifact is available: `.autodream/{feature}.json` exists, or the
user passes `--autodream`. Otherwise skip Step 0b entirely.

## Procedure

1. Read AutoDream output: task breakdown, architecture overview, dependency map, risk register.
2. Pre-populate the plan structure:
   - Task breakdown → sub-task drafts
   - Architecture overview → architecture validation baseline
   - Dependency map → execution batch ordering
   - Risk register → review focus areas
3. Skip bk-researcher dispatch for items already covered by AutoDream.
4. bk-planner **validates + enriches** the AutoDream output — it does not re-plan from scratch.
5. Note in `plan.md`: "Plan seeded from AutoDream artifact. Validated by bk-planner."

## Notes

- AutoDream never replaces Step 8 (bk-planner synthesis); it only seeds it.
- If the artifact is missing fields, treat those areas as normal (research + synthesize).
