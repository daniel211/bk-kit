# Workflow: Performance Regression

Specialized pipeline for slow startup, janky scrolling, memory leaks, battery drain, and OOM.

## Steps

### 1. Identify Performance Area

| Area | Signals | Key Metric |
|------|---------|------------|
| Startup | "slow launch", "splash too long" | Time to interactive |
| Scroll | "janky", "frame drop", "stuttering" | FPS, dropped frames |
| Memory | "memory leak", "growing memory", "OOM" | Peak/retained memory |
| Network | "slow API", "timeout", "loading forever" | Response time, payload size |
| Battery | "battery drain", "background usage" | CPU wake time, location use |
| Build | "slow build", "long compile" | Build time |

### 2. Profile

Dispatch bk-debugger for profiling:
```
Task(subagent_type: "bk-debugger", model: "sonnet", prompt: "
  Performance issue: {description}
  Platform: {platform}
  Profile using platform tools. Identify bottleneck.
  Output: mk/dev/shared/reports/debug-analysis-{feature}.json
")
```

Platform profiling tools:

| Platform | Tool | Usage |
|----------|------|-------|
| iOS | Instruments (Time Profiler) | CPU bottlenecks |
| iOS | Instruments (Allocations/Leaks) | Memory issues |
| iOS | MetricKit | Production metrics |
| Android | Android Profiler (CPU) | Thread analysis |
| Android | Android Profiler (Memory) | Heap analysis |
| Android | StrictMode | Main thread violations |
| Flutter | DevTools (Performance) | Frame timing |
| Flutter | DevTools (Memory) | Object retention |

### 3. Find Bottleneck

Common patterns:
- Main thread work (network calls, disk I/O, heavy computation)
- Excessive allocations (object creation in loops, image decoding)
- Retain cycles / memory leaks (strong reference cycles)
- Redundant network calls (no caching, duplicate requests)
- Unnecessary rebuilds (Flutter: setState on entire tree)

### 4. Optimize

- Move work off main thread (async/await, coroutines, isolates)
- Add caching (memory cache, disk cache, HTTP cache)
- Lazy loading (defer until needed)
- Efficient algorithms (O(n) vs O(n²))
- Image optimization (resize, compress, cache)

### 5. Measure Improvement

Dispatch bk-performance-analyzer:
```
Task(subagent_type: "bk-performance-analyzer", model: "sonnet", prompt: "
  Compare before/after performance for: {area}
  Baseline: {before_metrics}
  Current: measure after fix
  Output: mk/dev/shared/reports/performance-{feature}.md
")
```

### 6. Review + Commit

Standard review cycle. Commit type: `fix(perf)`.
