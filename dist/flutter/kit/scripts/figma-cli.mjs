#!/usr/bin/env node
/**
 * figma-cli.mjs — Command-line access to a Figma file, for both design engines.
 *
 * The design agents used to reach Figma through an MCP server that no longer exists. They
 * now shell out to this instead, which means the data path is identical whether the spec is
 * written by Claude or by agy — and the parts that must be exact (node ids, text with
 * diacritics, exported binaries) never pass through a model at all.
 *
 * Commands:
 *   discover --url <figma-url> [--out <file>]
 *       Detect FRAME / PAGE / SECTION, list screens with slugs, write discovery.json.
 *
 *   nodes --url <url> | --file <key> --ids <a,b> [--depth N] [--raw] [--out <file>]
 *       Node subtrees — the data get_design_context used to return. Pruned to the fields a
 *       design spec is written from unless --raw is passed; one real screen is 4.5 MB raw
 *       and 27 KB pruned at depth 5.
 *
 *   text --url <url> | --file <key> --ids <a> [--out <file>]
 *       Every TEXT node under a subtree, with `characters` verbatim.
 *
 *   components --url <url> [--out <file>]
 *       Component and component-set inventory.
 *
 *   variables --file <key> [--out <file>]        Design tokens with their modes.
 *   styles --file <key> [--out <file>]           Published paint/text/effect styles.
 *
 *   screen --file <key> --ids <nodeId> --out-dir <dir>
 *       Everything one screen extraction needs, in one pass: the node subtree, its text,
 *       its components, plus file-level variables and styles. Written as separate JSON
 *       files so a model reads only what it needs.
 *
 *   export --file <key> --ids <a,b> --format png|svg|pdf [--scale N]
 *          --out-dir <dir> [--name <base>]
 *       Render nodes and write them to disk, byte-exact.
 *
 * Exit codes: 0 ok · 1 usage or API error · 2 no token
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  FigmaRest, parseFigmaUrl, readToken, downloadImage,
  frameChildren, textNodes, components, searchInstances, slugify, duplicateNames, serializeNode
} from './figma-rest.mjs';

const [command, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) continue;
  const next = rest[i + 1];
  // A boolean flag is one followed by another flag — or by nothing at all. Missing that
  // second case turns a trailing `--raw` into undefined, silently off.
  flags[rest[i].slice(2)] = (next === undefined || next.startsWith('--')) ? true : rest[++i];
}

function die(code, message) {
  console.error(`❌ ${message}`);
  process.exit(code);
}

function output(data) {
  const text = JSON.stringify(data, null, 2);
  if (flags.out) {
    mkdirSync(dirname(flags.out), { recursive: true });
    writeFileSync(flags.out, text + '\n', 'utf8');
    console.log(`✅ ${flags.out}`);
  } else {
    console.log(text);
  }
}

if (!readToken()) {
  die(2, 'No Figma token. Set FIGMA_API_KEY, then re-run.\n'
       + '   Create one at https://www.figma.com/developers/api#access-tokens');
}

/** Resolve the file key and node id from either --url or --file/--ids. */
function target() {
  const fromUrl = flags.url ? parseFigmaUrl(flags.url) : { fileKey: null, nodeId: null };
  const fileKey = flags.file || fromUrl.fileKey;
  const ids = flags.ids ? String(flags.ids).split(',').map((s) => s.trim()).filter(Boolean)
                        : (fromUrl.nodeId ? [fromUrl.nodeId] : []);
  if (!fileKey) die(1, 'Could not determine the file key. Pass --url or --file.');
  return { fileKey, ids };
}

const client = new FigmaRest();

