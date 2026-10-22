/**
 * docs-scanner.mjs — Scan beer-kit src/ markdown files and extract metadata.
 *
 * Scans agents, skills, and rules directories to build a structured catalog
 * of available components with names, descriptions, types, and platform tags.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

/**
 * Strip YAML frontmatter from markdown content.
 * Returns content after the closing '---' line, or original if no frontmatter.
 * @param {string} content
 * @returns {{ frontmatter: Record<string,string>, body: string }}
 */
function parseFrontmatter(content) {
  const frontmatter = {};
  if (!content.startsWith('---')) {
    return { frontmatter, body: content };
  }
  const end = content.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter, body: content };
  }
  const fmLines = content.slice(3, end).trim().split('\n');
  for (const line of fmLines) {
    const sep = line.indexOf(':');
    if (sep !== -1) {
      const key = line.slice(0, sep).trim();
      // Strip surrounding quotes from value
      const val = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
      frontmatter[key] = val;
    }
  }
  const body = content.slice(end + 4).trim();
  return { frontmatter, body };
}

/**
 * Extract the first non-empty paragraph from markdown body text.
 * Skips heading lines starting with '#'.
 * @param {string} body
 * @returns {string}
 */
function firstParagraph(body) {
  const lines = body.split('\n');
  const paras = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue;
    paras.push(trimmed);
    // Stop at first blank line after collecting text
    if (paras.length > 0 && trimmed === '') break;
  }
  return paras.slice(0, 3).join(' ').slice(0, 200);
}

/**
 * Safely read a markdown file, returning empty string on error.
 * @param {string} filePath
 * @returns {string}
 */
