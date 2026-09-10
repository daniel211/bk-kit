/**
 * figma-rest.mjs — Read a Figma file through Figma's own REST API.
 *
 * Why this exists: the design agents were written against a `figma-mcp-go` MCP server that
 * is not installed anywhere and has no recorded install path. Comparing what the agents call
 * with what that server returned (see bk-design/references/figma-data-guide.md) shows the
 * fields are Figma REST API fields verbatim — layoutMode, itemSpacing, fills, strokes,
 * effects, boundVariables, characters. That server was a thin wrapper over this API, so this
 * is not a substitute for the missing tool surface; it is the source it was wrapping.
 *
 * Fetching and exporting are deterministic work. Doing them here rather than in a model's
 * tool call removes the whole class of "the model reported an export it never made", and
 * makes both engines read identical bytes.
 *
 * The token is read from the environment and never logged, printed, or written to a file.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const FIGMA_BASE_URL = 'https://api.figma.com/v1';

/** Formats Figma can render a node into. `scale` applies to raster formats only. */
export const IMAGE_FORMATS = ['png', 'jpg', 'svg', 'pdf'];

/**
 * Figma caps how many ids one request may name. Batching keeps a 40-icon screen from
 * failing as one oversized call.
 */
export const MAX_IDS_PER_REQUEST = 50;

/**
 * How deep a serialised node tree goes when the caller does not say.
 *
 * Six levels keeps a real screen around 60–100 KB; unlimited depth produced 3.1 MB for one
 * OmniWork screen — accurate, and unusable. It lives here rather than in either extractor
 * because both of them write `node.json`, and the two defaults had already drifted apart.
 */
export const DEFAULT_NODE_DEPTH = 6;

/**
 * Statuses worth trying again. 429 is Figma's rate limit — nineteen screens at six requests
 * each reaches it — and the 5xx family is the gateway having a bad second, not the request
 * being wrong. Everything else (401, 403, 404) will fail identically however many times it
 * is sent, so retrying one only delays the error.
 */
export const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Attempts after the first, and the base of the exponential backoff between them. */
export const DEFAULT_MAX_RETRIES = 3;
export const RETRY_BASE_MS = 500;

/** However long a Retry-After asks for, never sleep longer than this in one wait. */
export const MAX_RETRY_WAIT_MS = 30_000;

/**
 * Read a Retry-After header. Figma sends seconds; the HTTP spec also allows a date, and a
 * client that understands only one of the two waits zero when it is handed the other.
 *
 * @param {string|null|undefined} value
 * @param {number} [now] epoch ms, injectable so the date branch is testable
 * @returns {number|null} milliseconds to wait, or null when there is nothing to read
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const seconds = Number(String(value).trim());
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const at = Date.parse(String(value));
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * How long to wait before attempt `attempt` (0-based), honouring the server when it says.
 *
 * @param {object|null} response
 * @param {number} attempt
 * @param {number} [baseMs]
 * @returns {number}
 */
export function retryDelayMs(response, attempt, baseMs = RETRY_BASE_MS) {
  const header = response?.headers?.get?.('retry-after');
  const asked = parseRetryAfter(header);
  const backoff = baseMs * (2 ** attempt);
  return Math.min(MAX_RETRY_WAIT_MS, asked ?? backoff);
}

/** Token names this codebase has used, newest first. */
const TOKEN_NAMES = ['FIGMA_API_KEY', 'FIGMA_ACCESS_TOKEN', 'FIGMA_TOKEN'];

/**
 * Files a token may be kept in, checked in order.
 *
 * `~/.config/beer-kit/figma.env` comes first deliberately: a token outside the repository
 * cannot be committed by accident, whatever a future .gitignore says. The repo-local `.env`
 * follows, matching what visual-compare.py already does for its own key, and the walk up the
 * tree lets a script inside `.claude/` find the project's `.env`.
 *
 * @param {string} [from] directory to start walking up from
 * @returns {string[]}
 */
