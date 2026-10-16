/**
 * arch-rules-ios.cjs — Architecture fitness rules for Swift/iOS (Clean Architecture + MVVM).
 *
 * 6 rules:
 *   1. no_presentation_imports_infra  — error
 *   2. viewmodel_no_network          — error
 *   3. public_api_needs_doc          — warning
 *   4. domain_no_ui_import           — error
 *   5. no_force_unwrap_in_prod       — warning (disabled by default)
 *   6. singleton_limit               — warning
 *
 * Each rule: { id, severity, check(ctx, ruleConfig) → Violation[] }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { makeViolation } = require('./arch-rule-runner.cjs');

// ─── Rule 1: no_presentation_imports_infra ───────────────────────────────────

/**
 * Files in Presentation/Views/Screens layer must NOT import infrastructure packages.
 */
const noPresImportsInfra = {
  id: 'no_presentation_imports_infra',
  severity: 'error',

  check(ctx) {
    if (ctx.layerInfo.layer !== 'presentation') return [];
    const violations = [];
    const infraPattern = /^import\s+(Alamofire|Moya|CoreData|GRDB|SQLite)/m;
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^import\s+(Alamofire|Moya|CoreData|GRDB|SQLite)/);
      if (m) {
        violations.push(makeViolation(
          'no_presentation_imports_infra',
          'error',
          ctx.filePath,
          i + 1,
          `Presentation layer must not import infrastructure package '${m[1]}'. Use a Repository protocol instead.`,
          `Move data-access logic to Data layer. Inject a protocol (e.g., UserRepository) via initializer.`,
          m[0].trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Rule 2: viewmodel_no_network ────────────────────────────────────────────

/**
 * Classes whose name ends with 'ViewModel' must not call network directly.
 */
const viewmodelNoNetwork = {
  id: 'viewmodel_no_network',
  severity: 'error',

  check(ctx) {
    // Check if file contains a class/struct ending in ViewModel
    if (!ctx.content.match(/\b\w*ViewModel\b/)) return [];
    const violations = [];
    const networkPattern = /URLSession\.shared|AF\.request|\\.dataTask\s*\(|Alamofire\.|URLSession\s*\(/;
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(networkPattern);
      if (m) {
        violations.push(makeViolation(
          'viewmodel_no_network',
          'error',
          ctx.filePath,
          i + 1,
          'ViewModel must not call network directly. Inject a UseCase/Repository.',
          'Move network call to a UseCase or Repository, inject via initializer.',
          m[0].trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Rule 3: public_api_needs_doc ────────────────────────────────────────────

/**
 * Public/open func/class/struct/protocol/enum must have a '///' doc comment on the preceding line.
 */
const publicApiNeedsDoc = {
  id: 'public_api_needs_doc',
  severity: 'warning',

  check(ctx) {
    const violations = [];
    // Swift members are indented inside a type — anchoring at column 0 would only ever
    // match top-level declarations and silently miss every public member.
    const pubPattern = /^\s*(public|open)\s+(func|class|struct|protocol|enum)\s+(\w+)/;
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(pubPattern);
      if (!m) continue;
      // Check if preceding non-empty line is a doc comment
      let hasDocs = false;
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        const prev = lines[j].trim();
        if (prev.startsWith('///') || prev.startsWith('/**') || prev === '*/') {
          hasDocs = true;
          break;
        }
        if (prev === '' || prev.startsWith('@') || prev.startsWith('//') && !prev.startsWith('///')) {
          // Skip empty lines and attributes; non-doc comments disqualify
          if (prev.startsWith('//') && !prev.startsWith('///')) break;
          continue;
        }
        break;
      }
      if (!hasDocs) {
        violations.push(makeViolation(
          'public_api_needs_doc',
          'warning',
          ctx.filePath,
          i + 1,
          `Public ${m[2]} '${m[3]}' is missing a doc comment (///).`,
          `Insert directly above \`${lines[i].trim().slice(0, 60)}\`: "/// <one-line summary of what ${m[3]} does>" (one \`///\` line is enough). To silence this rule project-wide set arch_fitness.ios.rules.public_api_needs_doc.enabled=false in bk-harness-policy.json.`,
          lines[i].trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Rule 4: domain_no_ui_import ─────────────────────────────────────────────

/**
 * Files in Domain/UseCase layer must not import UIKit or SwiftUI.
 */
const domainNoUiImport = {
  id: 'domain_no_ui_import',
  severity: 'error',

  check(ctx) {
    if (ctx.layerInfo.layer !== 'domain') return [];
    const violations = [];
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^import\s+(UIKit|SwiftUI)/);
      if (m) {
        violations.push(makeViolation(
          'domain_no_ui_import',
          'error',
          ctx.filePath,
          i + 1,
          `Domain layer must not import UI framework '${m[1]}'. Keep domain framework-agnostic.`,
          `Remove 'import ${m[1]}'. Use value types and protocols; UI-specific logic belongs in Presentation.`,
          m[0].trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Rule 5: no_force_unwrap_in_prod ─────────────────────────────────────────

/**
 * Warn on force-unwrap (!) in non-test files. Disabled by default.
 */
const noForceUnwrapInProd = {
  id: 'no_force_unwrap_in_prod',
  severity: 'warning',

  check(ctx) {
    // Skip test files
    const fp = ctx.filePath.toLowerCase();
    if (fp.includes('test') || fp.includes('spec') || fp.includes('mock')) return [];
    const violations = [];
    const forcePattern = /\w!\s*(?![=!])/g;
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment lines
      if (line.trim().startsWith('//')) continue;
      let m;
      forcePattern.lastIndex = 0;
      while ((m = forcePattern.exec(line)) !== null) {
        // Skip "!=" and "!!" and "as!" patterns (common safe use) — just flag the rest
        const before = line.slice(0, m.index);
        // Skip string literals context heuristic
        violations.push(makeViolation(
          'no_force_unwrap_in_prod',
          'warning',
          ctx.filePath,
          i + 1,
          'Force unwrap (!) can cause runtime crash. Prefer optional binding (guard let / if let).',
          'Replace force unwrap with safe optional binding or provide a default value.',
          m[0].trim()
        ));
        break; // one per line to avoid spam
      }
    }
    return violations;
  }
};

// ─── Rule 6: singleton_limit ─────────────────────────────────────────────────

/**
 * Warn if adding static let shared/instance pattern exceeds max_count in repo.
 * Scans quickly via string match in project source files.
 */
const singletonLimit = {
  id: 'singleton_limit',
  severity: 'warning',

  check(ctx, ruleConfig) {
    const maxCount = (ruleConfig && ruleConfig.max_count) || 5;
    // Check if this file adds a singleton pattern
    const newSingletonMatch = ctx.content.match(/static\s+let\s+(shared|instance)\s*[=:]/);
    if (!newSingletonMatch) return [];

    // P1-5: per-process TTL cache — singleton count rarely changes within seconds.
    // Without cache, every Edit/Write event scans entire Sources/ tree (slow on large repos).
    let existingCount = 0;
    try {
      existingCount = getSingletonCountCached(ctx.filePath, (ruleConfig && ruleConfig.cache_ttl_seconds) || 30);
    } catch {
      // Fail-open: if scan fails, skip this rule
      return [];
    }

    // The file itself contributes 1 — we're interested in total after this edit
    // If the file already existed with a singleton, count stays same; if new, +1
    // Conservative: if existingCount (excluding current) >= maxCount → warn
    const countWithoutSelf = existingCount; // scan includes current file state on disk (pre-edit)
    if (countWithoutSelf >= maxCount) {
      return [makeViolation(
        'singleton_limit',
        'warning',
        ctx.filePath,
        findLineNumber(ctx.lines, /static\s+let\s+(shared|instance)/),
        `Singleton count (${countWithoutSelf}) meets or exceeds limit (${maxCount}). Singletons are a code smell — consider dependency injection.`,
        'Refactor to use dependency injection instead of global singletons.',
        newSingletonMatch[0].trim()
      )];
    }
    return [];
  }
};

// P1-5: per-process TTL cache for singleton scan results.
// Keyed by searchRoot so multi-project sessions stay correct.
const _singletonCache = new Map(); // searchRoot → { count, expiresAt }

function getSingletonCountCached(currentFilePath, ttlSeconds) {
  const searchRoot = findIosSearchRoot(currentFilePath);
  if (!searchRoot) return 0;

  const now = Date.now();
  const cached = _singletonCache.get(searchRoot);
  if (cached && cached.expiresAt > now) return cached.count;

  const count = countSingletonsInSource(currentFilePath);
  _singletonCache.set(searchRoot, { count, expiresAt: now + ttlSeconds * 1000 });
  return count;
}

function findIosSearchRoot(currentFilePath) {
  let dir = path.dirname(currentFilePath);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'Sources')) || fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Count 'static let shared' or 'static let instance' occurrences in source files.
 * Searches in typical iOS source dirs.
 */
function countSingletonsInSource(currentFilePath) {
  let count = 0;
  // Start from project root heuristic: go up from the file until we find src/ or Sources/
  let dir = path.dirname(currentFilePath);
  let searchRoot = null;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'Sources')) || fs.existsSync(path.join(dir, 'src'))) {
      searchRoot = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!searchRoot) return 0;

  // Search for Swift files
  const swiftDirs = [];
  for (const sub of ['Sources', 'src', 'Source']) {
    const d = path.join(searchRoot, sub);
    if (fs.existsSync(d)) swiftDirs.push(d);
  }
  if (swiftDirs.length === 0) swiftDirs.push(searchRoot);

  for (const sd of swiftDirs) {
    count += countInDir(sd, /static\s+let\s+(shared|instance)\s*[=:]/, '.swift');
  }
  return count;
}

function countInDir(dir, pattern, ext) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip common non-source dirs
        if (['Pods', '.build', 'build', 'DerivedData', 'node_modules'].includes(entry.name)) continue;
        count += countInDir(full, pattern, ext);
      } else if (entry.name.endsWith(ext)) {
        try {
          const content = fs.readFileSync(full, 'utf8');
          const matches = content.match(new RegExp(pattern.source, 'g'));
          if (matches) count += matches.length;
        } catch { /* skip unreadable file */ }
      }
    }
  } catch { /* skip unreadable dir */ }
  return count;
}

function findLineNumber(lines, pattern) {
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return 0;
}

// ─── Export ───────────────────────────────────────────────────────────────────

const IOS_RULES = [
  noPresImportsInfra,
  viewmodelNoNetwork,
  publicApiNeedsDoc,
  domainNoUiImport,
  noForceUnwrapInProd,
  singletonLimit
];

module.exports = {
  IOS_RULES,
  noPresImportsInfra,
  viewmodelNoNetwork,
  publicApiNeedsDoc,
  domainNoUiImport,
  noForceUnwrapInProd,
  singletonLimit
};
