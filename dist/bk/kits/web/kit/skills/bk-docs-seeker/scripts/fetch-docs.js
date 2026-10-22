#!/usr/bin/env node

/**
 * Documentation Fetcher Script (Mobile-adapted)
 * Fetches documentation from context7.com with mobile SDK URL overrides.
 * Extended from CK docs-seeker with mobile-specific knownRepos mappings.
 */

const https = require('https');
const { loadEnv } = require('./utils/env-loader');
const { detectTopic, resolveMobileAlias } = require('./detect-topic');

const env = loadEnv();
const DEBUG = env.DEBUG === 'true';
const API_KEY = env.CONTEXT7_API_KEY;

/**
 * Make HTTPS GET request
 * @param {string} url - URL to fetch
 * @returns {Promise<string|null>} Response body or null on 404
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {},
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else if (res.statusCode === 404) {
          resolve(null);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Construct context7.com llms.txt URL
 * @param {string} library - Library path (e.g., "apple/swiftui", "flutter/flutter")
 * @param {string|null} topic - Optional topic keyword
 * @returns {string} context7.com URL
 */
function buildContext7Url(library, topic = null) {
  let basePath;

  if (library.includes('/')) {
    const [org, repo] = library.split('/');
    basePath = `${org}/${repo}`;
  } else {
    const normalized = library.toLowerCase().replace(/[^a-z0-9-]/g, '');
    basePath = `websites/${normalized}`;
  }

  const baseUrl = `https://context7.com/${basePath}/llms.txt`;
  return topic ? `${baseUrl}?topic=${encodeURIComponent(topic)}` : baseUrl;
}

/**
 * Build URL variations to try for a given library + topic.
 * Merges CK web repos with mobile SDK repos.
 * @param {string} library - Library name or alias
 * @param {string|null} topic - Optional topic keyword
 * @returns {Promise<string[]>} Ordered list of URLs to try
 */
async function getUrlVariations(library, topic = null) {
  // Web framework repos (from CK)
  const webRepos = {
    'next.js': 'vercel/next.js',
    'nextjs': 'vercel/next.js',
    'remix': 'remix-run/remix',
    'astro': 'withastro/astro',
    'shadcn': 'shadcn-ui/ui',
    'shadcn/ui': 'shadcn-ui/ui',
    'better-auth': 'better-auth/better-auth',
  };

  // Mobile SDK repos — mirrors MOBILE_ALIASES in detect-topic.js
  const mobileRepos = {
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
  };

  const allRepos = { ...webRepos, ...mobileRepos };
  const normalized = library.toLowerCase();
  const repo = allRepos[normalized] || resolveMobileAlias(library) || library;

  const urls = [];

  if (topic) {
    urls.push(buildContext7Url(repo, topic));
  }
  urls.push(buildContext7Url(repo));

  return urls;
}

/**
 * Fetch documentation from context7.com
 * @param {string} query - User query
 * @returns {Promise<Object>} Documentation result
 */
async function fetchDocs(query) {
  const topicInfo = detectTopic(query);

  if (DEBUG) {
    console.error('[DEBUG] Topic detection result:', topicInfo);
  }

  let urls = [];

  if (topicInfo && topicInfo.isTopicSpecific) {
    urls = await getUrlVariations(topicInfo.library, topicInfo.topic);
    if (DEBUG) console.error('[DEBUG] Topic-specific URLs:', urls);
  } else {
    const libraryMatch = query.match(/(?:documentation|docs|guide) (?:for )?(.+)/i);
    if (libraryMatch) {
      const library = libraryMatch[1].trim();
      urls = await getUrlVariations(library);
      if (DEBUG) console.error('[DEBUG] General library URLs:', urls);
    } else {
      // Treat entire query as library name (e.g., "swiftui" or "flutter")
      urls = await getUrlVariations(query.trim());
    }
  }

  for (const url of urls) {
    if (DEBUG) console.error(`[DEBUG] Trying URL: ${url}`);

    try {
      const content = await httpsGet(url);
      if (content) {
        return {
          success: true,
          source: 'context7.com',
          url,
          content,
          topicSpecific: url.includes('?topic='),
        };
      }
    } catch (error) {
      if (DEBUG) console.error(`[DEBUG] Failed to fetch ${url}:`, error.message);
    }
  }

  return {
    success: false,
    source: 'context7.com',
    error: 'Documentation not found on context7.com',
    urls,
    suggestion: 'Try web search or check references/context7-mobile-patterns.md for direct doc URLs',
  };
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node fetch-docs.js "<user query>"');
    process.exit(1);
  }

  const query = args.join(' ');

  try {
    const result = await fetchDocs(query);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  fetchDocs,
  buildContext7Url,
  getUrlVariations,
  httpsGet,
};