export function tokenFilePaths(from = dirname(fileURLToPath(import.meta.url))) {
  const paths = [join(homedir(), '.config', 'beer-kit', 'figma.env')];
  let cur = from;
  for (let i = 0; i < 5; i++) {
    paths.push(join(cur, '.env'));
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return paths;
}

/**
 * Pull a KEY=value out of a dotenv-style file body.
 *
 * @param {string} body
 * @param {string[]} names
 * @returns {string|null}
 */
export function parseEnvFile(body, names = TOKEN_NAMES) {
  for (const rawLine of String(body).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!names.includes(key)) continue;
    return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/**
 * Read the Figma token from the environment, then from a token file.
 *
 * Three env names are accepted because three already exist in this codebase's history:
 * FIGMA_API_KEY (platform-context), FIGMA_ACCESS_TOKEN (the old REST client), and
 * FIGMA_TOKEN (the deprecated bk-plan CLI path). Failing over a name mismatch would be a
 * pointless way to lose.
 *
 * @param {object} [env]
 * @param {string[]} [files]
 * @returns {string|null}
 */
export function readToken(env = process.env, files = tokenFilePaths()) {
  for (const name of TOKEN_NAMES) {
    if (env[name]) return env[name];
  }
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const found = parseEnvFile(readFileSync(file, 'utf8'));
      if (found) return found;
    } catch (_) { /* unreadable file — try the next */ }
  }
  return null;
}

/**
 * Pull the file key and node id out of a Figma URL.
 *
 * Figma writes node ids two ways: `node-id=368-16694` in URLs and `368:16694` everywhere
 * else. They are the same id, and code that does not normalise them fails on whichever form
 * it did not expect.
 *
 * @param {string} url
 * @returns {{fileKey: string|null, nodeId: string|null}}
 */
export function parseFigmaUrl(url) {
  const text = String(url || '');
  // /design/:key/... and the older /file/:key/...
  const keyMatch = text.match(/\/(?:design|file|board|slides)\/([A-Za-z0-9]+)/);
  // A branch key, when present, addresses the branch rather than the parent file.
  const branchMatch = text.match(/\/branch\/([A-Za-z0-9]+)/);
  const nodeMatch = text.match(/[?&]node-id=([0-9]+[-:][0-9]+)/);
  return {
    fileKey: branchMatch ? branchMatch[1] : (keyMatch ? keyMatch[1] : null),
    nodeId: nodeMatch ? nodeMatch[1].replace('-', ':') : null
  };
}

/**
 * Split a list into chunks of at most `size`.
 *
 * @param {any[]} items
 * @param {number} size
 * @returns {any[][]}
 */
export function chunk(items, size = MAX_IDS_PER_REQUEST) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A thin Figma REST client, with retries and an optional version-scoped response cache.
 *
 * `fetchImpl` and `sleepImpl` are injectable so the tests never touch the network and never
 * actually wait; `cache` is injectable so the client itself holds no opinion about where a
 * cache lives or when it is valid.
 */
export class FigmaRest {
  /**
   * @param {object} [opts]
   * @param {string} [opts.token]
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {number} [opts.timeoutMs]
   * @param {object} [opts.env]        injectable, so a test does not read the real machine
   * @param {string[]} [opts.tokenFiles] injectable for the same reason
   * @param {number} [opts.maxRetries] attempts after the first
   * @param {(ms: number) => Promise<void>} [opts.sleepImpl] injectable, so tests do not wait
   * @param {{get: Function, set: Function}} [opts.cache] a FigmaCache, or nothing
   */
  constructor({
    token, fetchImpl = fetch, timeoutMs = 30_000, env, tokenFiles,
    maxRetries = DEFAULT_MAX_RETRIES,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    cache = null
  } = {}) {
    const resolved = token
      || readToken(env ?? process.env, tokenFiles ?? tokenFilePaths());
    if (!resolved) {
      throw new Error(
        'No Figma token. Set FIGMA_API_KEY, or put it in ~/.config/beer-kit/figma.env '
        + 'or a project .env file. Create one at '
        + 'https://www.figma.com/developers/api#access-tokens'
      );
    }
    this.token = resolved;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.sleepImpl = sleepImpl;
    this.cache = cache;
  }

