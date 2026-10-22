#!/usr/bin/env node

/**
 * Environment variable loader for bk-docs-seeker skill.
 * Load order (lowest → highest priority):
 *   src/skills/.env → src/skills/_base/.env → skill/.env → process.env
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse .env file content into key-value pairs
 * @param {string} content - .env file content
 * @returns {Object} Parsed environment variables
 */
function parseEnvFile(content) {
  const env = {};
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;

    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();

      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      env[key] = value;
    }
  }

  return env;
}

/**
 * Load environment variables from .env files in priority order
 * @returns {Object} Merged environment variables
 */
function loadEnv() {
  // __dirname = scripts/utils → skill root is two levels up
  const skillDir = path.resolve(__dirname, '../..');
  const baseDir = path.resolve(skillDir, '..');
  const skillsDir = path.resolve(baseDir, '..');

  const envPaths = [
    path.join(skillsDir, '.env'),   // Lowest priority
    path.join(baseDir, '.env'),
    path.join(skillDir, '.env'),    // Highest file priority
  ];

  let mergedEnv = {};

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const parsed = parseEnvFile(content);
        mergedEnv = { ...mergedEnv, ...parsed };
      } catch (_) {
        // Silently skip unreadable files
      }
    }
  }

  // process.env has highest priority
  mergedEnv = { ...mergedEnv, ...process.env };

  return mergedEnv;
}

/**
 * Get environment variable with fallback
 * @param {string} key - Environment variable key
 * @param {string} defaultValue - Default value if not found
 * @returns {string} Environment variable value
 */
function getEnv(key, defaultValue = '') {
  return loadEnv()[key] || defaultValue;
}

module.exports = { loadEnv, getEnv, parseEnvFile };
