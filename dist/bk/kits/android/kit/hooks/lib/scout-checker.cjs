/**
 * scout-checker.cjs - Reusable scout-block logic for heavyweight directories
 *
 * Extracted from scout-block.cjs for reuse in other hooks.
 *
 * Matching is done on the subject with EXCLUSIONS removed first. Field data showed every
 * recorded SCOUT BLOCK was a command that mentioned node_modules only to skip it
 * (`find . -not -path "*\/node_modules/*"`, `grep -v node_modules`) — the raw regex
 * punished exactly the careful searches the block is meant to encourage.
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

/** Shell control operators: they end one simple command and start the next. */
const SEGMENT_BREAKS = new Set(['|', '||', '&', '&&', ';', '\n']);

/** find primaries whose argument is a path/name test (the thing -not / -prune apply to). */
const FIND_TESTS = new Set([
  '-path', '-ipath', '-wholename', '-iwholename', '-name', '-iname', '-regex', '-iregex'
]);

/** Options (any tool) whose argument is always an exclusion. */
const EXCLUDE_OPTS = new Set(['--exclude', '--exclude-dir', '--exclude-from']);

/** grep/rg options that consume the next token, so it is not the positional pattern. */
const GREP_ARG_OPTS = new Set([
  '-e', '-f', '-m', '-A', '-B', '-C', '-g', '-t', '-T',
  '--regexp', '--file', '--max-count', '--after-context', '--before-context', '--context',
  '--include', '--glob', '--iglob', '--type', '--type-not'
]);

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
 * Split a shell command into words, honouring quotes and backslash escapes, and emit
 * control operators as their own tokens. Not a shell parser: no expansion, no heredocs.
 * Quoting only matters so `-not -path "*\/node_modules/*"` stays one argument.
 * @param {string} command
 * @returns {string[]}
 */
function tokenizeCommand(command) {
  const tokens = [];
  let cur = '';
  let inWord = false;
  const flush = () => { if (inWord) tokens.push(cur); cur = ''; inWord = false; };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" || ch === '"') {
      const end = command.indexOf(ch, i + 1);
      const stop = end === -1 ? command.length : end;
      cur += command.slice(i + 1, stop);
      inWord = true;
      i = stop;
    } else if (ch === '\\' && i + 1 < command.length) {
      cur += command[++i];
      inWord = true;
    } else if (ch === '&' && (command[i - 1] === '>' || command[i + 1] === '>')) {
      // `2>&1` / `&>file` are redirections, not the `&` operator — keep them in the word
      cur += ch;
      inWord = true;
    } else if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') {
      flush();
      const two = command.slice(i, i + 2);
      if (two === '||' || two === '&&') { tokens.push(two); i++; } else tokens.push(ch);
    } else if (/\s/.test(ch)) {
      flush();
    } else {
      cur += ch;
      inWord = true;
    }
  }
  flush();
  return tokens;
}

/**
 * Remove, from one simple command's words, every argument that names something to SKIP.
 * Positive references (search roots, paths to read) are kept, so they still get matched.
 * @param {string[]} words - Tokens of one simple command (no control operators)
 * @returns {string[]}
 */
function stripSegmentExclusions(words) {
  const cmd = (words[0] || '').split('/').pop();
  const isGrep = /^(?:[ef]?grep|rg|ag|ack)$/.test(cmd);
  const isFd = cmd === 'fd' || cmd === 'fdfind';
  // grep -v / --invert-match: the PATTERN is what gets excluded; path operands are not.
  const inverted = isGrep && words.slice(1).some(w =>
    w === '--invert-match' || /^-[a-zA-Z]*v[a-zA-Z]*$/.test(w));

  const out = [];
  let patternSeen = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];

    // find: `-not -path X`, `! -name X`
    if ((w === '-not' || w === '!') && FIND_TESTS.has(next)) { i += 2; continue; }
    // find: `-path X -prune` and `\( -path X -o -path Y \) -prune`
    if (w === '-prune') {
      if (out[out.length - 1] === ')') {
        const open = out.lastIndexOf('(');
        out.length = open === -1 ? out.length - 1 : open;
      } else if (FIND_TESTS.has(out[out.length - 2])) {
        out.length -= 2;
      }
      continue;
    }
    // --exclude / --exclude-dir / --exclude-from (grep, rsync, tar, fd, ...)
    const eq = w.indexOf('=');
    if (EXCLUDE_OPTS.has(eq === -1 ? w : w.slice(0, eq))) { if (eq === -1) i++; continue; }
    if (isFd && w === '-E') { i++; continue; }
    // rg --glob '!X' / -g '!X' / --iglob=!X: a leading `!` negates the glob
    if (/^--i?glob=!/.test(w)) continue;
    if ((w === '-g' || w === '--glob' || w === '--iglob') && next && next.startsWith('!')) {
      i++; continue;
    }

    if (inverted && i > 0) {
      if (w === '-e' || w === '--regexp') { i++; patternSeen = true; continue; }
      if (w.startsWith('--regexp=')) { patternSeen = true; continue; }
      if (GREP_ARG_OPTS.has(w)) { out.push(w, next); i++; continue; }
      if (!w.startsWith('-') && !patternSeen) { patternSeen = true; continue; }
    }
    out.push(w);
  }
  return out;
}

/**
 * Strip exclusion constructs from a Bash command so only positive references remain.
 * @param {string} command
 * @returns {string} Remaining words joined by spaces
 */
function stripExclusions(command) {
  const kept = [];
  let segment = [];
  const flushSegment = () => { kept.push(...stripSegmentExclusions(segment)); segment = []; };
  for (const tok of tokenizeCommand(command)) {
    if (SEGMENT_BREAKS.has(tok)) { flushSegment(); kept.push(tok); } else segment.push(tok);
  }
  flushSegment();
  return kept.join(' ');
}

/**
 * Check if a path/command targets a blocked heavyweight directory.
 *
 * @param {string} subject - Command, path, or glob pattern
 * @param {{ toolName?: string }} [opts] - toolName 'Bash' strips shell exclusions
 *   (-not -path, -prune, grep -v, --exclude*, rg -g '!…'); any other tool treats a
 *   subject starting with `!` as a negated glob. Omitted → raw match (legacy behaviour).
 * @returns {{ blocked: boolean, label: string }|null}
 *   Returns object if blocked, null if allowed.
 */
function checkScout(subject, opts = {}) {
  if (!subject) return null;
  if (isBuildCommand(subject)) return null;

  let target = subject;
  if (opts.toolName === 'Bash') target = stripExclusions(subject);
  else if (opts.toolName && subject.trim().startsWith('!')) return null;

  for (const { pattern, label } of BLOCKED_PATTERNS) {
    if (pattern.test(target)) {
      return { blocked: true, label };
    }
  }

  return null;
}

module.exports = {
  BUILD_COMMANDS,
  BLOCKED_PATTERNS,
  isBuildCommand,
  tokenizeCommand,
  stripExclusions,
  checkScout
};