  /**
   * Perform one GET, retrying the statuses that are worth retrying.
   *
   * A cached response short-circuits the whole thing. Only successes are ever cached — an
   * error is a fact about this moment, not about the file.
   *
   * @param {string} url
   * @param {{cache?: boolean}} [opts] pass cache:false for a response that must be fresh
   * @returns {Promise<any>}
   */
  async request(url, { cache = true } = {}) {
    if (cache && this.cache) {
      const hit = this.cache.get(url);
      if (hit !== null && hit !== undefined) return hit;
    }

    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response = null;
      try {
        response = await this.fetchImpl(url, {
          headers: { 'X-Figma-Token': this.token },
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (err) {
        // A timeout or a dropped socket. Retryable for the same reason a 503 is: nothing
        // about the request was wrong.
        lastError = err;
      }

      if (response?.ok) {
        const data = await response.json();
        if (cache && this.cache) this.cache.set(url, data);
        return data;
      }

      if (response) {
        const body = await response.text().catch(() => '');
        // The URL is safe to echo; the token lives in a header and stays out of the message.
        lastError = new Error(
          `Figma API ${response.status} ${response.statusText} for ${url}. ${body.slice(0, 300)}`
        );
        lastError.status = response.status;
        // A 403 or a 404 answers the same way however often it is asked — fail now, so the
        // caller sees a missing scope in a second rather than after four rounds of backoff.
        if (!RETRY_STATUSES.has(response.status)) throw lastError;
      }

      if (attempt === this.maxRetries) break;
      await this.sleepImpl(retryDelayMs(response, attempt));
    }
    throw lastError;
  }

  /**
   * File metadata, fetched as shallowly as the API allows.
   *
   * `version` is what makes the response cache safe: it changes on every edit, so an entry
   * written under one version can never be served for another. depth=1 keeps this probe
   * small — the whole point is that it costs less than what it saves.
   *
   * @param {string} fileKey
   * @returns {Promise<{version: string|null, lastModified: string|null, name: string|null}>}
   */
  async getFileMeta(fileKey) {
    const data = await this.request(
      `${FIGMA_BASE_URL}/files/${encodeURIComponent(fileKey)}?depth=1`,
      { cache: false }
    );
    return {
      version: data.version ?? null,
      lastModified: data.lastModified ?? null,
      name: data.name ?? null
    };
  }

  /**
   * Fetch nodes with their subtrees.
   *
   * @param {string} fileKey
   * @param {string[]} nodeIds
   * @param {number} [depth] omit for the full subtree
   * @returns {Promise<object>} merged { nodeId: {document} } across batches
   */
  async getNodes(fileKey, nodeIds, depth) {
    const merged = {};
    for (const batch of chunk(nodeIds)) {
      const ids = batch.map(encodeURIComponent).join(',');
      const url = `${FIGMA_BASE_URL}/files/${encodeURIComponent(fileKey)}/nodes?ids=${ids}`
        + (depth ? `&depth=${depth}` : '');
      const data = await this.request(url);
      Object.assign(merged, data.nodes || {});
    }
    return merged;
  }

  /**
   * Ask Figma to render nodes, and return the URLs it renders them to.
   *
   * @param {string} fileKey
   * @param {string[]} nodeIds
   * @param {{format?: string, scale?: number}} [opts]
   * @returns {Promise<Record<string, string>>} nodeId → rendered image URL
   */
  async getImageUrls(fileKey, nodeIds, { format = 'png', scale } = {}) {
    if (!IMAGE_FORMATS.includes(format)) {
      throw new Error(`Unsupported format "${format}". Expected one of: ${IMAGE_FORMATS.join(', ')}`);
    }
    const images = {};
    for (const batch of chunk(nodeIds)) {
      const ids = batch.map(encodeURIComponent).join(',');
      // scale is meaningful for raster output only; sending it with svg/pdf is rejected.
      const scaleParam = scale && (format === 'png' || format === 'jpg') ? `&scale=${scale}` : '';
      const url = `${FIGMA_BASE_URL}/images/${encodeURIComponent(fileKey)}`
        + `?ids=${ids}&format=${format}${scaleParam}`;
      // Never cached: Figma's rendered-image URLs are short-lived, so a cache hit would
      // hand the downloader a link that has already expired.
      const data = await this.request(url, { cache: false });
      if (data.err) throw new Error(`Figma render failed: ${data.err}`);
      Object.assign(images, data.images || {});
    }
    return images;
  }

  /**
   * Local variable collections — the design tokens, with their modes.
   *
   * @param {string} fileKey
   * @returns {Promise<object>}
   */
  async getLocalVariables(fileKey) {
    return this.request(`${FIGMA_BASE_URL}/files/${encodeURIComponent(fileKey)}/variables/local`);
  }

  /**
   * Published styles for the file.
   *
   * @param {string} fileKey
   * @returns {Promise<object>}
   */
  async getStyles(fileKey) {
    return this.request(`${FIGMA_BASE_URL}/files/${encodeURIComponent(fileKey)}/styles`);
  }
}

/**
 * Download a rendered image to disk.
 *
 * Written from the response bytes rather than re-encoded, so a PDF or SVG lands byte-exact
 * — the failure mode of letting a model "save" a binary it only saw.
 *
 * @param {string} url
 * @param {string} outPath
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<number>} bytes written
 */
export async function downloadImage(url, outPath, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} for ${outPath}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    // An empty file passes an existsSync check and fails at build time instead — catch it here.
    throw new Error(`Rendered image was empty: ${outPath}`);
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, bytes);
  return bytes.length;
}

