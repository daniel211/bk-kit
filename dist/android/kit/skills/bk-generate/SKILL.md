---
name: bk-generate
description: "Generate mobile screen code from design specs using prompt-builder + compile-validate loop."
user-invocable: true
argument-hint: "<screen-spec-path> [--project <dir>] [--target <dir>] [--platform ios|android|flutter]"
---

# Generate Screen: $ARGUMENTS

Generate platform-native screen code from design specifications.

<Use_When>
- bk-code Step 3 dispatches for phases with `type: ui-generation` or `type: screen`
- User says "generate screen", "build UI from spec"
- Design spec file exists with screen layout definition
</Use_When>

<Do_Not_Use_When>
- No design spec provided — use /bk-spec --design first
- Bug fix needed — use /bk-debug
- API-only feature (no UI) — use /bk-code directly
- `src/scripts/prompt-builder.ts` is absent — see the precondition below
</Do_Not_Use_When>

## Precondition — source repo only

This skill drives two TypeScript helpers, `src/scripts/prompt-builder.ts` and
`src/scripts/compile-validator.ts`, which live in the Beer Kit **source repository**.
`bk-<platform> init` does not ship them into a consumer project, and they need `npx tsx`
plus the dependencies declared in `src/scripts/package.json`.

Check before starting:

```bash
[ -f src/scripts/prompt-builder.ts ] && [ -f src/scripts/compile-validator.ts ] \
  || echo "unavailable"
```

If unavailable, **stop and say so plainly**: this skill cannot run here. Use `/bk-code`
with a plan produced by `/bk-plan` instead — it reaches the same destination through the
normal agent dispatch path and has no such dependency. Do not attempt a partial run.

## Usage

```
/bk-generate {screen-spec-path} --project {project-dir} --target {target-dir} --platform {ios|android|flutter}
```

## Workflow

### 1. Build Generation Prompt
Run prompt-builder.ts to assemble context:
```
npx tsx src/scripts/prompt-builder.ts \
  --screen {screen-spec-path} \
  --components {project-dir}/components/ \
  --tokens {project-dir}/tokens.json \
  --rules {project-dir}/rules/global.md \
  --templates src/templates/{platform}/ \
  --target {target-dir} \
  --platform {platform}
```

### 2. Dispatch bk-{platform}-developer
Send the generated prompt to bk-{platform}-developer agent (platform detected at runtime). The prompt IS the specification.

### 3. Compile Check (per screen)

After bk-{platform}-developer generates files:

1. Run compile-validator:
   ```
   npx tsx src/scripts/compile-validator.ts --project {projectRoot}
   ```

2. If `success: true` → mark screen done, proceed to next

3. If `success: false` → format errors for agent retry:
   ```
   Build failed. Fix these errors:
   - {file}:{line}:{column}: {message}
   - ...
   ```
   Resume bk-{platform}-developer with error context (max 3 retries per screen)

4. After 3 failures → log all errors, skip screen, continue with next

### 4. Report
For each screen, record: files generated, compile result, retries, duration.
