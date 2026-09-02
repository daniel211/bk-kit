---
name: bk-visual-verify
description: "AI vision comparison of Figma design vs app screenshot. Use after UI implementation to verify visual accuracy against design specs."
user-invocable: true
argument-hint: "[figma-image] [screenshot-image] [--threshold 85]"
---

# Visual Verify: $ARGUMENTS

AI-powered visual comparison between Figma design export and app screenshot. Uses Gemini vision to score layout, colors, spacing, typography, and alignment. Returns pass/fail with specific discrepancies.

<Use_When>
- After UI implementation to verify visual accuracy against Figma design
- Visual regression check before committing UI changes
- Design review — confirm implementation matches spec
- User invokes `/bk-visual-verify [figma.png] [screenshot.png]`
</Use_When>

<Do_Not_Use_When>
- No Figma reference image available
- Logic-only or API-only changes (no UI)
- Backend-only features
- When GEMINI_API_KEY is not configured
</Do_Not_Use_When>

## Scoring

- Layout structure: 30%
- Colors: 20%
- Spacing/padding: 20%
- Typography: 15%
- Alignment: 15%
- Pass threshold: >= 85

See `references/scoring-criteria.md` for severity levels and full criteria.

---

## Execution

### iOS Note: Xcode MCP Preview Capture

On iOS projects with Xcode 26.3+ (macOS Sequoia+): if Xcode MCP is available, use MCP `preview-capture` tool to automatically capture SwiftUI Preview screenshots — eliminates the manual simulator screenshot step.

```
# MCP preview-capture (when available)
# Captures SwiftUI Preview as image directly from Xcode
# Pass resulting image as {screenshot_image} argument to this skill
```

Fallback: take screenshot manually from iOS Simulator when MCP unavailable.

### Step 1: Validate Inputs

Check that both image paths are provided and files exist:
```bash
# Verify files exist and are readable images (PNG/JPEG)
ls -lh {figma_image} {screenshot_image}
```

If either file is missing: **STOP** — **use `AskUserQuestion` tool** to ask user to provide both image paths.
If `GEMINI_API_KEY` not set: **STOP** — **use `AskUserQuestion` tool** to instruct user to set the env var.

### Step 2: Run Gemini Vision Comparison

Execute the comparison script with both images:
```bash
python3 {skill_dir}/scripts/visual-compare.py \
  --figma {figma_image} \
  --screenshot {screenshot_image} \
  --threshold {threshold|85}
```

The script sends both images to Gemini with a structured comparison prompt.
See `references/comparison-prompt-template.md` for the prompt used.

### Step 3: Parse and Report Results

Parse JSON output from the script:
```json
{
  "pass": true|false,
  "score": 0-100,
  "discrepancies": [
    {
      "area": "layout|colors|spacing|typography|alignment",
      "expected": "description of design intent",
      "actual": "description of implementation",
      "severity": "critical|major|minor"
    }
  ]
}
```

Report to user:

```
Visual Verify Result: [PASS ✓ | FAIL ✗]
Score: {score}/100 (threshold: {threshold})

Discrepancies found: {count}
  [critical] {area}: expected {expected}, got {actual}
  [major]    {area}: expected {expected}, got {actual}
  [minor]    {area}: expected {expected}, got {actual}
```

### Step 4: Recommend Actions

If PASS (score >= threshold):
- Confirm implementation matches design
- Proceed to bk-commit

If FAIL (score < threshold):
- List critical/major discrepancies with actionable fixes
- Suggest specific CSS/layout changes
- Re-run after fixes with `/bk-visual-verify`

## Constraints

- Images must be PNG or JPEG, < 20MB each
- Requires `GEMINI_API_KEY` environment variable
- Script uses `gemini-2.5-flash` model
- Exit code 0 = pass, 1 = fail

## References

- Comparison prompt: `references/comparison-prompt-template.md`
- Scoring criteria: `references/scoring-criteria.md`
- Script: `scripts/visual-compare.py`
