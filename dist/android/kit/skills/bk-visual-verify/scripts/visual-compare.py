#!/usr/bin/env python3
"""
visual-compare.py — Compare Figma design vs app screenshot using Gemini vision.

Usage:
    python3 visual-compare.py --figma design.png --screenshot impl.png [--threshold 85]

Exit codes:
    0 = pass (score >= threshold)
    1 = fail (score < threshold) or error
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Env resolution — mirrors CK ai-multimodal pattern
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    """Load GEMINI_API_KEY from environment, falling back to .env files."""
    key = os.environ.get("GEMINI_API_KEY", "")
    if key:
        return key

    # Search for .env up the directory tree (max 5 levels)
    search = Path(__file__).resolve()
    for _ in range(5):
        search = search.parent
        env_file = search / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line.startswith("GEMINI_API_KEY=") and not line.startswith("#"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")

    return ""


# ---------------------------------------------------------------------------
# Image loading
# ---------------------------------------------------------------------------

MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def load_image(path: str) -> tuple[str, str]:
    """Load image file and return (base64_data, mime_type). Exits on error."""
    p = Path(path)
    if not p.exists():
        print(json.dumps({"error": f"File not found: {path}"}))
        sys.exit(1)

    suffix = p.suffix.lower()
    mime = MIME_MAP.get(suffix)
    if not mime:
        print(json.dumps({"error": f"Unsupported image format: {suffix}. Use PNG or JPEG."}))
        sys.exit(1)

    raw = p.read_bytes()
    if len(raw) > MAX_IMAGE_BYTES:
        print(json.dumps({"error": f"Image too large: {path} ({len(raw) // 1024}KB). Max 20MB."}))
        sys.exit(1)

    return base64.b64encode(raw).decode("utf-8"), mime


# ---------------------------------------------------------------------------
# Gemini API call
# ---------------------------------------------------------------------------

COMPARISON_PROMPT = """You are a UI design verification expert. I will provide two images:
1. IMAGE 1 (Figma Design): The reference design — what the implementation SHOULD look like.
2. IMAGE 2 (App Screenshot): The actual implementation — what was BUILT.

Compare these two images across 5 dimensions. Assign each a score 0-100.

Dimensions and weights:
- layout (30%): overall structure, component placement, hierarchy, all required elements present
- colors (20%): background, text, button, border colors — accuracy vs design
- spacing (20%): margins, padding, gaps between components
- typography (15%): font sizes (relative), weights, text alignment
- alignment (15%): horizontal/vertical alignment, edge alignment, centering

Compute weighted score: (layout*0.30 + colors*0.20 + spacing*0.20 + typography*0.15 + alignment*0.15)

Severity levels for discrepancies:
- critical: layout broken, major sections missing, completely wrong structure
- major: wrong colors, significant spacing issues, important text style differences
- minor: pixel-level differences, slight shade variations, negligible deltas

Respond ONLY with valid JSON — no markdown, no explanation, no code blocks:

{
  "pass": <true if weighted_score >= THRESHOLD, else false>,
  "score": <integer 0-100>,
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
      "expected": "<what the Figma design shows>",
      "actual": "<what the screenshot shows>",
      "severity": "<critical|major|minor>"
    }
  ],
  "summary": "<one sentence overall assessment>"
}"""


def compare_images(figma_b64: str, figma_mime: str,
                   screenshot_b64: str, screenshot_mime: str,
                   threshold: int, api_key: str) -> dict:
    """Send both images to Gemini and return parsed JSON result."""
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print(json.dumps({"error": "google-genai not installed. Run: pip install google-genai"}))
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    prompt = COMPARISON_PROMPT.replace("THRESHOLD", str(threshold))

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            types.Content(parts=[
                types.Part(text="IMAGE 1 (Figma Design):"),
                types.Part(inline_data=types.Blob(mime_type=figma_mime, data=figma_b64)),
                types.Part(text="IMAGE 2 (App Screenshot):"),
                types.Part(inline_data=types.Blob(mime_type=screenshot_mime, data=screenshot_b64)),
                types.Part(text=prompt),
            ])
        ],
    )

    raw_text = response.text.strip()

    # Strip markdown code fences if Gemini adds them despite instructions
    if raw_text.startswith("```"):
        lines = raw_text.splitlines()
        raw_text = "\n".join(
            line for line in lines
            if not line.startswith("```")
        ).strip()

    return json.loads(raw_text)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Compare Figma design vs app screenshot using Gemini vision."
    )
    parser.add_argument("--figma", required=True, help="Path to Figma design export (PNG/JPEG)")
    parser.add_argument("--screenshot", required=True, help="Path to app screenshot (PNG/JPEG)")
    parser.add_argument("--threshold", type=int, default=85,
                        help="Pass threshold 0-100 (default: 85)")
    args = parser.parse_args()

    # Validate threshold
    if not 0 <= args.threshold <= 100:
        print(json.dumps({"error": "Threshold must be between 0 and 100"}))
        sys.exit(1)

    # Load API key
    api_key = load_api_key()
    if not api_key:
        print(json.dumps({
            "error": "GEMINI_API_KEY not found. Export it or add to .env file.",
            "help": "Get a key at https://aistudio.google.com/apikey"
        }))
        sys.exit(1)

    # Load images
    figma_b64, figma_mime = load_image(args.figma)
    screenshot_b64, screenshot_mime = load_image(args.screenshot)

    # Run comparison
    try:
        result = compare_images(
            figma_b64, figma_mime,
            screenshot_b64, screenshot_mime,
            args.threshold, api_key
        )
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Failed to parse Gemini response as JSON: {e}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Gemini API error: {e}"}))
        sys.exit(1)

    # Ensure pass reflects the threshold used (re-evaluate in case Gemini used wrong value)
    result["pass"] = result.get("score", 0) >= args.threshold
    result["threshold"] = args.threshold

    print(json.dumps(result, indent=2))
    sys.exit(0 if result["pass"] else 1)


if __name__ == "__main__":
    main()
