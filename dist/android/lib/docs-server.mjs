/**
 * docs-server.mjs — Minimal static file server for the bk docs site.
 *
 * Uses node:http to serve pre-built HTML/CSS/JS from a directory.
 * Auto-opens the browser on macOS using the 'open' command.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { exec } from 'node:child_process';

/** Map of file extensions to MIME types. */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Resolve a URL path to a file path within the served directory.
 * Falls back to index.html for directory requests (SPA-style fallback).
 * @param {string} serveDir - Absolute path to the directory being served
 * @param {string} urlPath - The request URL pathname
 * @returns {string} Resolved absolute file path
 */
function resolveFilePath(serveDir, urlPath) {
  // Normalize: strip query string, decode URI components
  const clean = decodeURIComponent(urlPath.split('?')[0]);

  // Prevent directory traversal: resolve and verify path stays inside serveDir
  let filePath = normalize(resolve(serveDir, '.' + clean));
  if (!filePath.startsWith(serveDir)) {
    filePath = join(serveDir, 'index.html'); // Redirect traversal to index
  }

  // If path points to a directory, serve index.html from it
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  return filePath;
}

/**
 * Open a URL in the default browser (macOS / Linux / Windows).
 * Fires and forgets — errors are silently ignored.
 * @param {string} url
 */
function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      // Non-fatal: user can open browser manually
      console.log(`  Note: could not auto-open browser. Visit ${url} manually.`);
    }
  });
}

/**
 * Start a static file server and open the browser.
 *
 * @param {string} serveDir - Absolute path to the built docs directory
 * @param {number} port - Port number to listen on (default 3000)
 * @returns {Promise<import('node:http').Server>} Resolves when server is listening
 */
export function serveDocs(serveDir, port = 3000) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const filePath = resolveFilePath(serveDir, req.url || '/');
      const ext = extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      if (!existsSync(filePath)) {
        // 404: try serving root index.html as fallback for client-side routing
        const fallback = join(serveDir, 'index.html');
        if (existsSync(fallback)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(readFileSync(fallback));
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        }
        return;
      }

      try {
        const content = readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mimeType });
        res.end(content);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Error: port ${port} is already in use. Use --port to specify a different port.`);
      }
      reject(err);
    });

    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}`;
      console.log(`  Docs server running at ${url}`);
      console.log('  Press Ctrl+C to stop.\n');
      openBrowser(url);
      resolve(server);
    });
  });
}
