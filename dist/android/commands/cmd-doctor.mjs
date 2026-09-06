/**
 * cmd-doctor.mjs — Validate .claude/ kit installation health.
 *
 * Checks file existence, JSON validity, and optional hash integrity.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Check whether an executable is on PATH, on any host OS.
 *
 * `which` is neither present on Windows nor guaranteed by POSIX; `where` is the
 * Windows equivalent and `command -v` is the portable shell builtin elsewhere.
 *
 * @param {string} bin
 * @returns {boolean}
 */
function hasCommand(bin) {
  const probe = process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`;
  try {
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Install hint for Antigravity CLI, the reviewer's backing CLI since kit 0.2.0.
 *
 * Matched to the host: `agy` runs natively on macOS, Linux and Windows, but the install
 * channel differs. The retired `gemini` CLI is deliberately not offered.
 *
 * @returns {string}
 */
function agyInstallHint() {
  if (process.platform === 'darwin') return '"brew install --cask antigravity-cli"';
  if (process.platform === 'win32') return 'the installer at https://antigravity.google/docs/cli/install/';
  return '"curl -fsSL https://antigravity.google/cli/install.sh | bash"';
}

/**
 * Run doctor checks on an installed kit.
 *
 * @param {string} targetDir — project root containing .claude/
 * @param {string} platform
 * @returns {{ passed: number, warnings: number, errors: number }}
 */
export function runDoctor(targetDir, platform) {
  const claudeDir = join(targetDir, '.claude');
  const versionPath = join(targetDir, '.bk-version.json');
  let passed = 0;
  let warnings = 0;
  let errors = 0;

  function check(label, fn) {
    try {
      const result = fn();
      if (result === true) {
        console.log(`  ✓ ${label}`);
        passed++;
      } else if (result === 'warn') {
        console.log(`  ⚠ ${label}`);
        warnings++;
      } else {
        console.log(`  ✗ ${label}`);
        errors++;
      }
    } catch (err) {
      console.log(`  ✗ ${label}: ${err.message}`);
      errors++;
    }
  }

  // 1. .claude/ exists
  check('.claude/ directory exists', () => existsSync(claudeDir));

  // 2. .bk-version.json exists and is valid
  check('.bk-version.json exists and valid', () => {
    if (!existsSync(versionPath)) return false;
    const data = JSON.parse(readFileSync(versionPath, 'utf8'));
    return !!(data.version && data.platform && data.files);
  });

  // 3. platform-context.json exists and valid
  check('platform-context.json valid', () => {
    const ctxPath = join(claudeDir, 'platform-context.json');
    if (!existsSync(ctxPath)) return false;
    const data = JSON.parse(readFileSync(ctxPath, 'utf8'));
    return data.platform === platform;
  });

  // 4. settings.json exists and valid (CR-P1-26)
  check('settings.json valid', () => {
    const settingsPath = join(claudeDir, 'settings.json');
    if (!existsSync(settingsPath)) return false;
    const data = JSON.parse(readFileSync(settingsPath, 'utf8'));
    // Validate required sections
    if (!data.hooks) return 'warn';
    // Check hooks reference existing files
    let missingHooks = 0;
    for (const entries of Object.values(data.hooks)) {
      for (const group of entries) {
        for (const hook of (group.hooks || [])) {
          const cmd = hook.command || '';
          // Extract hook filename from patterns like:
          // bash -c 'node "$(git rev-parse ...)/.claude/hooks/foo.cjs"'
          // node .claude/hooks/foo.cjs
          const match = cmd.match(/\.claude\/hooks\/([^\s"']+)/);
          if (match) {
            const hookPath = join('hooks', match[1]);
            if (!existsSync(join(claudeDir, hookPath))) {
              missingHooks++;
            }
          }
        }
      }
    }
    if (missingHooks > 0) {
      console.log(`    ${missingHooks} hook file(s) referenced but missing`);
      return false;
    }
    // Validate MCP servers have command or note field
    if (data.mcpServers) {
      for (const [name, config] of Object.entries(data.mcpServers)) {
        if (!config.command && !config.url && !config.note) {
          console.log(`    MCP server "${name}" has no command, url, or note`);
          return 'warn';
        }
      }
    }
    return true;
  });

  // 5. Core directories exist
  for (const dir of ['agents', 'skills', 'hooks', 'rules']) {
    check(`${dir}/ directory exists`, () => existsSync(join(claudeDir, dir)));
  }

  // 6. Check files from .bk-version.json exist
  if (existsSync(versionPath)) {
    const versionData = JSON.parse(readFileSync(versionPath, 'utf8'));
    const files = versionData.files || {};
    const fileList = Object.keys(files);
    let missing = 0;

    for (const relPath of fileList) {
      if (!existsSync(join(claudeDir, relPath))) {
        missing++;
      }
    }

    check(`All ${fileList.length} kit files present`, () => {
      if (missing === 0) return true;
      console.log(`    ${missing} file(s) missing`);
      return false;
    });
  }

  // 7. Optional tool check: Antigravity CLI, which backs bk-gemini-reviewer since 0.2.0.
  //    Optional by design — /bk-review --engine claude needs no external CLI — so a missing
  //    binary is a warning with a way forward, not an error.
  check('agy CLI available (bk-gemini-reviewer, optional)', () => {
    if (hasCommand('agy')) return true;
    console.log('    Optional: Antigravity CLI ("agy") not found, so bk-gemini-reviewer cannot run.');
    console.log(`    Install it with ${agyInstallHint()}, then run "agy" once to authenticate.`);
    console.log('    Or skip it — "/bk-review --engine claude" works with no setup.');
    return 'warn';
  });

  // 8. Figma access, which backs the design extraction trio (design-validator,
  //    design-spec-writer, design-asset-exporter). Both engines read Figma over its REST
  //    API, so the only requirement is a token — there is no MCP server to check. Design
  //    work is optional, so a missing token is a warning, never an error.
  check('Figma token available (design extraction, optional)', () => {
    const names = ['FIGMA_API_KEY', 'FIGMA_ACCESS_TOKEN', 'FIGMA_TOKEN'];
    const fromEnv = names.find((name) => process.env[name]);
    if (fromEnv) {
      console.log(`    Found in the environment (${fromEnv}).`);
      return true;
    }

    // The same files figma-rest.mjs reads, in the same order. Only presence is checked —
    // the token itself is never read here, and never printed anywhere.
    const candidates = [
      join(homedir(), '.config', 'beer-kit', 'figma.env'),
      join(targetDir, '.env')
    ];
    const found = candidates.find((file) => {
      if (!existsSync(file)) return false;
      try {
        return names.some((name) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`, 'm')
          .test(readFileSync(file, 'utf8')));
      } catch (_) {
        return false;
      }
    });

    if (found) {
      console.log(`    Found in ${found.replace(homedir(), '~')}.`);
      return true;
    }

    console.log('    No Figma token found. Design extraction cannot read Figma without one.');
    console.log('    Create one at https://www.figma.com/developers/api#access-tokens, then:');
    console.log('      printf \'FIGMA_API_KEY=%s\\n\' "$KEY" > ~/.config/beer-kit/figma.env');
    console.log('    Skip this if the project has no Figma designs.');
    return 'warn';
  });

  return { passed, warnings, errors };
}

/**
 * Register the doctor command with commander.
 * @param {import('commander').Command} program
 * @param {string} platform
 */
export function registerDoctor(program, platform) {
  program
    .command('doctor')
    .description('Validate .claude/ kit installation')
    .option('--target <dir>', 'Target project directory', '.')
    .action((opts) => {
      const targetDir = resolve(opts.target);
      console.log(`Checking ${platform} kit in ${targetDir}...\n`);

      const result = runDoctor(targetDir, platform);

      console.log(`\n${result.passed} passed, ${result.warnings} warnings, ${result.errors} errors`);
      if (result.errors > 0) process.exit(1);
    });
}