function safeRead(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Safely list directory entries, returning empty array on error.
 * @param {string} dirPath
 * @returns {string[]}
 */
function safeReaddir(dirPath) {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

/** Every kit the CLI ships (kit-resolver.mjs KIT_NAMES). */
const PLATFORMS = 'ios|android|flutter|python|web';
/** `bk-code-reviewer.python.md` → python */
const PLATFORM_SECTION_RE = new RegExp(`\\.(${PLATFORMS})$`);
/** `bk-web-developer.md` → web */
const PLATFORM_AGENT_RE = new RegExp(`bk-(${PLATFORMS})-`);
/** `bk-python/`, `bk-flutter-sdk/` → python, flutter; the boundary keeps a future `bk-webhooks` base */
const PLATFORM_SKILL_RE = new RegExp(`^bk-(${PLATFORMS})(?=-|$)`);

/**
 * Scan agents from either dev structure (src/agents/_base/, _platforms/, _platform-sections/)
 * or flat user structure (kit/agents/*.md, .claude/agents/*.md).
 * @param {string} agentsDir
 * @returns {Array<Object>}
 */
function scanAgents(agentsDir) {
  const results = [];
  const hasBaseDir = existsSync(join(agentsDir, '_base'));

  if (hasBaseDir) {
    // Dev mode: src/agents/_base/*.md
    for (const file of safeReaddir(join(agentsDir, '_base'))) {
      if (!file.endsWith('.md')) continue;
      results.push(parseAgentFile(join(agentsDir, '_base', file), 'base'));
    }
    // Dev mode: src/agents/_platforms/{platform}/*.md
    for (const plat of safeReaddir(join(agentsDir, '_platforms'))) {
      for (const file of safeReaddir(join(agentsDir, '_platforms', plat))) {
        if (!file.endsWith('.md')) continue;
        results.push(parseAgentFile(join(agentsDir, '_platforms', plat, file), 'platform', plat));
      }
    }
    // Dev mode: src/agents/_platform-sections/*.md
    for (const file of safeReaddir(join(agentsDir, '_platform-sections'))) {
      if (!file.endsWith('.md')) continue;
      const name = basename(file, '.md');
      const platformMatch = name.match(PLATFORM_SECTION_RE);
      results.push(parseAgentFile(join(agentsDir, '_platform-sections', file), 'platform', platformMatch?.[1]));
    }
  } else {
    // User mode: flat directory (kit/agents/*.md or .claude/agents/*.md)
    for (const file of safeReaddir(agentsDir)) {
      if (!file.endsWith('.md') || file.startsWith('_')) continue;
      const name = basename(file, '.md');
      const platformMatch = name.match(PLATFORM_AGENT_RE);
      const type = platformMatch ? 'platform' : 'base';
      results.push(parseAgentFile(join(agentsDir, file), type, platformMatch?.[1]));
    }
  }

  return results;
}

/** Parse a single agent markdown file into metadata. */
function parseAgentFile(filePath, type, platform) {
  const content = safeRead(filePath);
  const { frontmatter, body } = parseFrontmatter(content);
  const name = frontmatter.name || basename(filePath, '.md');
  const description = frontmatter.description || firstParagraph(body) || '';
  return { name, description, type, ...(platform && { platform }), path: filePath };
}

/**
 * Scan base and platform skills from src/skills/.
 * Each skill lives in its own subdirectory with a SKILL.md file.
 * @param {string} skillsDir
 * @returns {Array<Object>}
 */
function scanSkills(skillsDir) {
  const results = [];
  const hasBaseDir = existsSync(join(skillsDir, '_base'));

  if (hasBaseDir) {
    // Dev mode: src/skills/_base/{skill-name}/SKILL.md
    for (const skillDir of safeReaddir(join(skillsDir, '_base'))) {
      const skillMdPath = join(skillsDir, '_base', skillDir, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;
      results.push(parseSkillFile(skillMdPath, skillDir, 'base'));
    }
    // Dev mode: src/skills/_platforms/{platform}/{skill-name}/SKILL.md
    for (const plat of safeReaddir(join(skillsDir, '_platforms'))) {
      for (const skillDir of safeReaddir(join(skillsDir, '_platforms', plat))) {
        const skillMdPath = join(skillsDir, '_platforms', plat, skillDir, 'SKILL.md');
        if (!existsSync(skillMdPath)) continue;
        results.push(parseSkillFile(skillMdPath, skillDir, 'platform', plat));
      }
    }
  } else {
    // User mode: flat (kit/skills/{skill-name}/SKILL.md)
    for (const skillDir of safeReaddir(skillsDir)) {
      const skillMdPath = join(skillsDir, skillDir, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;
      const platformMatch = skillDir.match(PLATFORM_SKILL_RE);
      const type = platformMatch ? 'platform' : 'base';
      results.push(parseSkillFile(skillMdPath, skillDir, type, platformMatch?.[1]));
    }
  }

  return results;
}

/** Parse a single skill SKILL.md file into metadata. */
function parseSkillFile(filePath, dirName, type, platform) {
  const content = safeRead(filePath);
  const { frontmatter, body } = parseFrontmatter(content);
  const name = frontmatter.name || dirName;
  const description = frontmatter.description || firstParagraph(body) || '';
  return { name, description, type, ...(platform && { platform }), path: filePath };
}

/**
 * Scan rules from src/rules/.
 * Supports flat *.md files and _base/ subdirectory.
 * @param {string} rulesDir
 * @returns {Array<Object>}
 */
function scanRules(rulesDir) {
  const results = [];

  // Support both flat rules/ and rules/_base/ layouts
  const scanFlat = (dir, type = 'base') => {
    for (const file of safeReaddir(dir)) {
      if (!file.endsWith('.md')) continue;
      const filePath = join(dir, file);
      const content = safeRead(filePath);
      const { frontmatter, body } = parseFrontmatter(content);
      const name = frontmatter.name || basename(file, '.md');
      const description = frontmatter.description || firstParagraph(body) || '';
      results.push({ name, description, type, path: filePath });
    }
  };

  scanFlat(rulesDir);

  // Also scan _base/ subdirectory if present
  const baseDir = join(rulesDir, '_base');
  if (existsSync(baseDir)) {
    scanFlat(baseDir);
  }

  return results;
}

/**
 * Scan all beer-kit documentation from the src directory.
 *
 * @param {string} srcDir - Absolute path to src/ directory
 * @returns {{ agents: Array<Object>, skills: Array<Object>, rules: Array<Object> }}
 *   Each item shape: { name, description, type: 'base'|'platform', platform?: string, path }
 */
export function scanDocs(srcDir) {
  const agentsDir = join(srcDir, 'agents');
  const skillsDir = join(srcDir, 'skills');
  const rulesDir = join(srcDir, 'rules');

  const agents = scanAgents(agentsDir);
  const skills = scanSkills(skillsDir);
  const rules = scanRules(rulesDir);

  return { agents, skills, rules };
}
