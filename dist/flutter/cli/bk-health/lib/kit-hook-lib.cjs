'use strict';
/**
 * kit-hook-lib.cjs — Load a module from the kit's hook lib, from either layout.
 *
 * The CLI and the hooks ship as two directories of the same kit, and the path between them
 * differs depending on where you are standing:
 *
 *   installed: .claude/cli/bk-health/lib/ → ../../../hooks/lib/
 *   source:    src/cli/bk-health/lib/     → ../../../hooks/_base/lib/
 *
 * Reaching across is worth it for state access: `.workflow-state.json` has one writer
 * protocol (lock, .bak, tmp + rename) and the CLI writing it its own way is how a
 * `bk-health --resume` and a hook end up clobbering each other.
 */

const fs = require('fs');
const path = require('path');

const LIB_DIRS = [
  path.resolve(__dirname, '../../../hooks/lib'),      // installed kit
  path.resolve(__dirname, '../../../hooks/_base/lib') // this repo
];

/**
 * @param {string} name - File name inside the hook lib, e.g. 'bk-config-utils.cjs'
 * @returns {Object|null} The module, or null when the kit's hooks are not next to the CLI
 */
function requireHookLib(name) {
  for (const dir of LIB_DIRS) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate)) return require(candidate);
    } catch { /* unreadable or broken module — try the next layout */ }
  }
  return null;
}

module.exports = { requireHookLib };
