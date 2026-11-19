/**
 * privacy-checker.cjs - Reusable privacy check logic for mobile-sensitive files
 *
 * Extracted from privacy-block.cjs so other hooks (security-check) can reuse.
 */

'use strict';

const path = require('path');

/** Exact filenames that are always blocked */
const BLOCKED_NAMES = new Set([
  'google-services.json',
  'GoogleService-Info.plist',
  'Podfile.lock',
  'gradle.lockfile'
]);

/** File extensions that indicate sensitive content */
const BLOCKED_EXTENSIONS = [
  '.keychain', '.keychain-db',
  '.jks', '.keystore',
  '.mobileprovision',
  '.p12', '.p8',
  '.cer', '.der',
  '.pem', '.key',
  '.pfx'
];

/** Directory paths that contain sensitive files */
const BLOCKED_DIRS = [
  '/certificates/',
  '/provisioning_profiles/',
  '/privatekeys/',
  '/fastlane/certs/',
  '/fastlane/profiles/',
  '/.ssh/'
];

/**
 * Check if a filename matches .env pattern (.env, .env.local, .env.production)
 * @param {string} basename
 * @returns {boolean}
 */
function isEnvFile(basename) {
  return /^\.env(\.|$)/.test(basename);
}

/**
 * Check if a file path is privacy-sensitive and should be blocked.
 *
 * @param {string} filePath - Absolute or relative file path
 * @returns {{ blocked: boolean, reason: string, promptData: object }|null}
 *   Returns object if blocked, null if allowed.
 */
function checkPrivacy(filePath) {
  if (!filePath) return null;

  const basename = path.basename(filePath);
  const lower = filePath.toLowerCase();

  const isBlockedName = BLOCKED_NAMES.has(basename);
  const isBlockedExt = BLOCKED_EXTENSIONS.some(ext => basename.toLowerCase().endsWith(ext));
  const isBlockedDir = BLOCKED_DIRS.some(dir => lower.includes(dir));
  const isEnv = isEnvFile(basename);

  if (!isBlockedName && !isBlockedExt && !isEnv && !isBlockedDir) {
    return null;
  }

  const reason = isBlockedDir
    ? `Protected directory: ${filePath}`
    : `Sensitive mobile file: ${basename}`;

  const promptData = {
    type: 'PRIVACY_PROMPT',
    file: filePath,
    basename,
    question: {
      header: 'File Access',
      text: `I need to access "${basename}" which may contain sensitive data (keys, certs, secrets). Do you approve?`,
      options: [
        { label: 'Yes, approve access', description: `Allow accessing ${basename} this time` },
        { label: 'No, skip this file', description: 'Continue without accessing this file' }
      ]
    }
  };

  return { blocked: true, reason, promptData };
}

module.exports = {
  BLOCKED_NAMES,
  BLOCKED_EXTENSIONS,
  BLOCKED_DIRS,
  isEnvFile,
  checkPrivacy
};
