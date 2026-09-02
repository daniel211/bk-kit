/**
 * settings-merger.mjs — Deep-merge strategy for settings.json during init/update.
 *
 * Preserves user-added hooks, MCP servers, and env vars while adding toolkit entries.
 * Replaces statusLine entirely (must match toolkit hooks).
 */

/**
 * Merge toolkit settings into existing user settings.
 * @param {object} existing — user's current settings.json
 * @param {object} toolkit — kit's settings.json
 * @returns {{ merged: object, summary: string[] }}
 */
export function mergeSettings(existing, toolkit) {
  const merged = { ...existing };
  const summary = [];

  // 1. Hooks: merge per event type, add toolkit hooks that don't exist yet
  if (toolkit.hooks) {
    merged.hooks = merged.hooks || {};
    for (const [event, toolkitEntries] of Object.entries(toolkit.hooks)) {
      if (!merged.hooks[event]) {
        merged.hooks[event] = toolkitEntries;
        summary.push(`+ Added ${toolkitEntries.length} hook group(s) for ${event}`);
      } else {
        // Merge: add toolkit hook commands not already present
        const existingCommands = new Set();
        for (const group of merged.hooks[event]) {
          for (const hook of (group.hooks || [])) {
            existingCommands.add(hook.command);
          }
        }

        let added = 0;
        for (const toolkitGroup of toolkitEntries) {
          const newHooks = (toolkitGroup.hooks || []).filter(h => !existingCommands.has(h.command));
          if (newHooks.length > 0) {
            // Find matching group by matcher, or create new
            const matchingGroup = merged.hooks[event].find(g => g.matcher === toolkitGroup.matcher);
            if (matchingGroup) {
              matchingGroup.hooks = [...matchingGroup.hooks, ...newHooks];
            } else {
              merged.hooks[event].push({ ...toolkitGroup, hooks: newHooks });
            }
            added += newHooks.length;
          }
        }
        if (added > 0) summary.push(`+ Added ${added} new hook(s) for ${event}`);
      }
    }
  }

  // 2. MCP Servers: merge by name, keep existing on conflict
  if (toolkit.mcpServers) {
    merged.mcpServers = merged.mcpServers || {};
    for (const [name, config] of Object.entries(toolkit.mcpServers)) {
      if (!merged.mcpServers[name]) {
        merged.mcpServers[name] = config;
        summary.push(`+ Added MCP server: ${name}`);
      } else {
        summary.push(`⚠ MCP server "${name}" already exists — kept existing config`);
      }
    }
  }

  // 3. Env vars: merge keys, keep existing values on conflict
  if (toolkit.env) {
    merged.env = merged.env || {};
    for (const [key, value] of Object.entries(toolkit.env)) {
      if (!(key in merged.env)) {
        merged.env[key] = value;
        summary.push(`+ Added env: ${key}`);
      }
    }
  }

  // 4. StatusLine: replace entirely (must match toolkit hooks)
  if (toolkit.statusLine) {
    merged.statusLine = toolkit.statusLine;
  }

  return { merged, summary };
}