/**
 * The filename `figma-cli export` writes for one rendered node.
 *
 * The rule is: **an explicit `--name` is the filename**. It is passed by a caller that has
 * already decided what the file must be called, and appending anything to it breaks that
 * caller's contract. The design-spec-writer asks for `--scale 2 --name screenshot` and every
 * downstream check — the bk-design Output Contract, its Self-Check Glob, the filesystem
 * post-verify in design-workflow.md — looks for `screenshot.png`. This function used to
 * append the scale, so those runs wrote `screenshot@2x.png` and then failed the post-verify
 * for a screenshot that had rendered perfectly. Every screen on the claude engine failed
 * that way; the agy runner downloads straight to `screenshot.png` and never saw it.
 *
 * The `@Nx` suffix survives only for the node-id fallback, where there is no caller-chosen
 * name and the scale is the only thing separating three renders of one node. A caller that
 * wants both a name and a scale suffix spells the suffix into the name — which is what the
 * three-scale loop in design-asset-exporter.md now does.
 *
 * @param {object} opts
 * @param {string} opts.nodeId    the Figma node id, used when no name is given
 * @param {string} [opts.name]    the caller's explicit `--name`, honoured verbatim
 * @param {number} [opts.scale]   render scale; only ever reaches the filename via fallback
 * @param {string} opts.format    png | jpg | svg | pdf
 * @returns {string} the basename to write, extension included
 */
export function exportFileName({ nodeId, name, scale, format }) {
  if (name) return `${name}.${format}`;
  const suffix = scale && scale !== 1 ? `@${scale}x` : '';
  return `${String(nodeId).replace(/[:;]/g, '-')}${suffix}.${format}`;
}

// ---------------------------------------------------------------------------------------
// Derivations — what the missing MCP server computed, done here from the same node tree
// ---------------------------------------------------------------------------------------

