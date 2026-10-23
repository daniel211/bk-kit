'use strict';
/**
 * subagent-user-context.cjs — The user's own instructions and auto memory, for kit subagents
 * that no longer load them.
 *
 * Kit agents set `omitClaudeMd: true` (see subagent-rule-digest.cjs). On Claude Code 2.1.283
 * that drops more than the kit's conductor content: the subagent also loses the user's
 * `~/.claude/CLAUDE.md`, the project-root `CLAUDE.md`, `CLAUDE.local.md` and the auto-memory
 * index `MEMORY.md` — which is where a team keeps the conventions an implementer must follow and
 * where the user's saved preferences live. Before the change every subagent received all of
 * them. subagent-init now hands them back here, bounded:
 *
 *  - each CLAUDE.md is inlined verbatim when it is small (<= CAPS.fileBytes) and still fits the
 *    shared total (CAPS.totalBytes); otherwise a pointer tells the agent to Read it. `@imports`
 *    are never expanded — they are listed, so the agent can Read them.
 *  - the MEMORY.md index is inlined with Claude Code's own 200-line cap plus a byte cap, and a
 *    "truncated, see <path>" note when either bites. The linked memory files are not inlined
 *    (Claude Code does not load them either); the header says they can be Read.
 *
 * NOT included, deliberately:
 *  - `.claude/CLAUDE.md`: in a kit project that file IS the kit (installed from
 *    templates/CLAUDE.md.tmpl) — conductor procedure the digest already replaces.
 *  - agent memory (`memory: project` → `.claude/agent-memory/<agent>/MEMORY.md`): Claude Code
 *    still loads it into the subagent with omitClaudeMd (sandbox probe, 2.1.283).
 *  - CLAUDE.md files in parent directories or subdirectories, and managed-policy CLAUDE.md.
 *
 * Everything here is runtime-variable, so the static token budget (scripts/build/token-budget*)
 * does not count it; CAPS is the bound instead. Fail-soft: any unreadable file is skipped.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Size bounds for everything this module injects (UTF-8 bytes). */
const CAPS = {
  fileBytes: 4096, // one CLAUDE.md inlined verbatim only up to this size
  totalBytes: 8192, // all inlined user/project content together (CLAUDE.md files + MEMORY.md)
  memoryLines: 200, // Claude Code's own MEMORY.md index cap
  memoryBytes: 4096 // our byte cap on the index (Claude Code allows 25,000)
};

/** Claude Code's slug length limit; longer slugs get a hash suffix we cannot reproduce. */
const SLUG_MAX = 200;

const bytes = (s) => Buffer.byteLength(s || '', 'utf8');

function readText(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const raw = readText(file);
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function envOn(v) {
  return !!v && !['0', 'false', 'no', 'off'].includes(String(v).trim().toLowerCase());
}

/** Claude Code's config home: CLAUDE_CONFIG_DIR, else ~/.claude. */
function claudeConfigHome(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/**
 * Claude Code's project slug: every non-alphanumeric character becomes `-`
 * (`/Users/me/My_App.v2` → `-Users-me-My-App-v2`; an existing `-` stays, so `/-` gives `--`).
 * Read from the Claude Code 2.1.283 bundle; slugs over 200 chars also get a hash suffix,
 * which resolveMemoryDir handles by prefix lookup.
 */
function projectSlug(absPath) {
  return String(absPath).replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * The directory Claude Code keys auto memory on: the repository's main working tree, so every
 * git worktree of one repo shares one memory. A worktree's `.git` is a file
 * (`gitdir: <main>/.git/worktrees/<name>`); anything else is the root itself.
 */
function canonicalProjectRoot(projectRoot) {
  const gitFile = readText(path.join(projectRoot, '.git'));
  if (gitFile) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(gitFile);
    const wt = m && /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/.exec(m[1]);
    if (wt) return path.resolve(projectRoot, wt[1]);
  }
  return projectRoot;
}

/** `~/x` or an absolute path, as Claude Code accepts for autoMemoryDirectory; else null. */
function expandMemoryDir(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let p = value.trim();
  if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(2));
  return path.isAbsolute(p) ? path.normalize(p) : null;
}

/** First defined value of `key` in local → project → user settings (Claude Code precedence). */
function settingsValue(projectRoot, env, key, { skipProject = false } = {}) {
  const sources = [
    path.join(projectRoot, '.claude', 'settings.local.json'),
    ...(skipProject ? [] : [path.join(projectRoot, '.claude', 'settings.json')]),
    path.join(claudeConfigHome(env), 'settings.json')
  ];
  for (const file of sources) {
    const v = readJson(file)?.[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * Where Claude Code keeps this project's auto memory, or null when it is off.
 *
 * Mirrors Claude Code 2.1.283: CLAUDE_CODE_DISABLE_AUTO_MEMORY / `autoMemoryEnabled: false`
 * turn it off; CLAUDE_COWORK_MEMORY_PATH_OVERRIDE, then `autoMemoryDirectory` (local or user
 * settings — Claude Code ignores it in the checked-in .claude/settings.json) replace the
 * directory; CLAUDE_CODE_REMOTE_MEMORY_DIR replaces the base of the default
 * `<config home>/projects/<slug>/memory`. Managed-policy settings are not read.
 */
function resolveMemoryDir(projectRoot, env = process.env) {
  if (envOn(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY)) return null;
  if (settingsValue(projectRoot, env, 'autoMemoryEnabled') === false) return null;

  const override = expandMemoryDir(env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE);
  if (override) return override;
  const configured = expandMemoryDir(settingsValue(projectRoot, env, 'autoMemoryDirectory', { skipProject: true }));
  if (configured) return configured;

  const projectsDir = path.join(env.CLAUDE_CODE_REMOTE_MEMORY_DIR || claudeConfigHome(env), 'projects');
  let slug = projectSlug(canonicalProjectRoot(projectRoot));
  if (slug.length > SLUG_MAX) {
    const prefix = `${slug.slice(0, SLUG_MAX)}-`;
    try {
      const hits = fs.readdirSync(projectsDir).filter((d) => d.startsWith(prefix));
      if (hits.length !== 1) return null;
      slug = hits[0];
    } catch {
      return null;
    }
  }
  return path.join(projectsDir, slug, 'memory');
}

/** `@path` imports in a CLAUDE.md, outside code fences (Claude Code does not expand those). */
function listImports(text) {
  const found = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[\w.\-/]+)/g)) {
      if (/[/.]/.test(m[1]) && !found.includes(m[1])) found.push(m[1]);
    }
  }
  return found;
}

