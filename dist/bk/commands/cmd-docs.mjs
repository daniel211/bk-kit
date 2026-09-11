/**
 * cmd-docs.mjs — `bk docs` command: scan, build, and serve the beer-kit docs site.
 *
 * Flow: scan src/ markdown → build static HTML via template engine → serve or write-only.
 * Options: --port (default 3000), --build-only (skip serving).
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanDocs } from '../lib/docs-scanner.mjs';
import { serveDocs } from '../lib/docs-server.mjs';
import { buildDocs } from '../lib/docs-builder.mjs';
import { kitLayout, packageRootFrom } from '../lib/package-layout.mjs';
import { addKitOption, resolveKitOrExit } from '../lib/kit-resolver.mjs';

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
 * 3. the resolved kit's kit/ inside the package (npm installed)
 * 4. src/ relative to repo root (dev mode)
 *
 * @param {string|undefined} explicitSrc — value of --src
 * @param {{kitDir: string}} layout — the resolved kit's layout
 */
function resolveScanDir(explicitSrc, layout) {
  if (explicitSrc) return resolve(explicitSrc);
  // End-user: .claude/ in their project
  const claudeDir = resolve(process.cwd(), '.claude');
  if (existsSync(join(claudeDir, 'agents'))) return claudeDir;
  // npm package: the resolved kit's own kit/ tree
  if (existsSync(layout.kitDir)) return layout.kitDir;
  // Dev mode: src/ in repo root
  return resolve(import.meta.dirname, '../../../../src');
}

/**
 * Register the `docs` command with commander.
 * @param {import('commander').Command} program
 */
export function registerDocs(program) {
  const command = program
    .command('docs')
    .description('Scan src/ and serve a static documentation site')
    .option('--port <number>', 'Port to serve docs on', '3000')
    .option('--src <dir>', 'Path to scan directory (.claude/, kit/, or src/)')
    .option('--out <dir>', 'Output directory for built docs (default: <package>/.docs-out)')
    .option('--templates <dir>', 'Path to HTML templates directory (default: the kit\'s templates/docs)')
    .option('--lang <code>', 'Language: en or vi (auto-detects from system locale)', detectLang())
    .option('--build-only', 'Build static HTML without starting the server');

  addKitOption(command)
    .action(async (opts) => {
      // The docs templates and the scanned kit are both per-platform, so the defaults for --out
      // and --templates cannot be computed at registration time the way they were when the
      // platform was baked into the binary — they depend on which kit this run resolves to.
      const pkgRoot = packageRootFrom(import.meta.dirname);
      const platform = resolveKitOrExit({
        packageRoot: pkgRoot,
        targetDir: resolve(process.cwd()),
        explicit: opts.kit,
      });
      const layout = kitLayout(pkgRoot, platform);

      const srcDir = resolveScanDir(opts.src, layout);
      const outDir = resolve(opts.out || join(pkgRoot, '.docs-out'));
      const templateDir = resolve(opts.templates || join(layout.templatesDir, 'docs'));
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
