# Health Scan Checks (bk-health Steps 3–4)

#### 3a. Dependency Freshness
Read lock files and check modification dates:
```
Podfile.lock          → iOS CocoaPods
Package.resolved      → Swift Package Manager
build.gradle.kts      → Android Gradle
pubspec.lock          → Flutter/Dart
package-lock.json     → Node.js
yarn.lock             → Yarn
```
- Stat each file: days since last modified
- Flag: > 180 days old → WARNING
- Flag: > 365 days old → CRITICAL

#### 3b. TODO/FIXME Count
```
Grep("TODO|FIXME|HACK|XXX", source_files)
```
- Count total occurrences
- Group by file (top 5 files with most)
- Flag: > 20 total → WARNING
- Flag: > 50 total → HIGH

#### 3c. File Size Check
```
Glob("**/*.{swift,kt,dart,java,ts,js}")
```
- Count lines per file (use wc -l or read file)
- Flag files > 500 LOC → WARNING (potential god class)
- Flag files > 1000 LOC → HIGH

#### 3d. Test Ratio
```
Glob("**/*{Test,Spec,test,spec}*.*")  → test file count
Glob("**/*.{swift,kt,dart,java}")     → source file count (exclude tests)
```
- Ratio = test_files / source_files
- Flag: ratio < 0.2 → WARNING (low test coverage)
- Flag: ratio < 0.05 → CRITICAL (no meaningful tests)

### Step 4: Deep Scan (--deep mode only, dispatch agents)

```
IF deep mode:
  # 4a: Architecture compliance
  Task(subagent_type: "bk-code-reviewer", model: "sonnet", run_in_background: true,
    description: "Architecture compliance check for health report",
    prompt: "
      Perform architecture compliance check.
      Read: bk/docs/foundation/architecture.md (expected patterns)
      Scan: source files for actual patterns used
      Check: layer violations (UI calling data layer directly, etc.)
      Output: list of violations with file:line citations
      Write findings to: bk/docs/health-report-arch.md
    "
  )

  # 4b: Dependency vulnerability scan
  Task(subagent_type: "bk-security-auditor", model: "haiku", run_in_background: true,
    description: "Dependency vulnerability scan for health report",
    prompt: "
      Scan project dependencies for known vulnerabilities.
      Read lock files: Podfile.lock, Package.resolved, build.gradle.kts, pubspec.lock
      Check: outdated/vulnerable packages
      Output: list of vulnerable deps with CVE or advisory references where available
      Write findings to: bk/docs/health-report-security.md
    "
  )

  # Wait for both agents
  # Collect and merge findings into main report
```