/**
 * Longest prefix of `text` within `maxLines` lines and `maxBytes` bytes, cut at a line end
 * where possible.
 * @returns {{ text: string, truncated: boolean, lines: number }}
 */
function capText(text, maxLines, maxBytes) {
  const all = text.replace(/\s+$/, '').split('\n');
  const kept = [];
  let size = 0;
  let cutLine = false;
  for (const line of all) {
    if (kept.length >= maxLines) break;
    const add = bytes(line) + (kept.length ? 1 : 0);
    if (size + add > maxBytes) {
      if (!kept.length) {
        // A single over-long first line: cut by characters rather than return nothing.
        let cut = line;
        while (cut && bytes(cut) > maxBytes) cut = cut.slice(0, -Math.max(1, Math.ceil((bytes(cut) - maxBytes) / 4)));
        if (cut) { kept.push(cut); cutLine = true; }
      }
      break;
    }
    kept.push(line);
    size += add;
  }
  return { text: kept.join('\n'), truncated: cutLine || kept.length < all.length, lines: all.length };
}

/**
 * The user's and project's CLAUDE.md files plus the auto-memory index, as additionalContext
 * lines for a subagent that runs with omitClaudeMd. Empty when there is nothing to add.
 *
 * @param {{ projectRoot: string, env?: object, caps?: Partial<typeof CAPS> }} opts
 * @returns {string[]}
 */
function buildSubagentUserContext({ projectRoot, env = process.env, caps = {} }) {
  const cap = { ...CAPS, ...caps };
  let budget = cap.totalBytes;
  const lines = [];

  // CLAUDE_CODE_DISABLE_CLAUDE_MDS keeps them out of the main session too — nothing to restore.
  const claudeMds = envOn(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS) ? [] : [
    { file: path.join(projectRoot, 'CLAUDE.md'), what: 'project instructions, checked into the codebase', holds: 'project conventions' },
    { file: path.join(projectRoot, 'CLAUDE.local.md'), what: "user's private project instructions, not checked in", holds: 'project conventions' },
    { file: path.join(claudeConfigHome(env), 'CLAUDE.md'), what: "user's private global instructions for all projects", holds: "the user's own conventions" }
  ];

  const inlined = [];
  const pointers = [];
  for (const { file, what, holds } of claudeMds) {
    const raw = readText(file);
    if (raw === null || !raw.trim()) continue;
    const text = raw.replace(/\s+$/, '');
    const size = bytes(text);
    const imports = listImports(text);
    const shown = file; // absolute: the agent's Read tool needs one
    const importNote = imports.length
      ? `  It imports ${imports.slice(0, 5).map((i) => '`@' + i + '`').join(', ')}${imports.length > 5 ? ` and ${imports.length - 5} more` : ''} (not expanded — Read those too, paths relative to ${path.dirname(file)}).`
      : '';
    if (size <= cap.fileBytes && size <= budget) {
      budget -= size;
      inlined.push(`Contents of ${shown} (${what}):`, '', text, '');
      if (importNote) inlined.push(importNote.trim(), '');
    } else {
      pointers.push(`- Read ${shown} before writing code; it holds ${holds} (${(size / 1024).toFixed(1)} KB, not inlined).${importNote}`);
    }
  }

  if (inlined.length || pointers.length) {
    lines.push('', '## User & Project Instructions (CLAUDE.md — not auto-loaded for kit agents; these win over the kit digest)');
    lines.push(...pointers);
    if (pointers.length && inlined.length) lines.push('');
    lines.push(...inlined);
    while (lines[lines.length - 1] === '') lines.pop();
  }

  const memDir = resolveMemoryDir(projectRoot, env);
  const memFile = memDir && path.join(memDir, 'MEMORY.md');
  const memRaw = memFile ? readText(memFile) : null;
  if (memRaw && memRaw.trim()) {
    const shown = memFile;
    const room = Math.min(cap.memoryBytes, budget);
    lines.push('', "## Auto Memory (the user's saved preferences for this project)");
    lines.push(`Index of ${shown}; each line links a file in that directory — Read it when the line is relevant to your task.`);
    if (room < 256) {
      lines.push(`- Not inlined (context cap reached): Read ${shown}.`);
    } else {
      const capped = capText(memRaw, cap.memoryLines, room);
      lines.push('', capped.text);
      if (capped.truncated) lines.push(`… truncated (index has ${capped.lines} lines), see ${shown}`);
    }
  }

  return lines;
}

module.exports = {
  CAPS,
  projectSlug,
  canonicalProjectRoot,
  resolveMemoryDir,
  listImports,
  capText,
  buildSubagentUserContext
};
