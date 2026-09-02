#!/usr/bin/env node

/**
 * Topic Detection Script (Mobile-adapted)
 * Analyzes user queries to extract library name and topic keywords.
 * Extends CK docs-seeker with MOBILE_ALIASES for common mobile SDKs.
 */

const { loadEnv } = require('./utils/env-loader');

const env = loadEnv();
const DEBUG = env.DEBUG === 'true';

/**
 * Mobile SDK alias map: short name → context7 org/repo path
 * Used to resolve common mobile framework names before context7 lookup.
 */
const MOBILE_ALIASES = {
  'swiftui': 'apple/swiftui',
  'uikit': 'apple/uikit',
  'swift': 'apple/swift',
  'compose': 'jetbrains/compose-multiplatform',
  'jetpack-compose': 'jetbrains/compose-multiplatform',
  'material3': 'material-components/material-components-android',
  'flutter': 'flutter/flutter',
  'dart': 'dart-lang/dart',
  'alamofire': 'Alamofire/Alamofire',
  'retrofit': 'square/retrofit',
  'moya': 'Moya/Moya',
  'kingfisher': 'onevcat/Kingfisher',
  'coil': 'coil-kt/coil',
  'hilt': 'google/dagger',
  'riverpod': 'rrousselGit/riverpod',
  'provider': 'rrousselGit/provider',
  'realm': 'realm/realm-swift',
  'firebase': 'firebase/firebase-ios-sdk',
  'rxswift': 'ReactiveX/RxSwift',
  'combine': 'apple/swift-combine',
  'swiftdata': 'apple/swiftdata',
  'navigation-stack': 'apple/swiftui',
  'lazy-column': 'jetbrains/compose-multiplatform',
};

/**
 * Topic-specific query patterns
 */
const TOPIC_PATTERNS = [
  // "How do I use X in Y?"
  /how (?:do i|to|can i) (?:use|implement|add|setup|configure) (?:the )?(.+?) (?:in|with|for) (.+)/i,

  // "Y X strategies/patterns" - e.g., "SwiftUI navigation strategies"
  /(.+?) (.+?) (?:strategies|patterns|techniques|methods|approaches)/i,

  // "X Y documentation" or "Y X docs"
  /(.+?) (.+?) (?:documentation|docs|guide|tutorial)/i,

  // "Using X with Y"
  /using (.+?) (?:with|in|for) (.+)/i,

  // "Y X guide/implementation/setup"
  /(.+?) (.+?) (?:guide|implementation|setup|configuration)/i,

  // "Implement X in Y"
  /implement(?:ing)? (.+?) (?:in|with|for|using) (.+)/i,
];

/**
 * General library query patterns (non-topic specific)
 */
const GENERAL_PATTERNS = [
  /(?:documentation|docs) for (.+)/i,
  /(.+?) (?:getting started|quick ?start|introduction)/i,
  /(?:how to use|learn) (.+)/i,
  /(.+?) (?:api reference|overview|basics)/i,
];

/**
 * Resolve mobile alias to context7 org/repo path
 * @param {string} library - Raw library name
 * @returns {string} Resolved library path (alias or original)
 */
function resolveMobileAlias(library) {
  const key = library.toLowerCase().trim();
  return MOBILE_ALIASES[key] || library;
}

/**
 * Normalize topic keyword
 * @param {string} topic - Raw topic string
 * @returns {string} Normalized topic keyword
 */
function normalizeTopic(topic) {
  return topic
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .split('-')[0]
    .slice(0, 20);
}

/**
 * Normalize library name
 * @param {string} library - Raw library string
 * @returns {string} Normalized library name
 */
function normalizeLibrary(library) {
  return library
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s\-\/\.]/g, '')
    .replace(/\s+/g, '-');
}

/**
 * Detect if query is topic-specific or general.
 * Resolves mobile aliases before returning.
 * @param {string} query - User query
 * @returns {Object|null} Topic info or null for general query
 */
function detectTopic(query) {
  if (!query || typeof query !== 'string') {
    return null;
  }

  const trimmedQuery = query.trim();

  // Check general patterns first
  for (const pattern of GENERAL_PATTERNS) {
    const match = trimmedQuery.match(pattern);
    if (match) {
      if (DEBUG) console.error('[DEBUG] Matched general pattern, no topic');
      return null;
    }
  }

  // Check topic-specific patterns
  for (let i = 0; i < TOPIC_PATTERNS.length; i++) {
    const pattern = TOPIC_PATTERNS[i];
    const match = trimmedQuery.match(pattern);
    if (match) {
      const [, term1, term2] = match;

      let topic, library;

      // Pattern 1 (strategies/patterns): term1 is library, term2 is topic
      if (i === 1) {
        topic = normalizeTopic(term2);
        library = normalizeLibrary(term1);
      } else {
        topic = normalizeTopic(term1);
        library = normalizeLibrary(term2);
      }

      // Resolve mobile alias
      library = resolveMobileAlias(library);

      if (DEBUG) {
        console.error('[DEBUG] Matched topic pattern');
        console.error('[DEBUG] Topic:', topic);
        console.error('[DEBUG] Library:', library);
      }

      return {
        query: trimmedQuery,
        topic,
        library,
        isTopicSpecific: true,
      };
    }
  }

  if (DEBUG) console.error('[DEBUG] No pattern matched, treating as general');
  return null;
}

/**
 * CLI entry point
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node detect-topic.js "<user query>"');
    process.exit(1);
  }

  const query = args.join(' ');
  const result = detectTopic(query);

  if (result) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(JSON.stringify({ isTopicSpecific: false }, null, 2));
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  detectTopic,
  normalizeTopic,
  normalizeLibrary,
  resolveMobileAlias,
  MOBILE_ALIASES,
};
