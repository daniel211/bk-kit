---
name: bk-project-intake
description: "Extract structured requirements from project documentation"
user-invocable: true
argument-hint: "[docs directory path]"
---

# Project Intake: $ARGUMENTS

Reads project docs and uses Claude to extract structured requirements.
Runs in main session (no separate agent needed — Claude does the extraction).

<Use_When>
- User provides project documentation directory
- User says "read project docs", "extract requirements", "intake"
- Requirements input needed for code generation pipeline
</Use_When>

<Do_Not_Use_When>
- No docs provided
- User wants design extraction — use /bk-spec --design
- User wants API parsing — use /bk-openapi-parse
</Do_Not_Use_When>

## Workflow

### 1. Collect Docs
Scan `$ARGUMENTS` directory (or CWD) for project documentation:
```bash
find {docsDir} -type f \( -name "*.md" -o -name "*.txt" -o -name "*.pdf" -o -name "*.docx" \) | head -20
```
Read each file. Skip files > 500 lines (summarize instead).

### 2. Gather Optional Context
Check for existing pipeline outputs (skip if missing):
- `mk/dev/{feature}/design/*/design.md` → screen names, component list (from /bk-spec)
- `mk/dev/shared/api-output.json` → endpoint paths, models (from bk-openapi-parse)

### 3. Extract Requirements (Inline)
Using all collected docs + optional context, extract structured requirements:
- Functional requirements (must/should/could priority)
- Non-functional requirements (performance, security, accessibility)
- User stories with acceptance criteria
- Platform-specific constraints
- Data models and relationships

### 4. Output
Write `mk/dev/shared/requirements-output.json`:
```json
{
  "schema": "ProjectRequirements",
  "version": "1.0",
  "requirements": [
    {
      "id": "REQ-001",
      "type": "functional|non-functional",
      "priority": "must|should|could",
      "title": "string",
      "description": "string",
      "acceptance_criteria": ["string"],
      "source": "filename:line"
    }
  ],
  "user_stories": [...],
  "constraints": [...],
  "data_models": [...]
}
```

### 5. Report
Summary: "{N} requirements extracted ({M} must, {K} should, {L} could)"
Suggest: `/bk-plan` to create implementation plan from requirements.
