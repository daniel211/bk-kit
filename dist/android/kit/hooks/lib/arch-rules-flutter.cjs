/**
 * arch-rules-flutter.cjs — Architecture fitness rules for Dart/Flutter (Riverpod + Clean Architecture).
 *
 * 3 rules:
 *   1. domain_no_flutter_import    — error
 *   2. notifier_no_network         — error
 *   3. public_api_needs_dartdoc    — warning
 *
 * Each rule: { id, severity, check(ctx, ruleConfig) → Violation[] }
 */

'use strict';

const { makeViolation } = require('./arch-rule-runner.cjs');

// ─── Rule 1: domain_no_flutter_import ────────────────────────────────────────

/**
 * Files in domain layer must NOT import Flutter framework packages.
 */
const domainNoFlutterImport = {
  id: 'domain_no_flutter_import',
  severity: 'error',

  check(ctx) {
    if (ctx.layerInfo.layer !== 'domain') return [];
    const violations = [];
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^import\s+'package:flutter\//);
      if (m) {
        violations.push(makeViolation(
          'domain_no_flutter_import',
          'error',
          ctx.filePath,
          i + 1,
          `Domain layer must not import Flutter framework. Found: '${lines[i].trim()}'. Keep domain pure Dart.`,
          "Remove Flutter imports from domain layer. Use pure Dart interfaces; Flutter-specific code belongs in the presentation layer.",
          lines[i].trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Rule 2: notifier_no_network ─────────────────────────────────────────────

/**
 * Classes extending StateNotifier, ChangeNotifier, or AsyncNotifier
 * must not call network directly (http.get, Dio, etc.).
 */
const notifierNoNetwork = {
  id: 'notifier_no_network',
  severity: 'error',

  check(ctx) {
    // Check if file contains a Notifier class
    if (!ctx.content.match(/\bextends\s+(StateNotifier|ChangeNotifier|AsyncNotifier|AutoDisposeAsyncNotifier)\b/)) {
      return [];
    }
    const violations = [];
    const networkPattern = /\bhttp\.get\s*\(|Dio\s*\(\)|dio\.get\s*\(|dio\.post\s*\(|http\.post\s*\(|rootBundle\.loadString|HttpClient\s*\(/;
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(networkPattern);
      if (m) {
        violations.push(makeViolation(
          'notifier_no_network',
          'error',
          ctx.filePath,
          i + 1,
          'Notifier classes must not call network directly. Inject a Repository/DataSource.',
          'Inject a repository interface via the Notifier constructor or Riverpod ref.read().',
          m[0].trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Rule 3: public_api_needs_dartdoc ────────────────────────────────────────

/**
 * Public top-level class/function must have a '///' Dart doc comment above.
 */
const publicApiNeedsDartdoc = {
  id: 'public_api_needs_dartdoc',
  severity: 'warning',

  check(ctx) {
    const violations = [];
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match top-level (no indentation) public declarations
      // Dart: any top-level class/function not starting with _ is public
      const m = line.match(/^(class|abstract class|mixin|extension|enum)\s+([A-Z]\w*)|^([\w<>\[\]?]+)\s+([a-zA-Z]\w*)\s*\(/);
      if (!m) continue;
      // Skip private (starts with _)
      const name = m[2] || m[4] || '';
      if (name.startsWith('_')) continue;
      // Skip if line itself is inside a class (heuristic: check indentation)
      if (line.match(/^\s+/)) continue;

      // Check for preceding /// doc comment
      let hasDocs = false;
      for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
        const prev = lines[j].trim();
        if (prev.startsWith('///')) { hasDocs = true; break; }
        if (prev === '' || prev.startsWith('@')) continue;
        break;
      }
      if (!hasDocs) {
        const decl = m[1] || `${m[3]} ${m[4]}`;
        violations.push(makeViolation(
          'public_api_needs_dartdoc',
          'warning',
          ctx.filePath,
          i + 1,
          `Public declaration '${name}' is missing a Dart doc comment (///).`,
          `Add a /// doc comment above '${line.trim().slice(0, 60)}'.`,
          line.trim().slice(0, 80)
        ));
      }
    }
    return violations;
  }
};

// ─── Export ───────────────────────────────────────────────────────────────────

const FLUTTER_RULES = [
  domainNoFlutterImport,
  notifierNoNetwork,
  publicApiNeedsDartdoc
];

module.exports = {
  FLUTTER_RULES,
  domainNoFlutterImport,
  notifierNoNetwork,
  publicApiNeedsDartdoc
};
