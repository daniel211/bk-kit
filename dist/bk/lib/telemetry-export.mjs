/**
 * telemetry-export.mjs — Build the bundle behind `bk telemetry`.
 *
 * Reads the project's telemetry, writes only into a temp directory, and copies a finished
 * archive to `out` once the gate has passed, so a failed export leaves nothing behind. Sends
 * nothing: moving the file to the maintainer is the user's decision.
 */

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { TELEMETRY_FILES } from './telemetry-schema.mjs';
import { createSanitizer } from './telemetry-sanitizer.mjs';
import { scanStagedBundle } from './telemetry-gate.mjs';

const BUNDLE_DIR = 'bk-telemetry';

/** An expected refusal; the command prints the message rather than a stack trace. */
export class TelemetryError extends Error {}

/** `bk-telemetry-YYYYMMDD-HHMMSS.tgz` in local time. */
export function defaultBundleName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  return `bk-telemetry-${day}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.tgz`;
}

/** The three facts wanted from .bk-version.json, and the hook scripts it says the kit shipped. */
function readKitInfo(root) {
  try {
    const v = JSON.parse(readFileSync(join(root, '.bk-version.json'), 'utf8'));
    const scripts = Object.keys(v.files || {})
      .filter((f) => f.startsWith('hooks/') && f.endsWith('.cjs'))
      .map((f) => basename(f));
    return {
      kit: { version: v.version ?? null, platform: v.platform ?? null, installedAt: v.installedAt ?? null },
      kitScripts: new Set(scripts),
    };
  } catch {
    return { kit: { version: null, platform: null, installedAt: null }, kitScripts: new Set() };
  }
}

/** Sanitize one log into the stage. Returns its manifest entry. */
function stageFile(sourcePath, targetPath, fields, sanitizer) {
  const before = { ...sanitizer.stats };
  const out = [];
  let malformed = 0;
  for (const line of readFileSync(sourcePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { malformed += 1; continue; }
    if (typeof row !== 'object' || row === null || Array.isArray(row)) { malformed += 1; continue; }
    out.push(JSON.stringify(sanitizer.sanitizeRow(row, fields)));
  }
  writeFileSync(targetPath, out.length ? `${out.join('\n')}\n` : '');
  return {
    rows: out.length,
    malformed,
    droppedFields: sanitizer.stats.dropped - before.dropped,
    redactedValues: sanitizer.stats.redacted - before.redacted,
  };
}

/** Archive the stage. --numeric-owner keeps the login name out of the tar headers. */
function packBundle(stage, archive) {
  const r = spawnSync('tar', ['--numeric-owner', '-czf', archive, '-C', stage, BUNDLE_DIR], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (r.error || r.status !== 0) {
    throw new TelemetryError(`tar failed: ${r.error?.message || r.stderr.trim()}`);
  }
}

/**
 * Export a sanitized telemetry bundle.
 *
 * @param {object} args
 * @param {string} args.root — project root
 * @param {string} args.out — absolute path of the archive to write
 * @param {Buffer} [args.salt] — tests only; a real export always draws a fresh one
 * @param {Date} [args.now]
 * @returns {{out:string, manifest:object}}
 * @throws {TelemetryError} no telemetry to export, or the gate found a leak
 */
export function exportTelemetry({ root, out, salt = randomBytes(32), now = new Date() }) {
  if (!existsSync(join(root, '.bk-metrics'))) {
    throw new TelemetryError(`No telemetry found: ${join(root, '.bk-metrics')} does not exist. Run a workflow first.`);
  }

  const { kit, kitScripts } = readKitInfo(root);
  const sanitizer = createSanitizer({ salt, kitScripts });
  const temp = mkdtempSync(join(tmpdir(), 'bk-telemetry-'));
  try {
    const stage = join(temp, BUNDLE_DIR);
    mkdirSync(stage);

    const files = {};
    for (const [name, { source, fields }] of Object.entries(TELEMETRY_FILES)) {
      const sourcePath = join(root, source);
      if (existsSync(sourcePath)) files[name] = stageFile(sourcePath, join(stage, name), fields, sanitizer);
    }
    if (Object.keys(files).length === 0) {
      throw new TelemetryError('No telemetry found: .bk-metrics/ has none of the logs this command exports.');
    }

    const manifest = {
      kit,
      generatedAt: now.toISOString(),
      files,
      hashing: 'Feature, custom agent and MCP tool names are HMAC-SHA256 hashed with a random salt used for this bundle only and never stored.',
    };
    writeFileSync(join(stage, 'MANIFEST.json'), `${JSON.stringify(manifest)}\n`);

    const findings = scanStagedBundle(stage, sanitizer.hashedOriginals);
    if (findings.length > 0) {
      const list = findings.map((f) => `  ${f.file}: ${f.field} (${f.kind})`).join('\n');
      throw new TelemetryError(`Export stopped, no bundle written. Unsafe values found in:\n${list}`);
    }

    const archive = join(temp, 'bundle.tgz');
    packBundle(temp, archive);
    copyFileSync(archive, out);
    return { out, manifest };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
