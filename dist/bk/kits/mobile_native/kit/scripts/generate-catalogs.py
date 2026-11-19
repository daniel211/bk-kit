#!/usr/bin/env python3
"""Generate skill catalogs for beer-kit v2.

Scans skills/*/SKILL.md, parses YAML frontmatter, and produces:
  - skills/CATALOG.md  — human-readable list
  - skills/catalog.json — machine-readable JSON
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CLAUDE_DIR = SCRIPT_DIR.parent

# Workflow vs. knowledge skill is decided by `user-invocable` in each SKILL.md
# frontmatter (see parse_frontmatter / the `invocable` key below). A hardcoded name
# list used to sit here and had gone stale; do not reintroduce one.


def parse_frontmatter(text: str) -> dict:
    """Extract YAML frontmatter between --- delimiters. Returns dict or {}."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        return {}
    fm_text = match.group(1)
    result = {}
    for line in fm_text.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Booleans
        if value.lower() == "true":
            result[key] = True
        elif value.lower() == "false":
            result[key] = False
        else:
            result[key] = value
    return result


def scan_skills(skills_dir: Path) -> list[dict]:
    """Scan skills_dir for */SKILL.md and return parsed metadata list."""
    skills = []
    for skill_file in sorted(skills_dir.glob("*/SKILL.md")):
        text = skill_file.read_text(encoding="utf-8")
        fm = parse_frontmatter(text)
        if not fm.get("name"):
            print(f"Warning: {skill_file} missing 'name' in frontmatter — skipped", file=sys.stderr)
            continue
        skills.append({
            "name": fm["name"],
            "description": fm.get("description", ""),
            "invocable": bool(fm.get("user-invocable", False)),
            "argument_hint": fm.get("argument-hint", ""),
            "path": str(skill_file.relative_to(CLAUDE_DIR)),
        })
    return skills


def generate_catalog_md(skills: list[dict], generated_at: str) -> str:
    """Render human-readable CATALOG.md."""
    workflow = [s for s in skills if s["invocable"]]
    knowledge = [s for s in skills if not s["invocable"]]

    lines = [
        "# Skills Catalog",
        "",
        f"> Auto-generated {generated_at} | {len(skills)} skills total",
        "",
        "---",
        "",
        "## Workflow Skills (user-invocable)",
        "",
        "Invoke with `/skill-name [arguments]` or by describing the intent in chat.",
        "",
        "| Skill | Description | Argument Hint |",
        "|-------|-------------|---------------|",
    ]
    for s in workflow:
        hint = s["argument_hint"] or "—"
        lines.append(f"| `{s['name']}` | {s['description']} | `{hint}` |")

    lines += [
        "",
        "---",
        "",
        "## Knowledge Skills (loaded by agents)",
        "",
        "Not user-invocable. Agents load these via `skills:` frontmatter or `Skill()` calls.",
        "",
        "| Skill | Description |",
        "|-------|-------------|",
    ]
    for s in knowledge:
        lines.append(f"| `{s['name']}` | {s['description']} |")

    lines += ["", "---", "", f"*Generated: {generated_at}*", ""]
    return "\n".join(lines)


def generate_catalog_json(skills: list[dict], generated_at: str) -> str:
    """Render machine-readable catalog.json."""
    workflow = [
        {"name": s["name"], "description": s["description"], "invocable": True}
        for s in skills if s["invocable"]
    ]
    knowledge = [
        {"name": s["name"], "description": s["description"], "invocable": False}
        for s in skills if not s["invocable"]
    ]
    catalog = {
        "generated_at": generated_at,
        "total": len(skills),
        "workflow": workflow,
        "knowledge": knowledge,
    }
    return json.dumps(catalog, indent=2, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate beer-kit skill catalogs (CATALOG.md + catalog.json)",
        epilog="Outputs to skills/ directory by default.",
    )
    parser.add_argument(
        "--skills-dir",
        metavar="PATH",
        default=str(CLAUDE_DIR / "skills"),
        help="Path to skills directory (default: .claude/skills/)",
    )
    parser.add_argument(
        "--out-dir",
        metavar="PATH",
        default=None,
        help="Output directory for catalogs (default: same as --skills-dir)",
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="Generate only catalog.json",
    )
    parser.add_argument(
        "--md-only",
        action="store_true",
        help="Generate only CATALOG.md",
    )
    args = parser.parse_args()

    skills_dir = Path(args.skills_dir).resolve()
    out_dir = Path(args.out_dir).resolve() if args.out_dir else skills_dir

    if not skills_dir.exists():
        print(f"Error: skills directory not found: {skills_dir}", file=sys.stderr)
        sys.exit(1)

    out_dir.mkdir(parents=True, exist_ok=True)

    skills = scan_skills(skills_dir)
    if not skills:
        print(f"Warning: no SKILL.md files found under {skills_dir}", file=sys.stderr)

    generated_at = datetime.now().strftime("%Y-%m-%d")

    if not args.json_only:
        md_path = out_dir / "CATALOG.md"
        md_path.write_text(generate_catalog_md(skills, generated_at), encoding="utf-8")
        print(f"Generated {md_path}", file=sys.stderr)

    if not args.md_only:
        json_path = out_dir / "catalog.json"
        json_path.write_text(generate_catalog_json(skills, generated_at), encoding="utf-8")
        print(f"Generated {json_path}", file=sys.stderr)

    print(f"Done. {len(skills)} skills processed.", file=sys.stderr)


if __name__ == "__main__":
    main()
