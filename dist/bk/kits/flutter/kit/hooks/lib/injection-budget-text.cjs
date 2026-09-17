/**
 * injection-budget-text.cjs — turning a block of hook text into bytes and a fingerprint.
 *
 * Split out of injection-budget.cjs (CLAUDE.md §Modularization). Pure functions only: no fs,
 * no state, nothing that can fail in a way the caller has to think about.
 */

'use strict';

const { DEFAULT_POINTER, num } = require('./injection-budget-config.cjs');

/**
 * Stable short hash of the exact text that would be injected.
 *
 * Falls back to a cheap rolling checksum when `crypto` is unavailable: a weaker hash still
 * dedupes, while a thrown require would take the warning down with it.
 *
 * @param {string} text
 * @returns {string}
 */
function hashContent(text) {
  const str = String(text == null ? '' : text);
  try {
    return require('crypto').createHash('sha1').update(str).digest('hex').slice(0, 16);
  } catch {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return `f${(h >>> 0).toString(16)}${str.length.toString(16)}`;
  }
}

/**
 * Cut a UTF-8 string to at most `bytes` bytes without splitting a character.
 * A split multi-byte sequence decodes to U+FFFD, which is what the trailing strip removes.
 * @param {string} str
 * @param {number} bytes
 * @returns {string}
 */
function sliceBytes(str, bytes) {
  return Buffer.from(str, 'utf8').subarray(0, bytes).toString('utf8').replace(/�+$/, '');
}

/**
 * Trim `text` to `maxBytes`, cutting at the last line boundary that fits and appending a
 * pointer — so the model reads whole directives plus "there was more", never half a sentence.
 *
 * Single-line blocks have no line boundary to cut at, so they fall back to a word boundary.
 *
 * @param {string} text
 * @param {number} maxBytes
 * @param {{pointer?: string}} [opts]
 * @returns {string} never longer than maxBytes bytes (when maxBytes is a usable number)
 */
function truncateToBudget(text, maxBytes, opts) {
  try {
    const str = String(text == null ? '' : text);
    const limit = num(maxBytes);
    if (limit === undefined || limit <= 0) return str;
    if (Buffer.byteLength(str, 'utf8') <= limit) return str;

    const pointer = (opts && typeof opts.pointer === 'string') ? opts.pointer : DEFAULT_POINTER;
    const suffix = `\n${pointer}`;
    const room = limit - Buffer.byteLength(suffix, 'utf8');
    // Pointer alone does not fit — return what does.
    if (room <= 0) return sliceBytes(str, limit);

    let slice = sliceBytes(str, room);
    const nl = slice.lastIndexOf('\n');
    if (nl > 0) {
      slice = slice.slice(0, nl);
    } else {
      const trimmed = slice.replace(/\s+\S*$/, '');
      if (trimmed) slice = trimmed;
    }
    return `${slice.replace(/\s+$/, '')}${suffix}`;
  } catch {
    return String(text == null ? '' : text);
  }
}

module.exports = {
  hashContent,
  truncateToBudget
};
