/**
 * scout-checker.cjs - Reusable scout-block logic for heavyweight directories
 *
 * Extracted from scout-block.cjs for reuse in other hooks.
 */

'use strict';

/** Build commands that are always allowed regardless of path */
const BUILD_COMMANDS = [
  'xcodebuild', 'gradle', 'gradlew', 'flutter build', 'flutter run',
  'pod install', 'pod update', 'npm run', 'yarn build', 'swift build',
  'fastlane', 'make', 'cmake', 'bazel'
];

/** Heavyweight directories that should not be searched directly */
const BLOCKED_PATTERNS = [
  { pattern: /\bPods\b\//, label: 'Pods/' },
  { pattern: /\.gradle\//, label: '.gradle/' },
  { pattern: /(?:^|\/)build\/(?:outputs|intermediates|generated|app\/outputs)\//, label: 'build/outputs/' },
  { pattern: /DerivedData\//, label: 'DerivedData/' },
  { pattern: /node_modules\//, label: 'node_modules/' },
  { pattern: /\.dart_tool\//, label: '.dart_tool/' },
  { pattern: /\.pub-cache\//, label: '.pub-cache/' },
  { pattern: /\bxcuserdata\//, label: 'xcuserdata/' }
];

/**
 * Check if a command string is a build command (always allowed).
 * @param {string} subject - Command or path string
 * @returns {boolean}
 */
function isBuildCommand(subject) {
  const lower = subject.toLowerCase();
  return BUILD_COMMANDS.some(cmd =>
    lower.startsWith(cmd) || lower.includes(` ${cmd}`)
  );
}

/**
 * Check if a path/command targets a blocked heavyweight directory.
 *
 * @param {string} subject - Command, path, or glob pattern
 * @returns {{ blocked: boolean, label: string }|null}
 *   Returns object if blocked, null if allowed.
 */
function checkScout(subject) {
  if (!subject) return null;
  if (isBuildCommand(subject)) return null;

  for (const { pattern, label } of BLOCKED_PATTERNS) {
    if (pattern.test(subject)) {
      return { blocked: true, label };
    }
  }

  return null;
}

module.exports = {
  BUILD_COMMANDS,
  BLOCKED_PATTERNS,
  isBuildCommand,
  checkScout
};
