# Internal Scouting with Explore Subagents

Use Explore subagents when SCALE >= 6 or as the default scouting method.

## How It Works

Spawn multiple `Explore` subagents via `Task` tool to search codebase in parallel.

## Task Tool Configuration

```
subagent_type: "Explore"
```

## Prompt Template

```
Quickly scout {DIRECTORY} for files related to: {USER_PROMPT}

Instructions:
- Search for relevant files matching the task
- Use Glob/Grep for file discovery
- List files with brief descriptions
- Timeout: 3 minutes max
- Skip if timeout reached

Report format:
## Found Files
- `path/file.ext` - description

## Patterns
- Key patterns observed
```

## Spawning Strategy

### Directory Division

Split mobile codebase logically by platform:

**iOS:**
- `Sources/` - Swift source files
- `Modules/` - Feature modules
- `Services/` - Service layer
- `Extensions/` - Swift extensions
- `Resources/` - Assets, strings, plists
- `*.xcodeproj/` - Project configuration

**Android:**
- `app/src/main/` - Main source set
- `app/src/test/` - Unit tests
- `data/` - Data layer (repositories, datasources)
- `domain/` - Domain layer (use cases, models)
- `presentation/` - UI layer (ViewModels, fragments, activities)

**Flutter:**
- `lib/src/` - Core source
- `lib/features/` - Feature modules
- `test/` - Unit and widget tests
- `integration_test/` - Integration tests

### Parallel Execution
- Spawn all agents in single `Task` tool call
- Each agent gets distinct directory scope
- No overlap between agents

## Example

User prompt: "Find authentication-related files"

```
Agent 1: Scout Sources/Auth/, Sources/Services/ for auth files (iOS)
Agent 2: Scout Sources/Extensions/, Resources/ for auth config (iOS)
Agent 3: Scout data/auth/, domain/auth/ for auth logic (Android)
Agent 4: Scout presentation/auth/ for auth UI (Android)
Agent 5: Scout lib/features/auth/ for auth feature (Flutter)
Agent 6: Scout test/, integration_test/ for auth tests
```

## Timeout Handling

- Set 3-minute timeout per agent
- Skip non-responding agents
- Don't restart timed-out agents
- Aggregate available results

## Reading File Content

When needing to read file content, use chunking to stay within context limits (<150K tokens safe zone).

### Step 1: Get Line Counts
```bash
wc -l path/to/file1.swift path/to/file2.kt path/to/file3.dart
```

### Step 2: Calculate Chunks
- **Target:** ~500 lines per chunk (safe for most files)
- **Max files per agent:** 3-5 small files OR 1 large file chunked

**Chunking formula:**
```
chunks = ceil(total_lines / 500)
lines_per_chunk = ceil(total_lines / chunks)
```

### Step 3: Spawn Parallel Bash Agents

**Small files (<500 lines each):**
```
Task 1: subagent_type="Bash", prompt="cat file1.swift file2.swift"
Task 2: subagent_type="Bash", prompt="cat file3.kt file4.kt"
```

**Large file (>500 lines) - use sed for ranges:**
```
Task 1: subagent_type="Bash", prompt="sed -n '1,500p' large-file.dart"
Task 2: subagent_type="Bash", prompt="sed -n '501,1000p' large-file.dart"
Task 3: subagent_type="Bash", prompt="sed -n '1001,1500p' large-file.dart"
```

### Chunking Decision Tree
```
File < 500 lines     → Read entire file
File 500-1500 lines  → Split into 2-3 chunks
File > 1500 lines    → Split into ceil(lines/500) chunks
```

Spawn all in single message for parallel execution.

## Result Aggregation

Combine results from all agents:
1. Deduplicate file paths
2. Merge descriptions
3. Note any gaps/timeouts
4. List unresolved questions
