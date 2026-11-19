/**
 * arch-rules-android.cjs — Architecture fitness rules for Kotlin/Java Android (Clean Architecture + MVVM).
 *
 * 4 rules:
 *   1. no_presentation_imports_data  — error
 *   2. viewmodel_no_network          — error
 *   3. domain_no_android_import      — error
 *   4. public_api_needs_kdoc         — warning
 *
 * Each rule: { id, severity, check(ctx, ruleConfig) → Violation[] }
 */

'use strict';

const { makeViolation } = require('./arch-rule-runner.cjs');

// ─── Rule 1: no_presentation_imports_data ────────────────────────────────────

/**
 * Files in presentation/ui/screens layer must NOT import data layer packages
 * (Retrofit, OkHttp, Room, etc.).
 */
const noPresImportsData = {
  id: 'no_presentation_imports_data',
  severity: 'error',

  check(ctx) {
    if (ctx.layerInfo.layer !== 'presentation') return [];
    const violations = [];
    const dataImportPattern = /^import\s+.*?(retrofit2|okhttp3|OkHttp|Retrofit|Room|androidx\.room|com\.squareup\.retrofit|com\.squareup\.okhttp)/;
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(dataImportPattern);
      if (m) {
        violations.push(makeViolation(
          'no_presentation_imports_data',
          'error',
          ctx.filePath,
          i + 1,
          `Presentation layer must not import data layer package. Found: '${m[0].trim()}'.`,
          'Move data-access logic to the Data layer. Inject a Repository interface via constructor/DI.',
          m[0].trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Rule 2: viewmodel_no_network ────────────────────────────────────────────

/**
 * Classes ending with 'ViewModel' must not use network clients directly.
 */
const viewmodelNoNetwork = {
  id: 'viewmodel_no_network',
  severity: 'error',

  check(ctx) {
    if (!ctx.content.match(/\b\w*ViewModel\b/)) return [];
    const violations = [];
    const networkPattern = /Retrofit\.Builder\(|new\s+OkHttpClient\(|HttpURLConnection|retrofit2\.Retrofit|okhttp3\.OkHttpClient|\.enqueue\s*\(|\bnewCall\s*\(/;
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(networkPattern);
      if (m) {
        violations.push(makeViolation(
          'viewmodel_no_network',
          'error',
          ctx.filePath,
          i + 1,
          'ViewModel must not call network directly. Use UseCase/Repository via constructor injection.',
          'Inject a UseCase or Repository through the ViewModel constructor (Hilt @HiltViewModel).',
          m[0].trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Rule 3: domain_no_android_import ────────────────────────────────────────

/**
 * Domain layer files must not import android.* or androidx.* (except androidx.annotation).
 */
const domainNoAndroidImport = {
  id: 'domain_no_android_import',
  severity: 'error',

  check(ctx) {
    if (ctx.layerInfo.layer !== 'domain') return [];
    const violations = [];
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match android.* or androidx.* imports but allow androidx.annotation
      const androidMatch = line.match(/^import\s+(android\.|androidx\.(?!annotation))/);
      if (androidMatch) {
        violations.push(makeViolation(
          'domain_no_android_import',
          'error',
          ctx.filePath,
          i + 1,
          `Domain layer must not import Android framework. Found: '${line.trim()}'. Keep domain pure Kotlin.`,
          'Remove Android imports from domain. Use interface abstractions; implement in data layer.',
          line.trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Rule 4: public_api_needs_kdoc ───────────────────────────────────────────

/**
 * Public class/fun/object/interface must have a KDoc comment (slash-star-star) above.
 */
const publicApiNeedsKdoc = {
  id: 'public_api_needs_kdoc',
  severity: 'warning',

  check(ctx) {
    const violations = [];
    // Match public/open declarations at start of line (after optional annotations)
    const pubPattern = /^(?:@\w+\s*)*\s*(?:public\s+)?(?:open\s+)?(?:abstract\s+)?(class|fun|object|interface|data class|sealed class)\s+(\w+)/;
    const lines = ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip indented declarations (methods inside a class body) — only flag top-level or class-level
      if (line.match(/^\s+/)) continue;
      const m = line.match(/^\s*(?:public\s+)?(class|fun|object|interface|data class|sealed class)\s+(\w+)/);
      if (!m) continue;
      // Check if there's a KDoc comment above (/** or * pattern)
      let hasKdoc = false;
      for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
        const prev = lines[j].trim();
        if (prev === '*/') { hasKdoc = true; break; }
        if (prev.startsWith('/**') || prev.startsWith('* ') || prev === '*') { hasKdoc = true; break; }
        if (prev === '' || prev.startsWith('@')) continue;
        break;
      }
      if (!hasKdoc) {
        violations.push(makeViolation(
          'public_api_needs_kdoc',
          'warning',
          ctx.filePath,
          i + 1,
          `${m[1]} '${m[2]}' is missing a KDoc comment (/** */).`,
          `Insert directly above \`${lines[i].trim().slice(0, 60)}\`: "/** <one-line summary of what ${m[2]} does> */". To silence this rule project-wide set arch_fitness.android.rules.public_api_needs_kdoc.enabled=false in bk-harness-policy.json.`,
          lines[i].trim()
        ));
      }
    }
    return violations;
  }
};

// ─── Export ───────────────────────────────────────────────────────────────────

const ANDROID_RULES = [
  noPresImportsData,
  viewmodelNoNetwork,
  domainNoAndroidImport,
  publicApiNeedsKdoc
];

module.exports = {
  ANDROID_RULES,
  noPresImportsData,
  viewmodelNoNetwork,
  domainNoAndroidImport,
  publicApiNeedsKdoc
};
