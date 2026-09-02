#!/usr/bin/env python3
"""
generate-assets.py — Platform-specific asset metadata generator.

Reads asset-export-report.json (written by design-asset-exporter) and generates
platform-appropriate metadata files for the exported assets.

Replaces 15+ agent Write calls with a single Bash call, saving ~4-5K tokens/run.

Usage:
  # Auto-detect platform from report's techStack field:
  python generate-assets.py --report mk/dev/flow/raw/asset-export-report.json

  # Override platform:
  python generate-assets.py --platform ios     --report ...
  python generate-assets.py --platform android --report ...
  python generate-assets.py --platform react   --report ...
  python generate-assets.py --platform react-native --report ...
  python generate-assets.py --platform flutter --report ...

  # Verify output matches existing files (CI / post-run check):
  python generate-assets.py --report ... --check
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

# ── Platform detection ────────────────────────────────────────────────────────

TECH_STACK_KEYWORDS: list[tuple[str, str]] = [
    ("react native", "react-native"),
    ("react",        "react"),
    ("swiftui",      "ios"),
    ("uikit",        "ios"),
    ("jetpack compose", "android"),
    ("kotlin xml",   "android"),
    ("flutter",      "flutter"),
]


def detect_platform(tech_stack: str) -> str:
    ts = tech_stack.lower()
    for keyword, platform in TECH_STACK_KEYWORDS:
        if keyword in ts:
            return platform
    return "ios"  # safe default for this project


# ── Helpers ───────────────────────────────────────────────────────────────────

def kebab_to_snake(name: str) -> str:
    return name.replace("-", "_")


def to_pascal(name: str) -> str:
    """ic-arrow-left → IcArrowLeft"""
    return "".join(part.capitalize() for part in name.replace("-", "_").split("_"))


def load_report(path: Path) -> dict:
    if not path.exists():
        sys.exit(f"ERROR: report not found: {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def assets_dir(report_path: Path) -> Path:
    """Derive {flow}/assets/ from {flow}/raw/asset-export-report.json"""
    return report_path.parent.parent / "assets"


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


# ── iOS ───────────────────────────────────────────────────────────────────────

def _ios_pdf_contents(name: str, rendering: str) -> dict:
    return {
        "images": [{"filename": f"{name}.pdf", "idiom": "universal"}],
        "info": {"author": "xcode", "version": 1},
        "properties": {
            "preserves-vector-representation": True,
            "template-rendering-intent": rendering,
        },
    }


def _ios_png_contents(name: str, scales: list[str]) -> dict:
    return {
        "images": [
            {
                "filename": f"{name}{s}.png",
                "idiom": "universal",
                "scale": s.lstrip("@"),   # "@2x" → "2x"
            }
            for s in scales
        ],
        "info": {"author": "xcode", "version": 1},
    }


def generate_ios(report: dict, base: Path, check: bool = False) -> int:
    """
    Write Contents.json for every .imageset in {flow}/assets/.

    Returns number of files written (or mismatches when --check).
    """
    written = mismatches = skipped = 0

    for asset in report["exported"]:
        name     = asset["name"]
        fmt      = asset.get("format", "PDF").upper()
        rendering = asset.get("rendering", "template")

        imageset_dir  = base / f"{name}.imageset"
        contents_path = imageset_dir / "Contents.json"

        if fmt == "PDF":
            contents = _ios_pdf_contents(name, rendering)
        elif fmt == "PNG":
            scales   = asset.get("scales", ["@1x", "@2x", "@3x"])
            contents = _ios_png_contents(name, scales)
        else:
            print(f"  SKIP {name}: unsupported format {fmt} for iOS")
            skipped += 1
            continue

        if check:
            if not contents_path.exists():
                print(f"  MISSING {contents_path}")
                mismatches += 1
            else:
                with open(contents_path, encoding="utf-8") as f:
                    on_disk = json.load(f)
                if on_disk != contents:
                    print(f"  MISMATCH {contents_path}")
                    print(f"    expected: {json.dumps(contents, separators=(',',':'))}")
                    print(f"    on disk:  {json.dumps(on_disk,   separators=(',',':'))}")
                    mismatches += 1
        else:
            imageset_dir.mkdir(parents=True, exist_ok=True)
            write_json(contents_path, contents)
            written += 1

    if check:
        result = "OK" if mismatches == 0 else f"{mismatches} MISMATCH(ES)"
        print(f"iOS check: {result} (skipped {skipped})")
        return mismatches
    else:
        print(f"iOS: wrote {written} Contents.json  (skipped {skipped})  → {base}")
        return written


# ── Android ───────────────────────────────────────────────────────────────────

# Figma @Nx → Android density bucket (Material Design DPI bands)
_DENSITY: dict[str, str] = {
    "@1x": "mdpi",
    "@2x": "xhdpi",
    "@3x": "xxhdpi",
}

# Additional densities exported by design-asset-exporter when platform=android
_DENSITY_EXTRA: dict[str, str] = {
    "@0.75x": "ldpi",
    "@1.5x":  "hdpi",
    "@4x":    "xxxhdpi",
}


def generate_android(report: dict, base: Path, check: bool = False) -> int:
    """
    Organise exported assets into Android res/ structure:
      SVG/PDF icons  → res/drawable/ic_name.svg   (density-independent)
      PNG @Nx images → res/drawable-{density}/img_name.png

    Returns number of files moved/created.
    """
    density_map = {**_DENSITY, **_DENSITY_EXTRA}
    res_dir = base.parent / "res"
    moved = skipped = 0

    for asset in report["exported"]:
        name       = asset["name"]
        fmt        = asset.get("format", "").upper()
        snake_name = kebab_to_snake(name)

        if fmt in ("SVG", "PDF"):
            ext = "svg" if fmt == "SVG" else "pdf"
            src = base / f"{name}.imageset" / f"{name}.{ext}"
            dst = res_dir / "drawable" / f"{snake_name}.{ext}"

            if check:
                if not dst.exists():
                    print(f"  MISSING {dst}")
                    skipped += 1
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                if src.exists():
                    shutil.copy2(src, dst)
                    moved += 1
                else:
                    print(f"  WARN: source not found: {src}")
                    skipped += 1

        elif fmt == "PNG":
            scales = asset.get("scales", ["@1x", "@2x", "@3x"])
            for scale in scales:
                density = density_map.get(scale, "xhdpi")
                src = base / f"{name}.imageset" / f"{name}{scale}.png"
                dst = res_dir / f"drawable-{density}" / f"{snake_name}.png"

                if check:
                    if not dst.exists():
                        print(f"  MISSING {dst}")
                        skipped += 1
                else:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    if src.exists():
                        shutil.copy2(src, dst)
                        moved += 1
                    else:
                        print(f"  WARN: source not found: {src}")
                        skipped += 1

    if not check:
        print(f"Android: {moved} files → {res_dir}  (skipped {skipped})")
        if any(a.get("format", "").upper() == "PDF" for a in report["exported"]):
            print("  NOTE: PDF icons need SVG→VectorDrawable conversion.")
            print("        Tools: svg2vectordrawable, avocado, or Android Studio 'Import Vector Asset'.")

    return skipped if check else moved


# ── React / React Native ──────────────────────────────────────────────────────

def generate_react(report: dict, base: Path, native: bool = False, check: bool = False) -> int:
    """
    Flatten .imageset/ structure into a single assets/ directory.
    React Native: PNG files keep @2x/@3x suffix (RN auto-resolution).
    React:        PNG files suffixed with scale for explicit import.
    Generates index.js barrel for named imports.
    """
    platform = "React Native" if native else "React"
    exports: list[str] = []
    moved = skipped = 0

    for asset in report["exported"]:
        name = asset["name"]
        fmt  = asset.get("format", "").upper()

        if fmt == "SVG":
            src = base / f"{name}.imageset" / f"{name}.svg"
            dst = base / f"{name}.svg"
            if check:
                if not dst.exists():
                    print(f"  MISSING {dst}")
                    skipped += 1
            else:
                if src.exists():
                    shutil.copy2(src, dst)
                    moved += 1
                else:
                    print(f"  WARN: source not found: {src}")
                    skipped += 1
            exports.append(
                f"export {{ default as {to_pascal(name)} }} from './{name}.svg'"
            )

        elif fmt == "PNG":
            scales = asset.get("scales", ["@1x", "@2x", "@3x"])
            for scale in scales:
                src = base / f"{name}.imageset" / f"{name}{scale}.png"
                if native:
                    # React Native convention: name.png, name@2x.png, name@3x.png
                    suffix = "" if scale == "@1x" else scale
                    dst = base / f"{name}{suffix}.png"
                else:
                    dst = base / f"{name}{scale}.png"

                if check:
                    if not dst.exists():
                        print(f"  MISSING {dst}")
                        skipped += 1
                else:
                    if src.exists():
                        shutil.copy2(src, dst)
                        moved += 1
                    else:
                        print(f"  WARN: source not found: {src}")
                        skipped += 1

            # index.js imports @1x as the canonical reference
            exports.append(
                f"export {{ default as {to_pascal(name)} }} from './{name}.png'"
            )

    # Write index.js
    index_path = base / "index.js"
    index_content = (
        "// Auto-generated by generate-assets.py — do not edit manually\n"
        + "\n".join(sorted(exports))
        + "\n"
    )
    if check:
        if not index_path.exists():
            print(f"  MISSING {index_path}")
            skipped += 1
    else:
        index_path.write_text(index_content, encoding="utf-8")

    if not check:
        print(f"{platform}: {moved} files + index.js → {base}  (skipped {skipped})")

    return skipped if check else moved


# ── Flutter ───────────────────────────────────────────────────────────────────

def generate_flutter(report: dict, base: Path, check: bool = False) -> int:
    """
    Organise assets into Flutter convention:
      SVG icons → assets/icons/ic_name.svg
      PNG @1x   → assets/images/img_name.png
      PNG @2x   → assets/images/2.0x/img_name.png
      PNG @3x   → assets/images/3.0x/img_name.png

    Writes pubspec_assets_snippet.yaml (safer than modifying pubspec.yaml).
    """
    icons_dir  = base.parent / "icons"
    images_dir = base.parent / "images"
    asset_decls: set[str] = set()
    moved = skipped = 0

    # Flutter density directories (factor-based, not @Nx)
    flutter_scale_dir: dict[str, str] = {
        "@1x":  "",         # root
        "@2x":  "2.0x",
        "@3x":  "3.0x",
        "@4x":  "4.0x",
    }

    for asset in report["exported"]:
        name       = asset["name"]
        fmt        = asset.get("format", "").upper()
        snake_name = kebab_to_snake(name)

        if fmt == "SVG":
            src = base / f"{name}.imageset" / f"{name}.svg"
            dst = icons_dir / f"{snake_name}.svg"
            asset_decls.add(f"    - assets/icons/{snake_name}.svg")

            if check:
                if not dst.exists():
                    print(f"  MISSING {dst}")
                    skipped += 1
            else:
                icons_dir.mkdir(parents=True, exist_ok=True)
                if src.exists():
                    shutil.copy2(src, dst)
                    moved += 1
                else:
                    print(f"  WARN: source not found: {src}")
                    skipped += 1

        elif fmt == "PNG":
            scales = asset.get("scales", ["@1x", "@2x", "@3x"])
            # pubspec only declares the @1x path; Flutter resolves others automatically
            asset_decls.add(f"    - assets/images/{snake_name}.png")

            for scale in scales:
                scale_subdir = flutter_scale_dir.get(scale, "")
                src = base / f"{name}.imageset" / f"{name}{scale}.png"
                dst = (
                    images_dir / f"{snake_name}.png"
                    if not scale_subdir
                    else images_dir / scale_subdir / f"{snake_name}.png"
                )

                if check:
                    if not dst.exists():
                        print(f"  MISSING {dst}")
                        skipped += 1
                else:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    if src.exists():
                        shutil.copy2(src, dst)
                        moved += 1
                    else:
                        print(f"  WARN: source not found: {src}")
                        skipped += 1

    # pubspec_assets_snippet.yaml
    snippet_path = base.parent / "pubspec_assets_snippet.yaml"
    snippet_content = (
        "# Paste these entries into your pubspec.yaml under flutter.assets:\n"
        "# flutter:\n"
        "#   assets:\n"
        + "\n".join(sorted(asset_decls))
        + "\n"
    )
    if check:
        if not snippet_path.exists():
            print(f"  MISSING {snippet_path}")
            skipped += 1
    else:
        snippet_path.write_text(snippet_content, encoding="utf-8")
        print(f"Flutter: {moved} files → {base.parent}  (skipped {skipped})")
        print(f"  pubspec snippet → {snippet_path}")

    return skipped if check else moved


# ── Content deduplication ─────────────────────────────────────────────────────

def _canonical_file(asset: dict, base: Path) -> "Path | None":
    """Return the canonical file to hash for an asset (PDF or @2x PNG)."""
    name = asset["name"]
    fmt  = asset.get("format", "").upper()
    if fmt == "PDF":
        return base / f"{name}.imageset" / f"{name}.pdf"
    elif fmt == "PNG":
        scales = asset.get("scales", ["@1x", "@2x", "@3x"])
        for scale in ("@2x", "@1x", "@3x"):
            if scale in scales:
                return base / f"{name}.imageset" / f"{name}{scale}.png"
    return None


def find_content_duplicates(report: dict, base: Path) -> list:
    """
    Compute SHA256 of each exported asset's canonical file.
    Return groups of assets with identical content (different names, same bytes).
    """
    hash_map: dict[str, list] = {}  # sha256 → [name, ...]

    for asset in report.get("exported", []):
        f = _canonical_file(asset, base)
        if f and f.exists():
            digest = hashlib.sha256(f.read_bytes()).hexdigest()
            hash_map.setdefault(digest, []).append(asset["name"])

    return [
        {"sha256": sha[:16], "names": names, "canonical": names[0], "aliases": names[1:]}
        for sha, names in hash_map.items()
        if len(names) > 1
    ]


# ── CLI ───────────────────────────────────────────────────────────────────────

PLATFORM_CHOICES = ("ios", "android", "react", "react-native", "flutter")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate platform asset metadata from asset-export-report.json",
        epilog=(
            "Platform is auto-detected from the report's techStack field.\n"
            "Use --platform to override."
        ),
    )
    parser.add_argument(
        "--report", "-r",
        required=True,
        metavar="PATH",
        help="Path to asset-export-report.json",
    )
    parser.add_argument(
        "--platform", "-p",
        choices=PLATFORM_CHOICES,
        metavar="PLATFORM",
        help=f"Target platform: {', '.join(PLATFORM_CHOICES)}. Auto-detected if omitted.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify generated files match expected output (no writes). Exit 1 on mismatch.",
    )
    args = parser.parse_args()

    report_path = Path(args.report).resolve()
    report      = load_report(report_path)
    base        = assets_dir(report_path)

    platform = args.platform or detect_platform(report.get("techStack", ""))
    print(f"Platform: {platform}  |  tech stack: {report.get('techStack', '?')}")
    print(f"Assets:   {base}")
    print(f"Total:    {report.get('total', '?')} assets")
    print()

    if platform == "ios":
        result = generate_ios(report, base, check=args.check)
    elif platform == "android":
        result = generate_android(report, base, check=args.check)
    elif platform == "react":
        result = generate_react(report, base, native=False, check=args.check)
    elif platform == "react-native":
        result = generate_react(report, base, native=True, check=args.check)
    elif platform == "flutter":
        result = generate_flutter(report, base, check=args.check)
    else:
        sys.exit(f"Unknown platform: {platform}")

    if args.check and result > 0:
        sys.exit(1)

    # Content deduplication check (always runs, skipped in --check mode)
    if not args.check:
        dupes = find_content_duplicates(report, base)
        if dupes:
            print(f"\n\u26a0\ufe0f  Content duplicates ({len(dupes)} group(s)):")
            for d in dupes:
                aliases = ", ".join(d["aliases"])
                print(f"   [{d['sha256']}] {d['canonical']} == {aliases}")
            dupes_path = report_path.parent / "content-duplicates.json"
            write_json(dupes_path, {"duplicates": dupes})
            print(f"   \u2192 written: {dupes_path}")
        else:
            print("\n\u2705  No content duplicates.")


if __name__ == "__main__":
    main()
