# Comparison Prompt Template

This is the structured prompt sent to Gemini vision for UI comparison.

---

## Prompt

```
You are a UI design verification expert. I will provide two images:
1. IMAGE 1 (Figma Design): The reference design from Figma — this is what the implementation SHOULD look like.
2. IMAGE 2 (App Screenshot): The actual implementation screenshot — this is what was BUILT.

Your task is to compare these two images across 5 dimensions and produce a structured JSON report.

## Comparison Dimensions

### 1. Layout Structure (weight: 30%)
- Overall page/screen layout and composition
- Component placement relative to each other
- Visual hierarchy (headers, content, CTAs)
- Grid alignment and proportions
- Presence of all required components

### 2. Colors (weight: 20%)
- Background colors (exact hex if identifiable)
- Text colors
- Button/interactive element colors
- Border/divider colors
- Brand color accuracy

### 3. Spacing & Padding (weight: 20%)
- Margins between components
- Internal padding within components
- Consistent spacing rhythm
- Gap between list items, cards, sections

### 4. Typography (weight: 15%)
- Font sizes (relative comparison: heading vs body vs caption)
- Font weights (bold, medium, regular)
- Text alignment (left, center, right)
- Line height and letter spacing approximation

### 5. Alignment (weight: 15%)
- Horizontal alignment of elements
- Vertical alignment within rows
- Edge alignment to screen/container boundaries
- Centering accuracy

## Scoring Instructions

For each dimension, assign a score from 0-100:
- 90-100: Nearly identical — pixel-perfect or within acceptable tolerance
- 70-89: Minor deviations — small differences that don't impact usability
- 50-69: Noticeable differences — clear visual discrepancy but overall structure intact
- 0-49: Major issues — significant deviation from design

Compute weighted total: (layout*0.30 + colors*0.20 + spacing*0.20 + typography*0.15 + alignment*0.15)

## Discrepancy Severity

For each discrepancy found, classify severity:
- **critical**: Layout is broken, major sections missing, completely wrong structure
- **major**: Wrong colors, significant spacing issues, important text style differences
- **minor**: Pixel-level differences, slight shade variations, negligible spacing deltas

## Required JSON Output

Respond ONLY with valid JSON in this exact format (no markdown code blocks, no explanation):

{
  "pass": <true if weighted_score >= 85, false otherwise>,
  "score": <integer 0-100, weighted total>,
  "dimension_scores": {
    "layout": <integer 0-100>,
    "colors": <integer 0-100>,
    "spacing": <integer 0-100>,
    "typography": <integer 0-100>,
    "alignment": <integer 0-100>
  },
  "discrepancies": [
    {
      "area": "<layout|colors|spacing|typography|alignment>",
      "expected": "<description of what the Figma design shows>",
      "actual": "<description of what the screenshot shows>",
      "severity": "<critical|major|minor>"
    }
  ],
  "summary": "<one sentence overall assessment>"
}
```

---

## Usage Notes

- The prompt is embedded in `scripts/visual-compare.py` and sent with both images as inline base64
- Both images are sent in the same API call for direct visual comparison
- Gemini 2.5 Flash handles multi-image prompts natively
- The `--threshold` arg controls the `pass` threshold (default: 85)