/**
 * Walk a node tree, yielding every node.
 *
 * @param {object} node
 * @yields {object}
 */
export function* walk(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const child of node.children || []) yield* walk(child);
}

/**
 * Direct FRAME children of a node — the screens of a page or section.
 *
 * Mirrors the filter design-validator applies: CONNECTOR arrows, INSTANCE annotations,
 * GROUP, VECTOR and stray TEXT are not screens.
 *
 * @param {object} node
 * @returns {object[]}
 */
export function frameChildren(node) {
  return (node?.children || []).filter((child) => child.type === 'FRAME');
}

/**
 * Every TEXT node under a subtree, with its content.
 *
 * Replaces scan_text_nodes. Text comes from the `characters` field — never transcribed,
 * which is what keeps Vietnamese diacritics intact.
 *
 * @param {object} node
 * @returns {{id: string, name: string, characters: string}[]}
 */
export function textNodes(node) {
  const out = [];
  for (const n of walk(node)) {
    if (n.type === 'TEXT' && typeof n.characters === 'string') {
      out.push({ id: n.id, name: n.name, characters: n.characters });
    }
  }
  return out;
}

/**
 * Nodes on a screen that are candidates for export as an icon or image.
 *
 * Needed because the serialised node tree is depth-limited, and assets live at the bottom of
 * it — a spec written from a six-level tree lists no assets at all, which is what the first
 * real run produced. This walks the FULL tree instead, and carries only the few fields the
 * export pipeline needs, so it stays small.
 *
 * Candidates are proposed, not decided: naming and the ic-/img-/bg- prefix are the spec
 * author's call, and a vector that is part of an illustration is not an icon just because it
 * is a vector.
 *
 * @param {object} node
 * @returns {{id: string, name: string, type: string, size: {w: number, h: number}|null,
 *            square: boolean, hasImageFill: boolean}[]}
 */
export function assetCandidates(node) {
  const out = [];
  for (const n of walk(node)) {
    const isVector = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'ELLIPSE', 'POLYGON'].includes(n.type);
    const hasImageFill = Array.isArray(n.fills)
      && n.fills.some((fill) => fill && fill.type === 'IMAGE' && fill.visible !== false);
    const isInstance = n.type === 'INSTANCE';
    if (!isVector && !hasImageFill && !isInstance) continue;

    const box = n.absoluteBoundingBox;
    const size = box ? { w: Math.round(box.width), h: Math.round(box.height) } : null;
    // An icon is square by construction; the ratio is what tells an icon frame from a card.
    const square = !!size && size.w > 0 && Math.abs(size.w - size.h) <= 1;

    // An instance that is neither square nor image-backed is a component (a button, a row),
    // not an asset. Including those would bury the real icons.
    if (isInstance && !square && !hasImageFill) continue;

    out.push({ id: n.id, name: n.name, type: n.type, size, square, hasImageFill });
  }
  return out;
}

/**
 * Find nodes by name substring and/or type. Replaces search_nodes.
 *
 * @param {object} node
 * @param {{query?: string, types?: string[]}} [criteria]
 * @returns {{id: string, name: string, type: string}[]}
 */
export function searchNodes(node, { query, types } = {}) {
  const needle = query ? String(query).toLowerCase() : null;
  const out = [];
  for (const n of walk(node)) {
    if (types && !types.includes(n.type)) continue;
    if (needle && !String(n.name || '').toLowerCase().includes(needle)) continue;
    out.push({ id: n.id, name: n.name, type: n.type });
  }
  return out;
}

/**
 * Every INSTANCE under a subtree, with the component it points at.
 *
 * A screen holds instances, not component masters — the masters live elsewhere in the file.
 * Walking a screen for COMPONENT nodes therefore reports an empty inventory, which is what
 * the first version of this did. The names come from the `components` map that the nodes
 * endpoint returns alongside the document.
 *
 * @param {object} node
 * @returns {{id: string, name: string, componentId: string}[]}
 */
