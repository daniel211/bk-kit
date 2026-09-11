# Scout Dispatch

Dispatch parallel Explore agents for deep codebase scan.
Skip if project < 50 source files (inline scan sufficient).

## When to Scout

```
totalSourceFiles = count from structure-scan
IF totalSourceFiles < 50 → skip, inline scan covers everything
IF totalSourceFiles >= 50 → dispatch 2 scouts
```

## Agent Division

### Scout 1: Source Code Analysis

```
Task(
  subagent_type: "Explore",
  description: "Scout source directories for {platform}",
  prompt: "
    Scan source directories of this {platform} project.
    Project root: {project-root}

    Follow rules/coding-intelligence-priority.md for tool selection.

    Tasks:
    1. Get symbol overview of 3-5 feature directories
       - P1 Serena: get_symbols_overview(relative_path, depth: 1)
         → class hierarchy, protocol conformance, layer structure
       - P2 LSP: documentSymbol for each feature entry file
         → class/function inventory per file
       - P3 Grep: grep class declarations + import patterns
       - P4 Read: read representative files manually (last resort)
       - Identify layer structure (data/domain/presentation)
       - Note class naming patterns
       - Note import organization style
    2. Read entry point file ({entry-point})
       - App initialization pattern
       - DI setup location
       - Navigation root setup
    3. Read 2-3 ViewModel/Bloc/Provider files
       - State management pattern
       - Error handling approach
       - Async patterns used
    4. Read networking layer (if found)
       - API client pattern
       - Request/response handling
       - Auth interceptor presence

    Return a summary report with:
    - Architecture layers found (with paths)
    - Code patterns observed (with file:line examples)
    - Class hierarchy (if Serena available: exact inheritance chain)
    - Naming conventions observed
    - Any inconsistencies or gaps
  "
)
```

### Scout 2: Test + Config Analysis

```
Task(
  subagent_type: "Explore",
  description: "Scout test and config for {platform}",
  prompt: "
    Scan test and configuration files of this {platform} project.
    Project root: {project-root}

    Tasks:
    1. Read 2-3 test files
       - Test naming pattern
       - Test structure (arrange-act-assert? given-when-then?)
       - Mock approach (which library, how mocks are created)
       - Setup/teardown patterns
    2. Read CI config ({ci-config-path})
       - Build steps
       - Test steps with coverage thresholds
       - Lint/quality steps
       - Deploy steps (if any)
    3. Read lint config ({lint-config-path})
       - Key enabled/disabled rules
       - Custom rules
       - Severity overrides
    4. Scan for documentation
       - README.md content summary
       - docs/ directory contents
       - Code comments density (sampled)

    Return a summary report with:
    - Test infrastructure summary
    - CI/CD pipeline description
    - Lint rules summary
    - Documentation status
  "
)
```

## Collecting Results

After both scouts complete:
1. Read scout 1 report → feed into architecture.md + code-guidelines.md
2. Read scout 2 report → feed into code-guidelines.md + build-targets.md
3. Cross-reference with Grep/LSP findings from earlier steps
4. Flag contradictions between scout findings and Grep detection
