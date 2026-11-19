# Input Discovery & Clarification (bk-bootstrap Steps 2–3)

## Step 2: Input Discovery (conductor inline, < 30s)

Quick Glob scan to detect all available inputs:

```
# Code detection
Glob("**/*.{swift,kt,dart,java}") → count source files
Glob("**/*.xcworkspace") OR Glob("**/build.gradle") OR Glob("**/pubspec.yaml") → platform

# Document detection
Glob("**/*.{md,txt,pdf,docx}") → list doc files (exclude node_modules, .git, Pods)
Look for: BRD, PRD, requirements, specs, planning docs in project root or docs/

# Design detection
Glob("**/design-app/**") OR Glob("**/tokens.json") OR Glob("**/wireframes/**") → design assets
Glob("**/*.figma") → Figma files

# API spec detection
Glob("**/openapi.{yaml,yml,json}") OR Glob("**/swagger.{yaml,yml,json}") → API specs

# Health signals (quick, inline)
Count TODO/FIXME: Grep("TODO|FIXME|HACK", source files) → count
Check lock file age: stat Podfile.lock/Package.resolved → days since modified
```

List findings for the user.

## Step 3: Clarify Input (AskUserQuestion if needed)

IF docs or design detected → confirm with the user:

```
AskUserQuestion:
  header: "Project Input Discovery"
  question: "Phát hiện trong project:
    - Code: {count} {platform} files
    - Docs: {list doc files found}
    - Design: {design assets found}
    - API specs: {api files found}
    Bạn có thêm tài liệu dự án hoặc mô tả nào không?"
  options:
    - "Tiến hành scan với những gì phát hiện" (Recommended)
    - "Tôi có thêm tài liệu ở folder khác"
    - "Để tôi mô tả dự án cho bạn"
```

IF only code found (no docs/design) → ask briefly:

```
AskUserQuestion:
  question: "Project chỉ có code ({count} files). Bạn có BRD, design specs, hoặc mô tả dự án không?"
  options:
    - "Không, scan code là đủ" (Recommended)
    - "Có, tài liệu ở..."
```

IF input is clear (code + docs + design all present) → proceed without asking.

## Step 3b: Create Task Tracking

```
T1 = TaskCreate(subject="Scan source code",         activeForm="Scanning source code")
IF docs detected:
  T2 = TaskCreate(subject="Scan project documents",  activeForm="Scanning documents")
IF design detected:
  T3 = TaskCreate(subject="Scan design specs",       activeForm="Scanning design specs")
IF api_specs detected:
  T_api = TaskCreate(subject="Parse API specs", activeForm="Parsing API specs")
T4 = TaskCreate(subject="Synthesize foundation docs",  activeForm="Synthesizing docs",   addBlockedBy=[T1, T2?, T3?])
IF SERENA_AVAILABLE:
  T5 = TaskCreate(subject="Enrich Serena memory",    activeForm="Enriching Serena",      addBlockedBy=[T4])
T6 = TaskCreate(subject="Update platform context",   activeForm="Updating context",      addBlockedBy=[T4])
```
