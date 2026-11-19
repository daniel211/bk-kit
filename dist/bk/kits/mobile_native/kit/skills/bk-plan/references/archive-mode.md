# Archive Mode (`/bk-plan --archive PLAN_DIR`)

Skips the normal workflow entirely — no research, no synthesis, no agents dispatched.

1. Verify `PLAN_DIR` exists and contains `plan.md`
2. Read `plan.md` frontmatter — confirm all sub-task statuses are complete (or force with `--force`)
3. Update frontmatter `status: archived` in `plan.md`
4. Move the entire plan directory to `bk/dev/archive/{dir-name}/`
5. Report: "Archived {feature} → bk/dev/archive/{dir-name}/"

If a sub-task is still incomplete and `--force` was not passed, STOP and list the incomplete
sub-tasks instead of archiving.