try {
  if (command === 'discover') {
    if (!flags.url) die(1, 'discover needs --url');
    const { fileKey, nodeId } = parseFigmaUrl(flags.url);
    if (!fileKey || !nodeId) die(1, `Could not parse a file key and node id from ${flags.url}`);

    // depth=2 is enough to classify the node and see its children; the per-screen fetch
    // pulls the full subtree later. Asking for everything here would download the file.
    const nodes = await client.getNodes(fileKey, [nodeId], 2);
    const root = nodes[nodeId]?.document;
    if (!root) die(1, `Node ${nodeId} not found in file ${fileKey}`);

    // A FRAME addressed directly is a single screen; a PAGE or SECTION holds many.
    const isSingle = root.type === 'FRAME';
    const screens = (isSingle ? [root] : frameChildren(root)).map((frame, i) => ({
      nodeId: frame.id,
      slug: slugify(frame.name, i + 1, frame.id),
      name: frame.name,
      width: frame.absoluteBoundingBox?.width ?? null,
      height: frame.absoluteBoundingBox?.height ?? null
    }));

    const duplicates = duplicateNames(screens);
    const warnings = duplicates.length > 0
      ? [{
          code: 'duplicate_frame_names',
          message: `${duplicates.reduce((n, d) => n + d.count, 0)} of ${screens.length} frames `
            + 'share a name. Slugs stay unique through the node id, but the names alone will '
            + 'not tell you which screen is which — consider renaming them in Figma.',
          duplicates
        }]
      : [];

    output({
      source: { figma_url: flags.url, file_key: fileKey, section_node_id: nodeId, section_name: root.name },
      detection: {
        mode: root.type,
        total_children: (root.children || []).length,
        frame_count: screens.length
      },
      warnings,
      screens
    });

  } else if (command === 'nodes') {
    const { fileKey, ids } = target();
    if (ids.length === 0) die(1, 'nodes needs --ids or a --url containing node-id');
    // The API's own depth param truncates server-side; the serializer prunes fields. They
    // solve different halves of the size problem, so both are available.
    const fetched = await client.getNodes(fileKey, ids, flags.depth ? Number(flags.depth) : undefined);
    if (flags.raw) {
      output(fetched);
    } else {
      const pruned = {};
      for (const [id, entry] of Object.entries(fetched)) {
        pruned[id] = serializeNode(entry.document, { depth: flags.depth ? Number(flags.depth) : Infinity });
      }
      output(pruned);
    }

  } else if (command === 'text') {
    const { fileKey, ids } = target();
    const nodes = await client.getNodes(fileKey, ids);
    output(ids.flatMap((id) => textNodes(nodes[id]?.document)));

  } else if (command === 'components') {
    const { fileKey, ids } = target();
    const nodes = await client.getNodes(fileKey, ids);
    output(ids.flatMap((id) => components(nodes[id]?.document)));

  } else if (command === 'variables') {
    const { fileKey } = target();
    output(await client.getLocalVariables(fileKey));

  } else if (command === 'styles') {
    const { fileKey } = target();
    output(await client.getStyles(fileKey));

  } else if (command === 'screen') {
    // One command rather than five, because a per-screen extraction always needs the same
    // five things, and five round trips per screen across nineteen screens is most of the
    // wall-clock time.
    const { fileKey, ids } = target();
    if (ids.length === 0) die(1, 'screen needs --ids');
    if (!flags['out-dir']) die(1, 'screen needs --out-dir');
    const outDir = flags['out-dir'];
    mkdirSync(outDir, { recursive: true });

    const nodes = await client.getNodes(fileKey, ids);
    const entry = nodes[ids[0]];
    const document = entry?.document;
    if (!document) die(1, `Node ${ids[0]} not found in file ${fileKey}`);

    /** Write one artefact and report its size, so an empty fetch is visible immediately. */
    const write = (name, data) => {
      const path = join(outDir, name);
      const text = JSON.stringify(data, null, 2);
      writeFileSync(path, text + '\n', 'utf8');
      return { file: name, bytes: text.length };
    };

    // Pruned by default: the raw subtree for one screen is 4.5 MB, which is not something a
    // model can be handed. --raw keeps the original for debugging.
    const depth = flags.depth ? Number(flags.depth) : undefined;
    const written = [
      write('node.json', flags.raw ? document : serializeNode(document, { depth: depth ?? Infinity })),
      write('text.json', textNodes(document))
    ];

    // The component inventory comes from the response's own maps, not from walking the
    // subtree. A screen contains INSTANCE nodes, not COMPONENT nodes — the masters live
    // elsewhere in the file — so walking finds nothing and reports an empty inventory.
    written.push(write('components.json', {
      components: entry.components || {},
      componentSets: entry.componentSets || {},
      instances: searchInstances(document)
    }));

    // Style names come from the map the nodes response carries, which resolves the styleRefs
    // on individual nodes. The /styles endpoint lists PUBLISHED library styles only and
    // returns an empty array for a file that publishes none — using it alone would report
    // "no styles" for a file full of them.
    written.push(write('styles.json', entry.styles || {}));

    // Variables are file-level and frequently unavailable: the REST Variables endpoint needs
    // the file_variables:read scope and a Figma Enterprise plan. That is a normal state, not
    // a failure — the spec falls back to raw values — so say so in one line instead of
    // pasting the API's scope dump.
    try {
      written.push(write('variables.json', await client.getLocalVariables(fileKey)));
    } catch (err) {
      const denied = /403/.test(err.message);
      written.push({
        file: 'variables.json',
        skipped: denied
          ? 'Figma denied the Variables API (403). It needs the file_variables:read scope on '
            + 'the token and a Figma Enterprise plan. Design tokens must come from styles.json '
            + 'and the raw values in node.json instead.'
          : err.message
      });
    }

    output({
      fileKey,
      nodeId: ids[0],
      name: document.name,
      type: document.type,
      size: document.absoluteBoundingBox
        ? { width: document.absoluteBoundingBox.width, height: document.absoluteBoundingBox.height }
        : null,
      written
    });

  } else if (command === 'export') {
    const { fileKey, ids } = target();
    if (ids.length === 0) die(1, 'export needs --ids');
    if (!flags['out-dir']) die(1, 'export needs --out-dir');
    const format = flags.format || 'png';
    const scale = flags.scale ? Number(flags.scale) : undefined;

    const urls = await client.getImageUrls(fileKey, ids, { format, scale });
    const written = [];
    for (const [nodeId, url] of Object.entries(urls)) {
      if (!url) {
        // Figma returns null for a node it declined to render — an empty INSTANCE shell
        // from an external library, most often. Recording it beats a zero-byte file.
        written.push({ nodeId, skipped: 'figma returned no image for this node' });
        continue;
      }
      const base = flags.name || nodeId.replace(/[:;]/g, '-');
      const suffix = scale && scale !== 1 ? `@${scale}x` : '';
      const path = join(flags['out-dir'], `${base}${suffix}.${format}`);
      const bytes = await downloadImage(url, path);
      written.push({ nodeId, path, bytes });
    }
    output({ fileKey, format, scale: scale ?? 1, written });

  } else {
    die(1, `Unknown command "${command || ''}". `
         + 'Expected: discover | screen | nodes | text | components | variables | styles | export');
  }
} catch (err) {
  die(1, err.message);
}
