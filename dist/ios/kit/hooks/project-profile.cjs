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
      const overviewPath = path.join(root, 'mk', 'docs', 'foundation', 'overview.md');
      if (!fs.existsSync(overviewPath)) {
        timer.end({ status: 'no_overview', exit: 0 });
        process.exit(0);
      }

      const overviewContent = fs.readFileSync(overviewPath, 'utf8');

      // Detect platform from keywords
      let platform = 'unknown';
      if (/iOS|Swift|UIKit|SwiftUI|Xcode/i.test(overviewContent)) {
        platform = 'ios';
      } else if (/Android|Kotlin|Jetpack|Gradle/i.test(overviewContent)) {
        platform = 'android';
      } else if (/Flutter|Dart|pubspec/i.test(overviewContent)) {
        platform = 'flutter';
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
      const archPath = path.join(root, 'mk', 'docs', 'foundation', 'architecture.md');
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

      // Detect what docs exist in mk/docs/foundation/
      const foundationDir = path.join(root, 'mk', 'docs', 'foundation');
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
