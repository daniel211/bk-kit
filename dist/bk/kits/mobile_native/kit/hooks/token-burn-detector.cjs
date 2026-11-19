#!/usr/bin/env node
// token-burn-detector.cjs - PostToolUse * hook.
// Detects abnormally high token consumption burn rate.
// Maintains rolling window in .bk-metrics/token-burn-window.jsonl
// Emits TOKEN_BURN_SPIKE red signal when rate exceeds threshold for N consecutive windows.
// Fail-open on any error. Exit 0 always.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const { loadHarnessPolicy, trackRedSignal, resolveMetricPath, appendJsonl } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

  /**
   * Format token count as short form (e.g. 152000 → "152k", 1200000 → "1.2M").
   */
  function shortTokens(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }

  /**
   * Read the context cache file written by statusline.cjs.
   * Returns { total_tokens, context_size, timestamp } or null.
   */
  function readContextCache(sessionId) {
    try {
      if (!sessionId) return null;
      const ctxPath = path.join(os.tmpdir(), `bk-context-${sessionId}.json`);
      if (!fs.existsSync(ctxPath)) return null;
      const raw = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
      if (!raw || !raw.timestamp) return null;
      // Stale if older than 5 minutes
      if (Date.now() - raw.timestamp > 5 * 60 * 1000) return null;
      const usage = raw.usage || {};
      const total = (usage.input_tokens || 0) +
                    (usage.cache_creation_input_tokens || 0) +
                    (usage.cache_read_input_tokens || 0);
      return { total_tokens: total, context_size: raw.size || 0, timestamp: raw.timestamp };
    } catch { return null; }
  }

  /**
   * Extract total tokens from hook stdin data's context_window fields.
   */
  function extractTokensFromStdin(data) {
    try {
      const usage = data.context_window?.current_usage || data.usage || {};
      const total = (usage.input_tokens || 0) +
                    (usage.cache_creation_input_tokens || 0) +
                    (usage.cache_read_input_tokens || 0);
      return total > 0 ? total : null;
    } catch { return null; }
  }

  /**
   * Read burn window JSONL, returning entries within the lookback window.
   */
  function readBurnWindow(burnFile, lookbackMs) {
    try {
      if (!fs.existsSync(burnFile)) return [];
      const cutoff = Date.now() - lookbackMs;
      const raw = fs.readFileSync(burnFile, 'utf8');
      return raw.split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(e => e && e.timestamp >= cutoff);
    } catch { return []; }
  }

  /**
   * Compute burn rate from a sorted array of { timestamp, total_tokens } entries.
   * Returns tokens/min over the window, or 0 if insufficient data.
   */
  function computeBurnRate(entries, windowMs) {
    if (!entries || entries.length < 2) return 0;
    const sorted = entries.slice().sort((a, b) => a.timestamp - b.timestamp);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const elapsed = last.timestamp - first.timestamp;
    if (elapsed <= 0) return 0;
    const tokensDelta = last.total_tokens - first.total_tokens;
    if (tokensDelta <= 0) return 0;
    const elapsedMins = elapsed / 60000;
    return tokensDelta / elapsedMins;
  }

  /**
   * Check if the burn rate has exceeded threshold for consecutive_windows.
   * We approximate "consecutive windows" by checking if each sub-window in the
   * lookback period shows an above-threshold rate.
   */
  function checkConsecutiveWindows(entries, windowMs, consecutiveWindows, threshold) {
    if (!entries || entries.length < 2) return { exceeded: false, rate: 0 };

    const sorted = entries.slice().sort((a, b) => a.timestamp - b.timestamp);
    const now = Date.now();

    // Split the lookback into slices of windowMs each
    let highWindows = 0;
    let lastRate = 0;

    for (let i = consecutiveWindows; i >= 1; i--) {
      const windowEnd = now - (i - 1) * windowMs;
      const windowStart = windowEnd - windowMs;
      const slice = sorted.filter(e => e.timestamp >= windowStart && e.timestamp < windowEnd);
      if (slice.length < 2) {
        // Not enough data in this sub-window — reset count
        highWindows = 0;
        continue;
      }
      const rate = computeBurnRate(slice, windowMs);
      if (rate > threshold) {
        highWindows++;
        lastRate = rate;
      } else {
        highWindows = 0;
      }
    }

    return { exceeded: highWindows >= consecutiveWindows, rate: lastRate };
  }

  async function main() {
    // Read stdin — use fd 0 (not /dev/stdin) for compat with subprocess pipes
    let raw = '';
    try {
      const chunk = fs.readFileSync(0, 'utf8');
      raw = chunk;
    } catch { /* no stdin — fail-open */ }

    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { /* malformed — fail-open */ }

    // Check hook enabled
    if (!isHookEnabled('token-burn-detector')) process.exit(0);

    const policy = loadHarnessPolicy();
    const cfg = policy.token_monitoring || {};
    if (!cfg.enabled) process.exit(0);

    // Extract session ID
    const sessionId = input.session_id || input.sessionId || process.env.CLAUDE_SESSION_ID || null;

    // Determine total tokens — prefer stdin context_window, fallback to cache file
    let totalTokens = extractTokensFromStdin(input);
    if (!totalTokens || totalTokens === 0) {
      const cached = readContextCache(sessionId);
      if (cached) totalTokens = cached.total_tokens;
    }

    // If still no token data, nothing to record
    if (!totalTokens || totalTokens === 0) {
      process.exit(0);
    }

    // Resolve burn window file path
    const burnFile = resolveMetricPath(cfg.burn_window_file || '.bk-metrics/token-burn-window.jsonl');

    // Append current measurement
    const entry = { timestamp: Date.now(), total_tokens: totalTokens };
    appendJsonl(burnFile, entry);

    // Load recent window for burn rate computation
    const windowMs = (cfg.window_minutes || 1) * 60 * 1000;
    const lookbackMs = (cfg.lookback_window_minutes || 5) * 60 * 1000;
    const threshold = cfg.burn_rate_threshold_per_min || 50000;
    const consecutive = cfg.consecutive_windows || 3;

    const recentEntries = readBurnWindow(burnFile, lookbackMs);
    if (recentEntries.length < 2) process.exit(0);

    const { exceeded, rate } = checkConsecutiveWindows(recentEntries, windowMs, consecutive, threshold);

    if (exceeded) {
      process.stderr.write(
        `[token-burn-detector] TOKEN_BURN_SPIKE: rate=${shortTokens(Math.round(rate))}/min ` +
        `threshold=${shortTokens(threshold)}/min consecutive=${consecutive}\n`
      );
      trackRedSignal('token_burn_spike', {
        rate: Math.round(rate),
        threshold,
        window_mins: cfg.window_minutes || 1
      });
    }

    process.exit(0);
  }

  main().catch(() => process.exit(0));
} catch (e) {
  try {
    process.stderr.write(`[token-burn-detector] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
