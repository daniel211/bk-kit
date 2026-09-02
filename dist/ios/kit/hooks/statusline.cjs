#!/usr/bin/env node
// statusline.cjs - Status line for beer-kit mobile toolkit
// Input: Claude Code JSON via stdin (context_window, model, workspace, session_id, cost)
// Output: multi-line status (model + context bar + platform + workflow + git)
// Writes context_pct to cache for context-safety.cjs

'use strict';

// Buffer matching Claude Code autocompact (~22.5% of 200k)
const AUTOCOMPACT_BUFFER = 45000;

try {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { readWorkflowState, readPlatformContext } = require('./lib/bk-config-utils.cjs');
  const { detectMobilePlatform } = require('./lib/project-detector.cjs');
  const { getGitInfo } = require('./lib/git-info-cache.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { loadHarnessPolicy, readRecentRedSignals } = require('./lib/harness-policy-loader.cjs');

  // ─── Harness statusline helpers ──────────────────────────────────────────

  const _isTTY = process.stdout.isTTY;
  function _red(s)    { return _isTTY ? `\x1b[31m${s}\x1b[0m` : s; }
  function _yellow(s) { return _isTTY ? `\x1b[33m${s}\x1b[0m` : s; }
  function _green(s)  { return _isTTY ? `\x1b[32m${s}\x1b[0m` : s; }

  /**
   * Read statusline cache, respecting TTL.
   * @param {string} cachePath
   * @param {number} ttlMs
   * @returns {object|null}
   */
  function readStatuslineCache(cachePath, ttlMs) {
    try {
      if (!fs.existsSync(cachePath)) return null;
      const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (!raw || !raw.updated) return null;
      if (Date.now() - raw.updated > ttlMs) return null; // stale
      return raw;
    } catch { return null; }
  }

  /**
   * Write statusline cache.
   */
  function writeStatuslineCache(cachePath, summary) {
    try {
      const dir = path.dirname(cachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const entry = { updated: Date.now(), summary };
      const tmp = cachePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(entry), 'utf8');
      fs.renameSync(tmp, cachePath);
    } catch { /* fail-open */ }
  }

  /**
   * Short form for token/context values (e.g. 152000 → "152k", 200000 → "200k").
   */
  function shortTokens(n) {
    if (typeof n !== 'number' || isNaN(n) || n === 0) return null;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }

  /**
   * Read the tail of a JSONL file, returning the last N entries.
   */
  function readJsonlTail(filePath, maxLines) {
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      return lines.slice(-maxLines).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }

  /**
   * Compute current burn rate (tokens/min) from recent entries in the burn window file.
   */
  function computeCurrentBurnRate(burnFile, lookbackMs) {
    try {
      if (!fs.existsSync(burnFile)) return 0;
      const cutoff = Date.now() - lookbackMs;
      const raw = fs.readFileSync(burnFile, 'utf8');
      const entries = raw.split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(e => e && e.timestamp >= cutoff);
      if (entries.length < 2) return 0;
      const sorted = entries.sort((a, b) => a.timestamp - b.timestamp);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const elapsed = last.timestamp - first.timestamp;
      if (elapsed <= 0) return 0;
      const delta = last.total_tokens - first.total_tokens;
      if (delta <= 0) return 0;
      return delta / (elapsed / 60000);
    } catch { return 0; }
  }

  /**
   * Read .bk-metrics/subagent-live.jsonl and render active subagent breakdown.
   * Designed to complete in <50ms (uses readFileSync + tail, no streaming).
   *
   * @param {string} root — project root
   * @returns {string} rendered agents string, or '' if no active subagents
   */
  function renderSubagentBreakdown(root) {
    try {
      if (!root) return '';
      const liveFile = path.join(root, '.bk-metrics', 'subagent-live.jsonl');
      if (!fs.existsSync(liveFile)) return '';

      // For large files (>1MB), seek from end to read only last 32KB
      let rawLines = '';
      const stat = fs.statSync(liveFile);
      if (stat.size > 1024 * 1024) {
        const fd = fs.openSync(liveFile, 'r');
        try {
          const bufSize = 32 * 1024;
          const buf = Buffer.alloc(bufSize);
          const offset = Math.max(0, stat.size - bufSize);
          const bytesRead = fs.readSync(fd, buf, 0, bufSize, offset);
          rawLines = buf.slice(0, bytesRead).toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
      } else {
        rawLines = fs.readFileSync(liveFile, 'utf8');
      }

      // Parse tail 50 lines
      const lines = rawLines.split('\n').filter(Boolean);
      const tail = lines.slice(-50).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      // Build map of spawn events keyed by subagent_id
      // For stop events (subagent_id null), match by name + recent spawn
      const spawnMap = new Map(); // subagent_id → {name, spawnTs, tokensIn, cost}
      const stopNames = new Set(); // names that have a stop event

      for (const entry of tail) {
        if (entry.event === 'spawn' && entry.subagent_id) {
          spawnMap.set(entry.subagent_id, {
            name: entry.name || 'unknown',
            spawnTs: entry.ts,
            stopTs: null,
            tokensIn: 0,
            cost: 0
          });
        } else if (entry.event === 'stop') {
          // Match by name — mark most recent spawn with same name as stopped
          const name = entry.name || 'unknown';
          stopNames.add(name);
          // Find and update most recent spawn with this name
          let matched = false;
          for (const [id, spawn] of [...spawnMap].reverse()) {
            if (spawn.name === name && !spawn.stopTs) {
              spawn.stopTs = entry.ts;
              spawn.tokensIn = entry.tokens_in || 0;
              spawn.cost = entry.cost_usd || 0;
              matched = true;
              break;
            }
          }
        }
      }

      // Active = spawn entries without a matching stop
      const now = Date.now();
      const active = [];
      for (const [, spawn] of spawnMap) {
        if (!spawn.stopTs) {
          const spawnMs = spawn.spawnTs ? new Date(spawn.spawnTs).getTime() : now;
          const elapsedSec = Math.round((now - spawnMs) / 1000);
          const tokensK = spawn.tokensIn > 0 ? Math.round(spawn.tokensIn / 1000) : null;
          active.push({ name: spawn.name, elapsedSec, tokensK });
        }
      }

      if (active.length === 0) return '';

      // Render: ≤3 → individual breakdown; >3 → summary
      if (active.length <= 3) {
        const parts = active.map(a => {
          let s = `${a.name}(${a.elapsedSec}s`;
          if (a.tokensK !== null) s += `,${a.tokensK}k`;
          s += ')';
          return s;
        });
        return `🤖 ${parts.join(' ')}`;
      } else {
        // >3 active: summary with top agent
        const top = active[0];
        const rest = active.length - 1;
        return `🤖 ${active.length} agents: ${top.name}(${top.elapsedSec}s)+${rest} more`;
      }
    } catch { return ''; }
  }

  /**
   * Build harness summary from live data and cache it.
   */
  function buildHarnessSummary(policy, state, root, sessionId, contextData) {
    try {
      const lookback = policy.kill_switch.lookback_minutes || 30;
      const minRed   = policy.kill_switch.min_red_signals  || 2;
      const recentRed = readRecentRedSignals(lookback);

      const redCount = recentRed.length;
      const haltImminent = redCount >= (minRed - 1) && !state.global_halt;

      // Phase recurrence
      const recurrenceCount = state.phase_recurrence_count || {};
      const recurPhases = Object.entries(recurrenceCount)
        .filter(([, c]) => c > 1)
        .map(([ph, c]) => `${ph}:${c}x`)
        .slice(0, 3);

      // ── Token + cost data ──────────────────────────────────────────────────
      const tmCfg = policy.token_monitoring || {};
      let tokens_used = null;
      let tokens_context_pct = null;
      let context_size = null;
      let cumulative_cost_usd = null;
      let burn_rate_per_min = 0;

      // Tokens from context data (passed in from statusline main)
      if (contextData && contextData.total > 0) {
        tokens_used = contextData.total;
        tokens_context_pct = contextData.pct;
        context_size = contextData.size;
      }

      // Cumulative cost: tail of cost-ledger.jsonl
      if (root && tmCfg.statusline_show_cost !== false) {
        try {
          const ledgerPath = require('path').join(root, '.bk-metrics', 'cost-ledger.jsonl');
          const entries = readJsonlTail(ledgerPath, 200);
          cumulative_cost_usd = entries.reduce((sum, e) => sum + (e.costUsd || 0), 0);
        } catch { /* fail-open */ }
      }

      // Burn rate from token-burn-window.jsonl
      if (root && tmCfg.statusline_show_rate !== false) {
        try {
          const burnFile = require('path').join(root, '.bk-metrics', 'token-burn-window.jsonl');
          const lookbackMs = (tmCfg.lookback_window_minutes || 5) * 60 * 1000;
          burn_rate_per_min = computeCurrentBurnRate(burnFile, lookbackMs);
        } catch { /* fail-open */ }
      }

      return {
        red_signals_30m: redCount,
        halt_imminent: haltImminent,
        global_halt: state.global_halt || false,
        workflow_paused: state.workflow_paused || false,
        recurrence_phases: recurPhases,
        tokens_used,
        tokens_context_pct,
        context_size,
        cumulative_cost_usd,
        burn_rate_per_min
      };
    } catch { return null; }
  }

  /**
   * Render the harness line from a summary object.
   * Returns empty string on failure (fail-open).
   */
  function renderHarnessLine(summary, policy) {
    try {
      if (!summary) return '';
      const minRed = policy.kill_switch.min_red_signals || 2;
      const tmCfg = policy.token_monitoring || {};

      if (summary.global_halt) {
        return _red('🛑 HALTED') +
               ` · red:${summary.red_signals_30m}` +
               ` · → node .claude/cli/bk-health/index.cjs --resume`;
      }

      const parts = [];

      // Red signals
      if (summary.red_signals_30m > 0) {
        const redPart = summary.halt_imminent
          ? _yellow(`⚠ red:${summary.red_signals_30m} (halt imminent)`)
          : _yellow(`red:${summary.red_signals_30m}`);
        parts.push(redPart);
      } else {
        parts.push(_green('🛡 sensors:ok'));
      }

      // Phase recurrence
      if (summary.recurrence_phases && summary.recurrence_phases.length > 0) {
        parts.push(_yellow(`recur:${summary.recurrence_phases.join(',')}`))
      }

      // Paused
      if (summary.workflow_paused) {
        parts.push(_yellow('⚠ PAUSED'));
      }

      // ── Token monitoring additions ────────────────────────────────────

      // Tokens used / context size
      if (tmCfg.statusline_show_tokens !== false && summary.tokens_used) {
        const usedStr = shortTokens(summary.tokens_used);
        const sizeStr = shortTokens(summary.context_size);
        if (usedStr && sizeStr) {
          parts.push(`🪙 ${usedStr}/${sizeStr}`);
        } else if (usedStr) {
          parts.push(`🪙 ${usedStr}`);
        }
      }

      // Cumulative cost
      if (tmCfg.statusline_show_cost !== false &&
          summary.cumulative_cost_usd !== null &&
          summary.cumulative_cost_usd > 0) {
        parts.push(`💰 $${summary.cumulative_cost_usd.toFixed(2)}`);
      }

      // Burn rate (only when > 0)
      if (tmCfg.statusline_show_rate !== false &&
          summary.burn_rate_per_min > 0) {
        const rateStr = shortTokens(Math.round(summary.burn_rate_per_min));
        if (rateStr) {
          parts.push(`rate:+${rateStr}/min`);
        }
      }

      return parts.join(' · ');
    } catch { return ''; }
  }

  const timer = createHookTimer('statusline');

  // Read stdin async
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input || '{}');

      // --- Context window calculation (same formula as CK) ---
      const usage = data.context_window?.current_usage || {};
      const contextSize = data.context_window?.context_window_size || 0;
      let contextPct = 0;

      if (contextSize > 0 && contextSize > AUTOCOMPACT_BUFFER) {
        const totalTokens = (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
        contextPct = Math.min(100, Math.round(((totalTokens + AUTOCOMPACT_BUFFER) / contextSize) * 100));
      }

      // --- Model ---
      const modelName = data.model?.display_name || 'Claude';

      // --- Directory ---
      const rawDir = data.workspace?.current_dir || data.cwd || resolveProjectRoot();
      const homeDir = os.homedir();
      const displayDir = rawDir.startsWith(homeDir) ? rawDir.replace(homeDir, '~') : rawDir;

      // --- Git info (cached) ---
      const gitInfo = getGitInfo(rawDir);
      const gitBranch = gitInfo?.branch || '';

      // --- Platform + workflow state ---
      const state = readWorkflowState();
      const platformCtx = readPlatformContext();
      const platform = process.env.BK_PLATFORM
        || (state && state.platform)
        || (platformCtx && platformCtx.platform)
        || detectMobilePlatform();

      const command = process.env.BK_WORKFLOW_COMMAND || (state && state.command) || null;
      const phase = process.env.BK_WORKFLOW_PHASE || (state && state.current_phase) || null;
      const fsmState = command && phase ? `${command}/${phase}` : (phase || 'idle');

      // --- Running agents ---
      const bgTasks = (state && Array.isArray(state.background_tasks)) ? state.background_tasks : [];
      const runningCount = bgTasks.filter(t => t.status === 'running').length;

      // --- Lines changed ---
      const linesAdded = data.cost?.total_lines_added || 0;
      const linesRemoved = data.cost?.total_lines_removed || 0;

      // --- Write context_pct cache for context-safety.cjs ---
      if (contextPct > 0) {
        try {
          const cacheDir = path.join(resolveProjectRoot(), 'mk', 'dev', 'shared');
          fs.mkdirSync(cacheDir, { recursive: true });
          const cachePath = path.join(cacheDir, '.statusline-cache.json');
          const tmpPath = cachePath + '.tmp';
          fs.writeFileSync(tmpPath, JSON.stringify({ context_pct: contextPct, timestamp: Date.now() }));
          fs.renameSync(tmpPath, cachePath);
        } catch { /* best-effort */ }
      }

      // --- Write context data to temp for hooks ---
      const sessionId = data.session_id;
      if (sessionId && contextSize > 0) {
        try {
          const ctxPath = path.join(os.tmpdir(), `bk-context-${sessionId}.json`);
          fs.writeFileSync(ctxPath, JSON.stringify({
            percent: contextPct, size: contextSize, usage, timestamp: Date.now()
          }));
        } catch { /* best-effort */ }
      }

      // --- Build context bar (10 chars) with color-coded warning ---
      let contextBar = '';
      if (contextPct > 0) {
        const filled = Math.round(contextPct / 10);
        const empty = 10 - filled;
        // ANSI color based on usage level
        let color, icon;
        if (contextPct <= 40) {
          color = '\x1b[32m'; // green
          icon = '🟢';
        } else if (contextPct <= 65) {
          color = '\x1b[33m'; // yellow
          icon = '🟡';
        } else if (contextPct <= 85) {
          color = '\x1b[38;5;208m'; // orange
          icon = '🟠';
        } else {
          color = '\x1b[31m'; // red
          icon = '🔴';
        }
        const reset = '\x1b[0m';
        contextBar = `${icon} ${color}${'█'.repeat(filled)}${'░'.repeat(empty)} ${contextPct}%${reset}`;
      }

      // --- Build git indicators ---
      let gitPart = '';
      if (gitBranch) {
        const indicators = [];
        if (gitInfo?.unstaged > 0) indicators.push(`${gitInfo.unstaged}`);
        if (gitInfo?.staged > 0) indicators.push(`+${gitInfo.staged}`);
        if (gitInfo?.ahead > 0) indicators.push(`${gitInfo.ahead}↑`);
        if (gitInfo?.behind > 0) indicators.push(`${gitInfo.behind}↓`);
        gitPart = gitBranch + (indicators.length ? ` (${indicators.join(', ')})` : '');
      }

      // --- Build lines changed ---
      let linesPart = '';
      if (linesAdded > 0 || linesRemoved > 0) {
        linesPart = `+${linesAdded} -${linesRemoved}`;
      }

      // --- Time ---
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

      // --- Short project dir ---
      const projectName = path.basename(rawDir);

      // --- Render output ---
      // Line 1: model + context bar + time
      let line1 = `⚡ ${modelName}`;
      if (contextBar) line1 += `  ${contextBar}`;
      line1 += `  🕐 ${timeStr}`;

      // Line 2: platform + project + workflow + agents + git + lines
      const line2Parts = [];
      line2Parts.push(`📱 ${platform}`);
      line2Parts.push(`📂 ${projectName}`);
      line2Parts.push(`⚙️  ${fsmState}`);
      // Try subagent live breakdown first; fall back to background_tasks count
      const subagentBreakdown = renderSubagentBreakdown(rawDir);
      if (subagentBreakdown) {
        line2Parts.push(subagentBreakdown);
      } else if (runningCount > 0) {
        line2Parts.push(`🤖 ${runningCount} agents`);
      }
      if (gitPart) line2Parts.push(`🌿 ${gitPart}`);
      if (linesPart) line2Parts.push(`📝 ${linesPart}`);

      // --- Line 3: Harness monitoring line ---
      // Build context data for token monitoring display
      const _contextData = {
        total: (usage.input_tokens || 0) +
               (usage.cache_creation_input_tokens || 0) +
               (usage.cache_read_input_tokens || 0),
        pct: contextPct,
        size: contextSize
      };

      let harnessLine = '';
      try {
        const policy = loadHarnessPolicy();
        const harnessRoot = resolveProjectRoot();
        const cachePath = resolveProjectRoot()
          ? require('path').join(harnessRoot, policy.monitor.statusline_cache)
          : null;
        const ttlMs = policy.monitor.statusline_cache_ttl_ms || 5000;

        // Token monitoring data is live — always build fresh (bypasses cache for new fields)
        // Cache only covers halt/red signal state which is stable within ttl
        let harnessSummary = null;
        if (cachePath) {
          const cached = readStatuslineCache(cachePath, ttlMs);
          if (cached && cached.summary) {
            // Merge live token data into cached summary
            harnessSummary = { ...cached.summary };
            // Always refresh token/cost/rate from live data
            const freshSummary = buildHarnessSummary(policy, state || {}, harnessRoot, sessionId, _contextData);
            if (freshSummary) {
              harnessSummary.tokens_used = freshSummary.tokens_used;
              harnessSummary.tokens_context_pct = freshSummary.tokens_context_pct;
              harnessSummary.context_size = freshSummary.context_size;
              harnessSummary.cumulative_cost_usd = freshSummary.cumulative_cost_usd;
              harnessSummary.burn_rate_per_min = freshSummary.burn_rate_per_min;
            }
          } else {
            // Cache miss or stale — build fresh and cache
            harnessSummary = buildHarnessSummary(policy, state || {}, harnessRoot, sessionId, _contextData);
            if (cachePath && harnessSummary) writeStatuslineCache(cachePath, harnessSummary);
          }
        } else {
          harnessSummary = buildHarnessSummary(policy, state || {}, harnessRoot, sessionId, _contextData);
        }

        harnessLine = renderHarnessLine(harnessSummary, policy);
      } catch { /* fail-open — harness line is optional */ }

      process.stdout.write(line1 + '\n');
      process.stdout.write(line2Parts.join('  ') + '\n');
      if (harnessLine) {
        process.stdout.write(harnessLine + '\n');
      }

      timer.end({ status: 'ok', exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.stdout.write('[unknown] [idle]\n');
      process.exit(0);
    }
  });
} catch (e) {
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'statusline', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'statusline', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.stdout.write('[unknown] [idle]\n');
  process.exit(0);
}
