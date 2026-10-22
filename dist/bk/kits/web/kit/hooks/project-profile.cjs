#!/usr/bin/env node
// project-profile.cjs - Build/update .bk-project-profile.json from foundation docs
// Trigger: SessionStart
// Purpose: Detect platform, architecture, and doc coverage from foundation docs
// Non-blocking (exit 0). Pure file generation — no stdout output.

'use strict';

// Outer crash wrapper
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');

  async function main() {
    const timer = createHookTimer('project-profile');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
      const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

      if (!isHookEnabled('project-profile')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Consume stdin (required for hook pattern)
      let input = '';
      for await (const chunk of process.stdin) input += chunk;

      // Check if foundation overview exists
      const root = resolveProjectRoot();
      const overviewPath = path.join(root, 'bk', 'docs', 'foundation', 'overview.md');
      if (!fs.existsSync(overviewPath)) {
        timer.end({ status: 'no_overview', exit: 0 });
        process.exit(0);
      }

      const overviewContent = fs.readFileSync(overviewPath, 'utf8');

      // Detect platform. Filesystem signals are authoritative; doc keywords are only a
      // fallback, and this order is the one core-rules.md and CLAUDE.md.tmpl already
      // document (pubspec.yaml -> flutter, xcodeproj -> ios, ios/+android/ -> monorepo,
      // build.gradle -> android), then python and web, the kit-resolver order.
      // platform: 'flutter'|'ios'|'android'|'monorepo'|'python'|'web'|'unknown'
      //
      // Keyword order alone misread EVERY Flutter repo as ios: a Flutter overview
      // legitimately names "iOS Keychain" and carries an `ios/` build-target row, and the
      // iOS keyword test ran first. fusionworkomni hit this and had to hand-patch its own
      // copy of this hook to get `flutter` back.
      const hasEntry = (...segments) => {
        try {
          return fs.existsSync(path.join(root, ...segments));
        } catch (_) {
          return false;
        }
      };
      // readdirSync throws on a missing/unreadable dir — swallow it, this hook is fail-open.
      const dirHasEntry = (dir, re) => {
        try {
          return fs.readdirSync(path.join(root, dir)).some((f) => re.test(f));
        } catch (_) {
          return false;
        }
      };
      const XCODE_PROJECT = /\.xc(workspace|odeproj)$/;
      // python / web: the same root markers as kit-resolver.mjs (bk init), tested AFTER the
      // mobile ones — a mobile repo often carries a requirements.txt or a package.json for its
      // tooling. web needs a package.json PLUS a TS / bundler config next to it.
      const PYTHON_MARKER = /^(?:pyproject\.toml|requirements\.txt|manage\.py|setup\.py)$/;
      const WEB_CONFIG = /^(?:tsconfig\.json|(?:next|vite)\.config\.[cm]?[jt]s)$/;

      let platform = 'unknown';
      if (hasEntry('pubspec.yaml')) {
        platform = 'flutter';
      } else if (dirHasEntry('ios', XCODE_PROJECT) || dirHasEntry('.', XCODE_PROJECT)) {
        // Both ios/ and android/ present without a pubspec.yaml is the documented
        // `monorepo` value, not a new one.
        platform = hasEntry('android') ? 'monorepo' : 'ios';
      } else if (
        hasEntry('android', 'build.gradle') || hasEntry('android', 'build.gradle.kts')
        || hasEntry('build.gradle') || hasEntry('build.gradle.kts')
      ) {
        platform = 'android';
      } else if (dirHasEntry('.', PYTHON_MARKER)) {
        platform = 'python';
      } else if (hasEntry('package.json') && dirHasEntry('.', WEB_CONFIG)) {
        platform = 'web';
      } else if (/Flutter|Dart|pubspec/i.test(overviewContent)) {
        platform = 'flutter';
      } else if (/iOS|Swift|UIKit|SwiftUI|Xcode/i.test(overviewContent)) {
        platform = 'ios';
      } else if (/Android|Kotlin|Jetpack|Gradle/i.test(overviewContent)) {
        platform = 'android';
      } else if (/\bPython\b|FastAPI|Django|Flask|pytest|pyproject/i.test(overviewContent)) {
        platform = 'python';
      } else if (/\bReact\b|Next\.js|\bVite\b/i.test(overviewContent)) {
        platform = 'web';
      }

      // Count source file references (rough estimate of project size)
      const fileRefMatches = overviewContent.match(/\.\w{1,5}(?:\s|$|,|\))/gm) || [];
      const sourceFileCount = fileRefMatches.length;

      // Estimate complexity from source file count
      let complexity_estimate = 'medium';
      if (sourceFileCount < 5) {
        complexity_estimate = 'low';
      } else if (sourceFileCount >= 15) {
        complexity_estimate = 'high';
      }

      // Read architecture.md if exists → extract pattern keywords
      let architecture = 'unknown';
      const archPath = path.join(root, 'bk', 'docs', 'foundation', 'architecture.md');
      if (fs.existsSync(archPath)) {
        const archContent = fs.readFileSync(archPath, 'utf8');
        if (/\bVIPER\b/i.test(archContent)) {
          architecture = 'VIPER';
        } else if (/\bMVVM\b/i.test(archContent)) {
          architecture = 'MVVM';
        } else if (/\bClean\s*Architecture\b/i.test(archContent)) {
          architecture = 'Clean';
        } else if (/\bMVC\b/i.test(archContent)) {
          architecture = 'MVC';
        } else if (/\bMVP\b/i.test(archContent)) {
          architecture = 'MVP';
        }
      }

      // Detect what docs exist in bk/docs/foundation/
      const foundationDir = path.join(root, 'bk', 'docs', 'foundation');
      let foundationFiles = [];
      try {
        foundationFiles = fs.readdirSync(foundationDir).map(f => f.toLowerCase());
      } catch { /* directory not readable */ }

      const has_brd = foundationFiles.some(f => f.includes('brd') || f.includes('requirements'));
      const has_design_system = foundationFiles.some(f => f.includes('design') || f.includes('tokens'));
      const has_api_specs = foundationFiles.some(f => f.includes('api') || f.includes('openapi') || f.includes('swagger'));

      // Also check raw scan files
      const rawDir = path.join(foundationDir, '_raw');
      if (fs.existsSync(rawDir)) {
        try {
          const rawFiles = fs.readdirSync(rawDir).map(f => f.toLowerCase());
          if (rawFiles.some(f => f.includes('api'))) {
            // has_api_specs already covered above
          }
        } catch { /* ignore */ }
      }

      // Build profile object
      const profile = {
        platform,
        architecture,
        complexity_estimate,
        has_brd,
        has_design_system,
        has_api_specs,
        updated_at: new Date().toISOString()
      };

      // Write .bk-project-profile.json to project root
      const profilePath = path.join(root, '.bk-project-profile.json');
      fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));

      timer.end({ status: 'ok', platform, architecture, exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a
  // crash. Logging it here is how a clean run got filed as `status: "crash"`.
  if (e && e.bkDispatchExit) throw e;

  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'project-profile', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'project-profile', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0); // Fail-open
}
