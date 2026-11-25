/**
 * detekt-gradle-reports.cjs — collect what a `./gradlew detekt` run wrote, scoped to the batch.
 *
 * Why: the Gradle plugin's `detekt` task takes no file list (its only command-line options are
 * --auto-correct / --rerun — verified with `gradle help --task :app:detekt` on plugin 1.23.8
 * (io.gitlab.arturbosch.detekt) and 2.0.0-alpha.6 (dev.detekt), Gradle 9.9.1, 2026-11-25). It
 * analyses every module that applies the plugin and writes one XML report PER MODULE:
 * `<module>/build/reports/detekt/detekt.xml` (`main.xml` etc. for detektMain-style tasks), XML on
 * by default. So the runner must (a) read every fresh report, not the first one it finds, and
 * (b) keep only the findings in the files this batch edited — a whole-project run otherwise
 * reports every pre-existing issue in the codebase against this turn.
 *
 * Report <file name="..."> paths: absolute on 1.23.x, relative to the Gradle root project on
 * 2.x (`core/data/src/main/kotlin/y/B.kt`) — both observed in the same experiment. Relative ones
 * are resolved against the component root the run used (where gradlew lives).
 *
 * Exports:
 *   realish(p)                                    — real path through the nearest existing ancestor
 *   collectDetektReports(root, { since })          → [{ path, xml }]
 *   scopeFindings(findings, targets, { root, projectRoot }) → findings (absolute file, deduped,
 *                                                    only those inside a target file / dir)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Module dirs below the root that are searched for build/reports/detekt. 3 covers the common
 * `feature/<name>/impl` layout; `app` and `core/data` are 1 and 2.
 */
const MAX_MODULE_DEPTH = 3;
/** Hard stop on directories visited, so a huge tree cannot stall the flush worker. */
const MAX_DIRS_VISITED = 2000;
/** Never modules: build outputs, Gradle state, JS deps, and source trees (large, never a module root). */
const SKIP_DIRS = new Set(['build', 'node_modules', 'src', 'out', 'gradle']);

/** Real path of `p`, resolving symlinks through the nearest existing ancestor (macOS /tmp -> /private/tmp). */
function realish(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...tail.reverse()); } catch { /* climb */ }
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(p);
    tail.push(path.basename(cur));
    cur = parent;
  }
}

/**
 * Every detekt XML report under `root` (root project + module dirs up to MAX_MODULE_DEPTH deep).
 *
 * @param {string} root — the Gradle root (component root) the run used
 * @param {{ since?: number }} [opts] — since: skip reports last written before this epoch ms (1s
 *   slack for coarse mtimes). An UP-TO-DATE module task does not rewrite its report, so a stale
 *   one is a previous run's result and must not be replayed as this run's.
 * @returns {{ path: string, xml: string }[]}
 */
function collectDetektReports(root, opts = {}) {
  const reports = [];
  if (!root) return reports;
  const queue = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_DIRS_VISITED) {
    const { dir, depth } = queue.shift();
    visited += 1;
    readReportDir(path.join(dir, 'build', 'reports', 'detekt'), opts.since, reports);
    if (depth >= MAX_MODULE_DEPTH) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return reports;
}

function readReportDir(reportDir, since, out) {
  let names;
  try { names = fs.readdirSync(reportDir); } catch { return; }
  for (const name of names.sort()) {
    if (!name.endsWith('.xml')) continue;
    const p = path.join(reportDir, name);
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      if (since && st.mtimeMs < since - 1000) continue;
      out.push({ path: p, xml: fs.readFileSync(p, 'utf8') });
    } catch { /* unreadable report: skip it */ }
  }
}

/**
 * Resolve each finding's file to an absolute path, drop duplicates (a project that also writes a
 * merged report, or runs detektMain alongside detekt, lists the same issue twice), and keep only
 * findings inside one of `targets` (a file, or a directory containing it). No targets → all kept.
 *
 * @param {object[]} findings — parseDetektXml() output
 * @param {string[]} targets — the batch's edited paths
 * @param {{ root: string, projectRoot?: string }} opts — root: what relative report paths are
 *   relative to (the Gradle root); projectRoot: what relative TARGETS are relative to
 * @returns {object[]}
 */
function scopeFindings(findings, targets, opts = {}) {
  const root = opts.root || process.cwd();
  const targetRoot = opts.projectRoot || root;
  const wanted = (targets || []).filter(Boolean).map((t) => realish(path.isAbsolute(t) ? t : path.join(targetRoot, t)));
  const seen = new Set();
  const out = [];
  for (const f of findings || []) {
    if (!f || !f.file) continue;
    const abs = path.isAbsolute(f.file) ? f.file : path.join(root, f.file);
    const real = realish(abs);
    if (wanted.length > 0 && !wanted.some((t) => real === t || real.startsWith(t + path.sep))) continue;
    const key = [real, f.line, f.rule, f.message].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...f, file: abs });
  }
  return out;
}

module.exports = {
  MAX_MODULE_DEPTH,
  MAX_DIRS_VISITED,
  realish,
  collectDetektReports,
  scopeFindings
};