export function searchInstances(node) {
  const out = [];
  for (const n of walk(node)) {
    if (n.type === 'INSTANCE') {
      out.push({ id: n.id, name: n.name, componentId: n.componentId });
    }
  }
  return out;
}

/**
 * Component and component-set inventory under a subtree. Replaces get_local_components.
 *
 * @param {object} node
 * @returns {{id: string, name: string, type: string}[]}
 */
export function components(node) {
  return searchNodes(node, { types: ['COMPONENT', 'COMPONENT_SET'] });
}

/**
 * Convert a Figma RGBA object (channels 0–1) to a CSS hex string.
 *
 * @param {{r: number, g: number, b: number, a?: number}} color
 * @returns {string}
 */
export function rgbaToHex(color) {
  const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  const hex = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  return (color.a ?? 1) < 1 ? `${hex}${toHex(color.a)}` : hex;
}

/**
 * Reduce a paint to the shape the design spec documents.
 *
 * @param {object} paint
 * @returns {object|string|null}
 */
function serializePaint(paint) {
  if (!paint || paint.visible === false) return null;
  if (paint.type === 'SOLID' && paint.color) {
    const hex = rgbaToHex({ ...paint.color, a: paint.opacity ?? paint.color.a ?? 1 });
    return hex;
  }
  if (String(paint.type).startsWith('GRADIENT')) {
    return {
      type: paint.type,
      stops: (paint.gradientStops || []).map((stop) => ({
        color: rgbaToHex(stop.color || { r: 0, g: 0, b: 0 }),
        position: stop.position
      })),
      handles: paint.gradientHandlePositions
    };
  }
  if (paint.type === 'IMAGE') {
    return { type: 'IMAGE', scaleMode: paint.scaleMode, imageRef: paint.imageRef };
  }
  return { type: paint.type };
}

/** Style properties carried through verbatim when present. */
const PASSTHROUGH_STYLE_KEYS = [
  'layoutMode', 'itemSpacing', 'counterAxisSpacing', 'layoutWrap', 'layoutPositioning',
  'primaryAxisAlignItems', 'counterAxisAlignItems', 'primaryAxisSizingMode',
  'counterAxisSizingMode', 'layoutSizingHorizontal', 'layoutSizingVertical',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'clipsContent', 'cornerRadius', 'rectangleCornerRadii', 'strokeWeight', 'strokeAlign',
  'opacity', 'blendMode', 'overflowDirection'
];

/** Text style properties, read from a TEXT node's `style` block. */
const TEXT_STYLE_KEYS = [
  'fontFamily', 'fontPostScriptName', 'fontWeight', 'fontSize', 'italic',
  'lineHeightPx', 'lineHeightPercent', 'lineHeightUnit', 'letterSpacing',
  'textAlignHorizontal', 'textAlignVertical', 'textAutoResize', 'textCase',
  'textDecoration', 'maxLines'
];

/**
 * Reduce a Figma node tree to the fields a design spec is written from.
 *
 * This is the "enhanced serializer" that bk-design's reference documents as part of the MCP
 * response. It is not cosmetic: one real screen comes back from the REST API as 4.5 MB of
 * node JSON, which no model can be handed. Nearly all of that is geometry, vector path data,
 * plugin blobs and export settings that the spec never mentions.
 *
 * Anything kept here is something design.md is required to state. Anything dropped is
 * something it never asks for — so if a field starts being needed, add it here rather than
 * turning the pruning off.
 *
 * @param {object} node
 * @param {{depth?: number, _level?: number}} [opts] depth counts levels below the root
 * @returns {object|null}
 */
