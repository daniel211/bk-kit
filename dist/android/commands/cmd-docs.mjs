/**
 * cmd-docs.mjs — `mk docs` command: scan, build, and serve the beer-kit docs site.
 *
 * Flow: scan src/ markdown → build static HTML via template engine → serve or write-only.
 * Options: --port (default 3000), --build-only (skip serving).
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanDocs } from '../lib/docs-scanner.mjs';
import { serveDocs } from '../lib/docs-server.mjs';
import { buildDocs } from '../lib/docs-builder.mjs';

/** Auto-detect language from system locale. Defaults to 'vi'. */
function detectLang() {
  const locale = (process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '').toLowerCase();
  if (locale.startsWith('vi')) return 'vi';
  if (locale.startsWith('en')) return 'en';
  return 'vi'; // default Vietnamese
}

/**
 * Resolve the scan directory. Priority:
 * 1. Explicit --src flag
 * 2. .claude/ in current working directory (end-user project)
 * 3. kit/ relative to CLI package (npm installed)
 * 4. src/ relative to repo root (dev mode)
 */
function resolveScanDir(explicitSrc) {
  if (explicitSrc) return resolve(explicitSrc);
  // End-user: .claude/ in their project
  const claudeDir = resolve(process.cwd(), '.claude');
  if (existsSync(join(claudeDir, 'agents'))) return claudeDir;
  // npm package: kit/ directory next to CLI
  const kitDir = resolve(import.meta.dirname, '../../kit');
  if (existsSync(kitDir)) return kitDir;
  // Dev mode: src/ in repo root
  return resolve(import.meta.dirname, '../../../../src');
}

/** Default path to HTML templates directory (relative to this file). */
const DEFAULT_TEMPLATE_DIR = resolve(import.meta.dirname, '../templates/docs');

/**
 * Register the `docs` command with commander.
 * @param {import('commander').Command} program
 * @param {string} platform
 */
export function registerDocs(program, platform) {
  program
    .command('docs')
    .description('Scan src/ and serve a static documentation site')
    .option('--port <number>', 'Port to serve docs on', '3000')
    .option('--src <dir>', 'Path to scan directory (.claude/, kit/, or src/)')
    .option('--out <dir>', 'Output directory for built docs', resolve(import.meta.dirname, '../.docs-out'))
    .option('--templates <dir>', 'Path to HTML templates directory', DEFAULT_TEMPLATE_DIR)
    .option('--lang <code>', 'Language: en or vi (auto-detects from system locale)', detectLang())
    .option('--build-only', 'Build static HTML without starting the server')
    .action(async (opts) => {
      const srcDir = resolveScanDir(opts.src);
      const outDir = resolve(opts.out);
      const templateDir = resolve(opts.templates);
      const port = parseInt(opts.port, 10);
      const lang = opts.lang === 'vi' ? 'vi' : 'en';

      if (!existsSync(srcDir)) {
        console.error(`Error: src directory not found at ${srcDir}`);
        console.error('Use --src <path> to specify the beer-kit src/ directory.');
        process.exit(1);
      }

      console.log(`Scanning docs from ${srcDir}...\n`);

      // Step 1: Scan markdown files into a structured catalog
      const catalog = scanDocs(srcDir);
      console.log(`  Found ${catalog.agents.length} agents, ${catalog.skills.length} skills, ${catalog.rules.length} rules`);

      // Step 2: Build static HTML using template engine
      console.log(`\nBuilding docs into ${outDir}...`);
      buildDocs(catalog, templateDir, outDir, platform, lang);
      console.log(`  Build complete (lang: ${lang})\n`);

      if (opts.buildOnly) {
        console.log(`Docs written to: ${outDir}`);
        return;
      }

      // Step 3: Serve and keep process alive until Ctrl+C
      try {
        await serveDocs(outDir, port);
        process.on('SIGINT', () => {
          console.log('\nServer stopped.');
          process.exit(0);
        });
      } catch (err) {
        console.error(`Failed to start docs server: ${err.message}`);
        process.exit(1);
      }
    });
}
