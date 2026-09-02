# Workflow: Crash / ANR Analysis

Specialized pipeline for runtime crashes, ANRs, and fatal exceptions.

## Steps

### 1. Collect Crash Data

Gather from user:
- Stack trace / crash log
- Device info (model, OS version)
- Steps to reproduce
- Frequency (always, intermittent, specific conditions)

### 2. Parse Stack Trace

Identify:
- Crash type (signal, exception class)
- Crash point (file, line, function)
- Call chain (what led to crash)
- Thread (main vs background)

### 3. Classify Crash Type

| Platform | Crash Type | Signals | Common Cause |
|----------|-----------|---------|--------------|
| iOS | EXC_BAD_ACCESS | SIGSEGV, SIGBUS | Dangling pointer, force-unwrap nil |
| iOS | EXC_BREAKPOINT | SIGTRAP | Swift runtime error, fatalError |
| iOS | Watchdog | timeout | Main thread blocked >20s |
| Android | NullPointerException | NPE | Null reference access |
| Android | ANR | "Application Not Responding" | Main thread blocked >5s |
| Android | OOM | OutOfMemoryError | Excessive memory allocation |
| Flutter | PlatformException | channel error | Native bridge failure |
| Flutter | setState after dispose | "setState() called after dispose" | Async callback on unmounted widget |
| Flutter | Isolate crash | isolate error | Unhandled exception in isolate |

### 4. Root Cause Analysis

Dispatch bk-debugger with crash context:
```
Task(subagent_type: "bk-debugger", model: "sonnet", prompt: "
  Crash type: {type}
  Stack trace: {trace}
  Platform: {platform}
  Focus: identify root cause from crash point backward
  Output: mk/dev/shared/reports/debug-analysis-{feature}.json
")
```

### 5. Fix + Defensive Check

- Fix root cause
- Add guard/nil-check/try-catch at crash point
- Verify no similar patterns elsewhere (Explore scout)

### 6. Test Crash Scenario

Dispatch bk-unit-test-agent with crash reproduction test.

### 7. Review + Commit

Standard review cycle. Commit type: `fix(crash)`.
