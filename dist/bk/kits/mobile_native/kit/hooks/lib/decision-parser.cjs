'use strict';

/**
 * decision-parser.cjs — Parse <!-- bk-decision --> blocks from agent output text.
 *
 * Block format:
 *   <!-- bk-decision -->
 *   Decision: Use Swinject over Resolver for DI
 *   Reason: Existing codebase uses Swinject; migration cost too high
 *   Alternatives considered: Resolver, Factory pattern
 *   Scope: UserAuth module
 *   <!-- /bk-decision -->
 *
 * Returns array of parsed decision objects.
 */

const BLOCK_REGEX = /<!--\s*bk-decision\s*-->([\s\S]*?)<!--\s*\/bk-decision\s*-->/gi;

/**
 * Parse a single decision block body text into structured fields.
 * @param {string} body - text content between bk-decision tags
 * @returns {{ decision, reason, alternatives, scope } | null}
 */
function parseDecisionBlock(body) {
  if (!body || typeof body !== 'string') return null;

  const fields = {};
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match "Key: value" pattern
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, '_');
    const value = trimmed.slice(colonIdx + 1).trim();

    if (key === 'decision') fields.decision = value;
    else if (key === 'reason') fields.reason = value;
    else if (key === 'alternatives_considered' || key === 'alternatives') {
      // Split by comma, trim each
      fields.alternatives = value.split(',').map(a => a.trim()).filter(Boolean);
    } else if (key === 'scope') fields.scope = value;
  }

  // Must have at least a decision field to be valid
  if (!fields.decision) return null;

  return {
    decision: fields.decision,
    reason: fields.reason || '',
    alternatives: fields.alternatives || [],
    scope: fields.scope || ''
  };
}

/**
 * Extract all bk-decision blocks from agent output text.
 * @param {string} text - full agent output text
 * @returns {Array<{ decision, reason, alternatives, scope }>}
 */
function extractDecisionBlocks(text) {
  if (!text || typeof text !== 'string') return [];

  const results = [];
  let match;
  const regex = new RegExp(BLOCK_REGEX.source, 'gi');

  while ((match = regex.exec(text)) !== null) {
    const body = match[1];
    const parsed = parseDecisionBlock(body);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

module.exports = { parseDecisionBlock, extractDecisionBlocks };
