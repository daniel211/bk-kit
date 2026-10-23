# Background Agent Limitations & Status Protocol (bk-agent-contract §5)

```
Background agents CANNOT:
  ✗ Call LSP tools
  ✗ Call MCP servers
  ✗ Return need_data (use blocked status instead)

Background agents CAN:
  ✓ Read files (Glob, Grep, Read)
  ✓ Write files (Write, Edit)
  ✓ Execute commands (Bash)
```

Main MUST provide in prompt:
- All input file paths (absolute)
- Expected output file path
- Complete context (no "previous" references)

### Background Agent Status Protocol

| Status | When | Conductor Action |
|--------|------|-----------------|
| `complete` | Work done, output written | Verify + proceed |
| `partial` | Some work done, partial output | Assess → re-dispatch narrower scope OR proceed |
| `blocked` | Missing critical info | Read `{feature}-blocked.json` → provide info → re-dispatch |
| `failed` | Error occurred | Retry once simplified → escalate to user |

When blocked, write `{output-dir}/{feature}-blocked.json`:
```json
{"agent": "agent-type", "status": "blocked", "missing": ["what's needed"], "partial_output": "path"}
```

## Confidence Reporting (bk-agent-contract)

Every agent output MUST include confidence indicator in metadata footer:

```
<!-- metadata: {..., "confidence": "high|medium|low", "confidence_reason": "brief reason"} -->
```

### Definitions:
| Level | Range | Meaning | Conductor Action |
|-------|-------|---------|-----------------|
| high | >= 80% | Clear evidence, verified | Continue pipeline |
| medium | 50-79% | Some uncertainty | Log warning, monitor |
| low | < 50% | Significant uncertainty | Trigger reactive protocol |

### Examples:
- `"confidence": "high", "confidence_reason": "single clear root cause with reproducible test"`
- `"confidence": "medium", "confidence_reason": "2 possible causes, chose most likely based on evidence"`
- `"confidence": "low", "confidence_reason": "cannot reproduce issue, multiple possible causes"`

When confidence is LOW, conductor MUST check `rules/reactive-orchestration.md` before proceeding.
