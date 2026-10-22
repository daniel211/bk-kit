#!/usr/bin/env node
// descriptive-name.cjs - PreToolUse hook: validate file naming conventions per platform
// Template variables: python, snake_case
// Trigger: PreToolUse (Write|Edit)
// Purpose: Warn when filenames don't match platform convention — always fail-open

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const path = require('path');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

  // Template-injected values
  const PLATFORM = 'python';
  const NAMING_CONVENTION = 'snake_case';

  // Per-platform naming rules: { exts, pattern, label } or { exts, check(basename, filePath), label }.
  // `pattern` is a single regex on the basename. `check` is for ecosystems whose idiomatic
  // projects mix several conventions, where one regex either false-positives or says nothing.
  // Every rule is ADVISORY: a mismatch writes a warning and exits 0. The bar for the python and
  // web rules is zero false positives on idiomatic projects — when unsure, a name is allowed.

  // python — PEP 8 module names: lowercase snake_case, `.py` and `.pyi` stubs alike.
  //   - dunder modules (`__init__.py`, `__main__.py`, `__about__.py`) and a leading `_` for
  //     private modules (`_compat.py`) are idiomatic;
  //   - `conftest.py`, `test_*.py`, `*_test.py` are already snake_case and need no case;
  //   - migration files under `versions/` (Alembic) or `migrations/` (Django) are named by the
  //     tool, not the author — `20240101_abcd_add_status.py`, `0001_initial.py`,
  //     `2024_01_01_1200-abcd_add_status.py` — so a leading digit and `-` are allowed there;
  //   - hyphens are allowed under `scripts/` / `bin/`: those files are run, not imported, and a
  //     hyphen only matters because it makes a module unimportable — which is exactly the bug
  //     the warning is for everywhere else.
  const PY_MODULE = /^(__[a-z][a-z0-9_]*__|_*[a-z][a-z0-9_]*)\.pyi?$/;
  const PY_TOOL_NAMED = /^[A-Za-z0-9][A-Za-z0-9_-]*\.pyi?$/;
  const PY_SCRIPT = /^_*[a-z][a-z0-9_-]*\.pyi?$/;
  function checkPython(basename, filePath) {
    if (PY_MODULE.test(basename)) return true;
    const dirs = path.dirname(String(filePath)).split(/[\\/]/);
    const parent = dirs[dirs.length - 1];
    if ((parent === 'versions' || parent === 'migrations') && PY_TOOL_NAMED.test(basename)) return true;
    if (dirs.some((d) => d === 'scripts' || d === 'bin') && PY_SCRIPT.test(basename)) return true;
    return false;
  }

  // web — JS/TS modules. Real React/Next/Vite projects legitimately mix kebab-case
  // (`user-card.tsx`), PascalCase components (`UserCard.tsx`) and camelCase (`useAuth.ts`,
  // `apiClient.ts`, `setupTests.ts`), so each is accepted. The basename is split on `.` and
  // every segment before the extension is checked on its own, which covers the compound names
  // without listing them: `user-card.test.tsx`, `Button.stories.tsx`, `vite.config.ts`,
  // `next.config.mjs`, `env.d.ts`, `user.service.ts`. Router file conventions are unwrapped
  // before the check — Next `[id]`, `[...slug]`, `[[...slug]]`, `_app`; Remix flat routes
  // `_index`, `posts.$postId`, `posts_.$id.edit`, `$`; TanStack `__root`; SvelteKit `+page`;
  // Gatsby `{mdx.slug}`; Next `404`/`500`. Next's special files (`page`, `layout`, `route`,
  // `loading`, `error`, `not-found`, `middleware`) are plain kebab-case already. Timestamped
  // migrations (knex `20240101120000_create_users.js`, TypeORM `1700000000000-CreateUsers.ts`)
  // and dotfiles (`.eslintrc.cjs`) are allowed whole. What still warns: snake_case
  // (`user_card.tsx`), Pascal-kebab hybrids (`User-Card.tsx`), spaces and other stray characters.
  const WEB_SEGMENT = /^([a-z0-9]+(-[a-z0-9]+)*|[a-z][A-Za-z0-9]*|[A-Z][A-Za-z0-9]*)$/;
  const WEB_MIGRATION = /^\d{4,}[-_][A-Za-z0-9_-]+\.[a-z]+$/;
  function checkWebSegment(seg) {
    // Dynamic-route params carry identifiers, not file names: any identifier is fine inside.
    if (/^\[{1,2}(\.\.\.)?[A-Za-z0-9_-]+\]{1,2}$/.test(seg)) return true;   // [id] [...slug] [[...slug]]
    if (/^\{[A-Za-z0-9_.-]+\}$/.test(seg)) return true;                      // {mdx.slug}
    if (/^\$[A-Za-z0-9_]*$/.test(seg)) return true;                          // $postId, $
    if (/^\([A-Za-z0-9_-]+\)$/.test(seg)) return true;                       // (group)
    const core = seg.replace(/^[_+@]+/, '').replace(/_+$/, '');              // _index __root +page posts_
    if (core === '') return seg.length > 0;
    return WEB_SEGMENT.test(core);
  }
  function checkWeb(basename) {
    if (basename.startsWith('.')) return true;
    if (WEB_MIGRATION.test(basename)) return true;
    // Dots inside a route token are not separators: Next's `[...slug]`, `[[...slug]]` and
    // Gatsby's `{mdx.slug}` stay whole, and Remix's escaped-dot `sitemap[.]xml.tsx` is read as
    // the plain segments it stands for.
    const name = basename.replace(/\[\.\]/g, '.');
    const segments = name.match(/\[[^\]]*\]+|\{[^}]*\}|[^.]+/g) || [];
    segments.pop(); // extension
    return segments.length > 0 && segments.every(checkWebSegment);
  }

  const NAMING_RULES = {
    ios:     { exts: ['.swift'],       pattern: /^[A-Z][A-Za-z0-9]*\.swift$/, label: 'PascalCase' },
    android: { exts: ['.kt', '.java'], pattern: /^[A-Z][A-Za-z0-9]*\.(kt|java)$/, label: 'PascalCase' },
    flutter: { exts: ['.dart'],        pattern: /^[a-z][a-z0-9_]*\.dart$/, label: 'snake_case' },
    python:  { exts: ['.py', '.pyi'],  check: checkPython, label: 'snake_case',
               expected: 'snake_case module (e.g. user_service.py, __init__.py, test_users.py)' },
    web:     { exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'], check: checkWeb,
               label: 'kebab-case / PascalCase / camelCase',
               expected: 'kebab-case, PascalCase or camelCase per dot-segment (e.g. user-card.tsx, UserCard.tsx, useAuth.ts)' }
  };

  /** Does a basename satisfy the rule? Rules carry either a regex or a check function. */
  function matchesRule(rule, basename, filePath) {
    return rule.check ? rule.check(basename, filePath) : rule.pattern.test(basename);
  }

  async function main() {
    const timer = createHookTimer('descriptive-name');
    try {
      if (!isHookEnabled('descriptive-name')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const filePath = toolInput.file_path || toolInput.path || '';
      if (!filePath) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const basename = path.basename(filePath);
      const platform = (PLATFORM && !PLATFORM.startsWith('{{')) ? PLATFORM : 'unknown';
      const rule = NAMING_RULES[platform];

      // No rule for this platform — skip silently
      if (!rule) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const ext = path.extname(basename);
      if (!rule.exts.includes(ext)) {
        // Not a file type we validate for this platform
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // A `check` rule accepts more than the platform context's single fileNaming value (web's
      // is "kebab-case" yet PascalCase components pass), so its own label names the convention.
      const convention = rule.check ? rule.label : (NAMING_CONVENTION || rule.label);
      if (!matchesRule(rule, basename, filePath)) {
        // Warn only — never block (fail-open)
        process.stderr.write(
          `[NAMING] Warning: "${basename}" doesn't match ${platform} ${convention} convention.\n` +
          (rule.expected ? `  Expected: ${rule.expected}\n` : `  Expected pattern: ${rule.pattern}\n`) +
          `  Continuing — fix name if this is a new file.\n`
        );
        timer.end({ status: 'warn', file: basename, exit: 0 });
      } else {
        timer.end({ status: 'ok', exit: 0 });
      }

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
    fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'descriptive-name', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  // Fail-open: naming validation must never block
  process.exit(0);
}
