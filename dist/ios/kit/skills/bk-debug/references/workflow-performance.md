# Performance Fix Workflow

For memory leaks, ANR/watchdog kills, frame drops, slow startup.

## Detection Keywords
`slow`, `lag`, `freeze`, `ANR`, `memory leak`, `frame drop`, `jank`, `startup time`, `battery`, `performance`, `OOM`

## Workflow

### Step 1: Classify Performance Issue

| Type | Indicators | Tool |
|------|-----------|------|
| Memory leak | Growing memory, OOM crash | Instruments (iOS) / LeakCanary (Android) |
| Frame drops | UI jank, < 60fps | Time Profiler / GPU Monitor |
| Slow startup | Cold start > 2s | Launch profiler, trace main thread |
| ANR/Watchdog | App killed, "not responding" | Thread dump, main thread analysis |
| Battery | Excessive background usage | Energy profiler |

### Step 2: Profile
- Identify hot path / allocation site
- Check main thread blocking (network, disk I/O, heavy computation)
- Check retain cycles (iOS) / context leaks (Android)

### Step 3: Common Fixes

| Issue | Fix Pattern |
|-------|-----------|
| Main thread I/O | Move to background queue/coroutine |
| Retain cycle | Add `[weak self]` / `WeakReference` |
| Large image loading | Downsample, lazy load, cache |
| Excessive redraws | Memoize, reduce state changes |
| N+1 queries | Batch fetch, prefetch |

### Step 4: Fix & Measure
- Apply fix
- Re-measure with same profiling tool
- Compare before/after metrics
- Verify no functional regression

## Notes
- Always measure before and after — don't guess performance
- Check both Debug and Release builds (Debug has overhead)
- Memory: look for closures capturing self, observer not removed, timer not invalidated
