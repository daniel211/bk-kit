# Xcode MCP Tools Reference

**Requirements:** Xcode 26.3+, macOS Sequoia or later
**Source:** Xcode native MCP (no local server install required — Xcode 26.3 exposes via IDE process)

---

## Tool Catalog (20 tools)

### Build
| Tool | Description | Usage |
|------|-------------|-------|
| `build` | Compile project/scheme | Prefer over `xcodebuild build` |
| `clean-build` | Clean + compile | Use after dependency changes |
| `parse-errors` | Structured compiler error parsing | Returns typed error list, not raw log |

### Test
| Tool | Description | Usage |
|------|-------------|-------|
| `test` | Run test suite | Returns parsed pass/fail/coverage, not raw xcodebuild log |
| `test-file` | Run single test file | Faster feedback during TDD |
| `coverage` | Generate coverage report | Use after `test` |

### Preview
| Tool | Description | Usage |
|------|-------------|-------|
| `preview-capture` | Capture SwiftUI Preview as image | Feeds directly into bk-visual-verify |
| `preview-list` | List available previews in file | Discover preview targets |

### Navigate
| Tool | Description | Usage |
|------|-------------|-------|
| `project-navigate` | Explore project structure, targets, schemes | Use before modifying unknown project |
| `find-references` | Find all usages of symbol | Cross-file dependency check |
| `dependency-graph` | Show target/SPM dependency graph | Resolve import issues |
| `build-settings` | Read build settings for target | Debug SDK/version issues |
| `file-tree` | Full project file tree | Orientation pass |

### Docs
| Tool | Description | Usage |
|------|-------------|-------|
| `doc-search` | Query Apple Developer Documentation | Preferred for Apple-native APIs |
| `symbol-info` | Get type/function signature from Apple SDK | Quick API reference |

### Diagnose
| Tool | Description | Usage |
|------|-------------|-------|
| `error-diagnose` | Parse compiler diagnostics + suggest fixes | First step on any build failure |
| `analyze` | Static analysis (Xcode analyzer) | Pre-commit quality check |
| `crash-symbolicate` | Symbolicate crash log | Debug production crashes |
| `memory-report` | Memory usage report (requires running app) | Performance debugging |
| `thread-report` | Data race and threading report | Concurrency debugging |

---

## Decision Table: MCP vs bash xcodebuild

| Scenario | Use MCP | Use bash xcodebuild |
|----------|---------|---------------------|
| Build project | `build` tool | Xcode < 26.3 or macOS < Sequoia |
| Run tests | `test` tool | CI/CD pipeline (no Xcode IDE running) |
| Capture SwiftUI preview | `preview-capture` | Not available in bash |
| Lookup Apple API docs | `doc-search` | Not applicable |
| Parse build errors | `error-diagnose` | When scraping raw log |
| Clean build | `clean-build` | Equivalent: `xcodebuild clean build` |
| Coverage report | `coverage` | `xcodebuild test -enableCodeCoverage YES` |
| Static analysis | `analyze` | `xcodebuild analyze` |

**Rule:** If Xcode 26.3+ and macOS Sequoia+, always prefer MCP tools. Bash fallback otherwise.

---

## Configuration

MCP is auto-configured when `xcode-mcp` entry exists in `platform-context.ios.json`.

For Claude Code CLI: enable via `--xcode-mcp` flag or add to `.claude/settings.json`:
```json
{
  "mcpServers": {
    "xcode-mcp": { "type": "native" }
  }
}
```

No local server process required — Xcode 26.3 exposes MCP through its IDE process.
