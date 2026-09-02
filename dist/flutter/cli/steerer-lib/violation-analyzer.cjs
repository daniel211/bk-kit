/**
 * violation-analyzer.cjs — Analyze violations.jsonl for frequent rule violations.
 *
 * Reads .bk-metrics/violations.jsonl, groups by violation_type,
 * filters to last N days, and returns Candidates where count >= threshold.
 *
 * @example
 *   const { analyzeViolations } = require('./violation-analyzer.cjs');
 *   const candidates = analyzeViolations({ violationsFile, lookbackDays: 30, minCount: 3 });
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parse JSONL file, returning array of parsed entries (skipping invalid lines).
 * @param {string} filePath
 * @returns {object[]}
 */
function readJsonl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Analyze violations.jsonl for frequently violated rules.
 *
 * @param {object} opts
 * @param {string} opts.violationsFile — absolute path to violations.jsonl
 * @param {number} opts.lookbackDays — how many days back to look (default: 30)
 * @param {number} opts.minCount — minimum violations to become a candidate (default: 3)
 * @returns {Array<{
 *   type: 'new_preference',
 *   rule_id: string,
 *   count: number,
 *   first_ts: number,
 *   last_ts: number,
 *   hooks: string[],
 *   proposed_text: string
 * }>}
 */
function analyzeViolations(opts = {}) {
  const {
    violationsFile,
    lookbackDays = 30,
    minCount = 3
  } = opts;

  if (!violationsFile) return [];

  const entries = readJsonl(violationsFile);
  if (!entries.length) return [];

  const cutoff = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);

  // Filter to lookback window
  const recent = entries.filter(e => e.ts && e.ts >= cutoff);
  if (!recent.length) return [];

  // Group by violation_type
  const groups = {};
  for (const entry of recent) {
    const ruleId = entry.violation_type || entry.rule_id || 'unknown';
    if (!groups[ruleId]) {
      groups[ruleId] = {
        count: 0,
        first_ts: entry.ts,
        last_ts: entry.ts,
        hooks: new Set(),
        severities: new Set()
      };
    }
    const g = groups[ruleId];
    g.count++;
    if (entry.ts < g.first_ts) g.first_ts = entry.ts;
    if (entry.ts > g.last_ts) g.last_ts = entry.ts;
    if (entry.hook) g.hooks.add(entry.hook);
    if (entry.severity) g.severities.add(entry.severity);
  }

  // Build candidates for rules that exceed threshold
  const candidates = [];
  for (const [ruleId, g] of Object.entries(groups)) {
    if (g.count < minCount) continue;

    const firstDate = new Date(g.first_ts).toISOString().slice(0, 10);
    const lastDate = new Date(g.last_ts).toISOString().slice(0, 10);
    const hookList = Array.from(g.hooks).join(', ') || 'unknown';

    candidates.push({
      type: 'new_preference',
      rule_id: ruleId,
      count: g.count,
      first_ts: g.first_ts,
      last_ts: g.last_ts,
      hooks: Array.from(g.hooks),
      proposed_text: buildProposedText(ruleId, g.count, firstDate, lastDate, hookList)
    });
  }

  // Sort by count descending
  candidates.sort((a, b) => b.count - a.count);
  return candidates;
}

/**
 * Build a proposed preference text for a frequently violated rule.
 */
function buildProposedText(ruleId, count, firstDate, lastDate, hookList) {
  const ruleDescriptions = {
    no_presentation_imports_infra: 'Presentation layer files MUST NOT import infrastructure packages (Alamofire, Moya, CoreData, GRDB, SQLite). Inject Repository protocols instead.',
    viewmodel_no_network: 'ViewModels MUST NOT call network APIs directly. Always inject a UseCase or Repository via initializer.',
    domain_no_ui_import: 'Domain layer files MUST NOT import UIKit or SwiftUI. Keep domain framework-agnostic.',
    domain_no_flutter_import: "Domain layer files MUST NOT import 'package:flutter/'. Keep domain pure Dart.",
    notifier_no_network: 'StateNotifier/ChangeNotifier MUST NOT call network directly. Inject a Repository via constructor.',
    no_presentation_imports_data: 'Presentation layer MUST NOT import Retrofit/OkHttp/Room. Use Repository interfaces via DI.',
    domain_no_android_import: 'Domain layer MUST NOT import android.* or androidx.*. Keep domain pure Kotlin.',
    public_api_needs_doc: 'All public API (class/func/struct) MUST have doc comments (/// for Swift).',
    public_api_needs_kdoc: 'All public Kotlin declarations MUST have KDoc comments (/** */).',
    public_api_needs_dartdoc: 'All public Dart declarations MUST have doc comments (///).'
  };

  const description = ruleDescriptions[ruleId]
    || `Rule '${ruleId}' was frequently violated — review and add to coding guidelines.`;

  return `**${ruleId}**: ${description}\n_(learned from ${count} violations, ${firstDate} to ${lastDate}, via ${hookList})_`;
}

module.exports = { analyzeViolations, readJsonl };