export function serializeNode(node, { depth = Infinity, _level = 0 } = {}) {
  if (!node || typeof node !== 'object') return null;

  const out = { id: node.id, name: node.name, type: node.type };

  const box = node.absoluteBoundingBox;
  if (box) out.size = { w: Math.round(box.width), h: Math.round(box.height) };

  const styles = {};
  for (const key of PASSTHROUGH_STYLE_KEYS) {
    if (node[key] !== undefined) styles[key] = node[key];
  }
  if (Array.isArray(node.fills)) {
    const fills = node.fills.map(serializePaint).filter(Boolean);
    if (fills.length) styles.fills = fills;
  }
  if (Array.isArray(node.strokes)) {
    const strokes = node.strokes.map(serializePaint).filter(Boolean);
    if (strokes.length) styles.strokes = strokes;
  }
  if (Array.isArray(node.effects) && node.effects.length) {
    styles.effects = node.effects
      .filter((effect) => effect.visible !== false)
      .map((effect) => ({
        type: effect.type,
        color: effect.color ? rgbaToHex(effect.color) : undefined,
        offset: effect.offset,
        radius: effect.radius,
        spread: effect.spread
      }));
  }
  if (node.style) {
    for (const key of TEXT_STYLE_KEYS) {
      if (node.style[key] !== undefined) styles[key] = node.style[key];
    }
  }
  if (node.boundVariables) styles.boundVariables = node.boundVariables;
  if (node.styles) out.styleRefs = node.styles;          // named paint/text/effect styles
  if (Object.keys(styles).length) out.styles = styles;

  // Text content is copied, never re-typed: this is what keeps Vietnamese diacritics exact.
  if (typeof node.characters === 'string') out.characters = node.characters;
  if (node.componentId) out.componentId = node.componentId;
  if (node.componentProperties) out.componentProperties = node.componentProperties;

  if (Array.isArray(node.children) && node.children.length) {
    if (_level >= depth) {
      // Say what was cut instead of implying the node is a leaf.
      out.childrenTruncated = node.children.length;
    } else {
      out.children = node.children
        .map((child) => serializeNode(child, { depth, _level: _level + 1 }))
        .filter(Boolean);
    }
  }

  return out;
}

/**
 * Longest the human-readable part of a slug may be, so a wordy frame name does not produce
 * a path that is painful to type or read.
 */
export const MAX_SLUG_NAME_LENGTH = 40;

/**
 * Turn a Figma frame into the kit's screen slug: `11-desktop-373-40736`.
 *
 * The node id is always appended, never only on collision. Real files make this necessary:
 * the OmniWork section this was built against has 17 of 19 frames named "Desktop", and
 * `11-desktop` tells a reader nothing about which screen it holds. Deriving a better name
 * from the frame's text does not work either — two of those frames open with identical text
 * because they are state variants of one screen.
 *
 * Appending unconditionally also keeps paths stable. If the id were added only to
 * duplicates, adding one new "Login" frame later would rename the existing `01-login`
 * directory, breaking every reference downstream that already points at it.
 *
 * @param {string} name
 * @param {number} index 1-based
 * @param {string} [nodeId] e.g. "373:40736"
 * @returns {string}
 */
export function slugify(name, index, nodeId) {
  const base = String(name || 'screen')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip diacritics for the slug only
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_NAME_LENGTH)
    .replace(/-+$/, '') || 'screen';
  const prefix = String(index).padStart(2, '0');
  const suffix = nodeId ? `-${String(nodeId).replace(/[:;]/g, '-')}` : '';
  return `${prefix}-${base}${suffix}`;
}

/**
 * Report frame names that appear more than once.
 *
 * Surfaced in discovery.json so /bk-spec can raise it at the screen-approval checkpoint —
 * before someone approves nineteen screens and only then discovers that seventeen of them
 * are called the same thing.
 *
 * @param {{name: string}[]} screens
 * @returns {{name: string, count: number}[]} most frequent first
 */
export function duplicateNames(screens) {
  const counts = new Map();
  for (const screen of screens) {
    const name = screen?.name ?? '';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
