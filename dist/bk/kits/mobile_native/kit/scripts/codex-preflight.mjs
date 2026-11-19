/**
 * codex-preflight.mjs — Can this machine run the OpenAI Codex CLI review harness?
 *
 * Two questions, answered before a review is attempted so the failure is a clear remediation
 * rather than a stack trace from a spawned process:
 *
 *   1. Is `codex` on PATH?  (`command -v codex`, `where codex` on Windows; `CODEX_CLI_PATH`
 *      overrides the probe.)
 *   2. Is it authenticated? `codex login status` exits 0 when a login is stored; an
 *      `OPENAI_API_KEY` in the environment also counts.
 *
 * Codex is an optional engine: `/bk-review` defaults to Gemini, and a failed preflight means
 * "use another engine", never "the code is bad".
 */

import { spawnSync } from 'node:child_process';

export const INSTALL_HINT = 'npm i -g @openai/codex';
export const LOGIN_HINT = 'codex login';

/**
 * The command that asks the host OS where `codex` lives.
 *
 * @param {string} platform — a `process.platform` value
 * @returns {string[]} argv
 */
export function codexProbeCommand(platform) {
  return platform === 'win32' ? ['where', 'codex'] : ['/bin/sh', '-c', 'command -v codex'];
}

/**
 * Locate the codex binary.
 *
 * @param {object} [env]
 * @param {object} [opts]
 * @param {string} [opts.platform]
 * @param {(argv: string[]) => {status: number|null, stdout: string}} [opts.run] — test seam
 * @returns {string|null}
 */
export function findCodexBinary(env = process.env, { platform = process.platform, run = runArgv } = {}) {
  if (env.CODEX_CLI_PATH) return env.CODEX_CLI_PATH;
  const r = run(codexProbeCommand(platform), env);
  if (!r || r.status !== 0) return null;
  // `where` lists every match with CRLF endings — take the first, trimmed.
  return String(r.stdout || '').split('\n')[0].trim() || null;
}

/**
 * How codex is authenticated, if at all.
 *
 * @param {string} bin
 * @param {object} [env]
 * @param {object} [opts]
 * @returns {'login'|'api-key'|null}
 */
export function codexAuth(bin, env = process.env, { run = runArgv } = {}) {
  const r = run([bin, 'login', 'status'], env);
  if (r && r.status === 0) return 'login';
  if (env.OPENAI_API_KEY) return 'api-key';
  return null;
}

/**
 * Structured readiness report.
 *
 * @returns {{ok: boolean, binary: string|null, auth: string|null, problem: string|null, remediation: string|null}}
 */
export function preflightCodex(env = process.env, opts = {}) {
  const binary = findCodexBinary(env, opts);
  if (!binary) {
    return {
      ok: false, binary: null, auth: null,
      problem: 'OpenAI Codex CLI ("codex") not found in PATH.',
      remediation: `Install it with "${INSTALL_HINT}", then run "${LOGIN_HINT}". `
        + 'Or use the default engine: /bk-review (Gemini) or /bk-review --engine claude.'
    };
  }
  const auth = codexAuth(binary, env, opts);
  if (!auth) {
    return {
      ok: false, binary, auth: null,
      problem: 'Codex CLI is installed but not authenticated.',
      remediation: `Run "${LOGIN_HINT}" (ChatGPT sign-in or API key), or export OPENAI_API_KEY, then re-run.`
    };
  }
  return { ok: true, binary, auth, problem: null, remediation: null };
}

function runArgv(argv, env) {
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000
    });
    return { status: r.error ? null : r.status, stdout: r.stdout || '' };
  } catch (_) {
    return { status: null, stdout: '' };
  }
}
