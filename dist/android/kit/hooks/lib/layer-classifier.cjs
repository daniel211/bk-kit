/**
 * layer-classifier.cjs — Classify a file path into an architecture layer.
 *
 * Used by arch-fitness-* hooks to determine whether a file belongs to
 * presentation, domain, data, or other (unknown) layer, based on
 * path segment matching against policy configuration.
 *
 * @example
 *   const { classifyLayer } = require('./layer-classifier.cjs');
 *   const info = classifyLayer('src/Presentation/Login/LoginViewModel.swift', policy.arch_fitness.ios);
 *   // => { layer: 'presentation', matchedPaths: ['Presentation'] }
 */

'use strict';

const path = require('path');

/**
 * Normalize a path segment for comparison (lowercase, trim slashes).
 * @param {string} seg
 * @returns {string}
 */
function normSeg(seg) {
  return seg.toLowerCase().replace(/^\/+|\/+$/g, '');
}

/**
 * Check whether a file path contains any of the given path segments.
 * Matching is case-insensitive and matches full path segments (not substrings).
 *
 * @param {string} filePath
 * @param {string[]} segments
 * @returns {string[]} matched segments
 */
function matchPathSegments(filePath, segments) {
  if (!filePath || !segments || !segments.length) return [];
  // Normalise to forward-slash parts
  const parts = filePath.split(/[/\\]/).map(p => p.toLowerCase());
  const matched = [];
  for (const seg of segments) {
    const norm = normSeg(seg);
    if (!norm) continue;
    // Match if any path part equals the segment OR starts with it (e.g. "domain" matches "domain" or "domain-core")
    // Prefer exact part match for precision
    if (parts.some(p => p === norm || p.startsWith(norm + '-') || p.startsWith(norm + '_'))) {
      matched.push(seg);
    }
  }
  return matched;
}

/**
 * Classify a file path into a layer based on policy config for a platform.
 *
 * platformConfig structure (any platform):
 *   {
 *     presentation_paths?: string[],
 *     domain_paths?: string[],
 *     data_paths?: string[],
 *     infra_paths?: string[],
 *     exclude_paths?: string[]
 *   }
 *
 * @param {string} filePath  — absolute or relative path to the file
 * @param {object} platformConfig  — policy.arch_fitness[platform]
 * @returns {{ layer: 'presentation'|'domain'|'data'|'other', matchedPaths: string[], excluded: boolean }}
 */
function classifyLayer(filePath, platformConfig) {
  if (!filePath || !platformConfig) {
    return { layer: 'other', matchedPaths: [], excluded: false };
  }

  const cfg = platformConfig;

  // Check excluded first — early return
  const excludePaths = cfg.exclude_paths || [];
  const excludeMatched = matchPathSegments(filePath, excludePaths);
  // Also check exact filename suffix matches (e.g. ".g.dart")
  const fileName = path.basename(filePath);
  const excludedByFilename = excludePaths.some(ep => {
    if (ep.startsWith('.') && fileName.endsWith(ep)) return true;
    return false;
  });
  if (excludeMatched.length > 0 || excludedByFilename) {
    return { layer: 'other', matchedPaths: excludeMatched, excluded: true };
  }

  // Presentation layer
  const presentationPaths = cfg.presentation_paths || [];
  const presMatched = matchPathSegments(filePath, presentationPaths);
  if (presMatched.length > 0) {
    return { layer: 'presentation', matchedPaths: presMatched, excluded: false };
  }

  // Domain layer
  const domainPaths = cfg.domain_paths || [];
  const domMatched = matchPathSegments(filePath, domainPaths);
  if (domMatched.length > 0) {
    return { layer: 'domain', matchedPaths: domMatched, excluded: false };
  }

  // Data / infrastructure layer
  const dataPaths = [...(cfg.data_paths || []), ...(cfg.infra_paths || [])];
  const dataMatched = matchPathSegments(filePath, dataPaths);
  if (dataMatched.length > 0) {
    return { layer: 'data', matchedPaths: dataMatched, excluded: false };
  }

  return { layer: 'other', matchedPaths: [], excluded: false };
}

module.exports = { classifyLayer, matchPathSegments, normSeg };
