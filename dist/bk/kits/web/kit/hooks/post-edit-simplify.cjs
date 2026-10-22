#!/usr/bin/env node
'use strict';
/**
 * Post-Edit Simplify Reminder
 * Trigger: PostToolUse (Edit/Write)
 * Purpose: Remind about code simplification when files get large
 * Non-blocking, advisory only
 */
try {
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { getFilePath } = require('./lib/hook-event-accessor.cjs');

  // 200, the kit's own rule (rules/_base/development-rules.md "File size < 200 LOC", and the
  // bar bk-code-simplifier verifies against). This was 150, which nobody noticed while the
  // reminder never reached the model; once it does, telling an agent a 170-line file breaks a
  // rule the kit states as 200 is just wrong.
  const LOC_THRESHOLD = 200;
  
  // Source file extensions to check
  const SOURCE_EXTENSIONS = ['.swift', '.kt', '.dart', '.ts', '.tsx', '.js', '.jsx'];

  async function main() {
    try {
      const stdin = fs.readFileSync(0, 'utf-8').trim();
      if (!stdin) process.exit(0);

      const data = JSON.parse(stdin);
      // RC-2: route through canonical accessor — handles all known schema variants.
      const filePath = getFilePath(data);
      
      if (!filePath) process.exit(0);
      
      // Only check source files
      const ext = path.extname(filePath).toLowerCase();
      if (!SOURCE_EXTENSIONS.includes(ext)) process.exit(0);
      
      // Check file size
      const fullPath = path.resolve(resolveProjectRoot(), filePath);
      if (!fs.existsSync(fullPath)) process.exit(0);
      
      const content = fs.readFileSync(fullPath, 'utf8');
      const loc = content.split('\n').length;
      
      if (loc > LOC_THRESHOLD) {
        // Most of these edits are a subagent's (161 of 161 fusionworkomni rows were sidechain),
        // and a subagent cannot dispatch anything — the worker preamble forbids Task. Advice to
        // "dispatch bk-code-simplifier" is only actionable by the conductor.
        const { isSubagentEvent } = require('./lib/hook-caller-context.cjs');
        const advice = isSubagentEvent(data)
          ? 'Keep new code out of it where you can, and list it in your report so the conductor can dispatch bk-code-simplifier.'
          : 'Consider dispatching bk-code-simplifier to refactor for clarity.';
        let text = `[SIMPLIFY-CHECK] ${filePath} is ${loc} LOC (threshold: ${LOC_THRESHOLD}). ${advice}`;

        // Every edit to a large file repeated this line — 161 times in 13 fusionworkomni
        // sessions. Through the shared injection budget it is said once per FILE per dedupe
        // window: the dedupe key is the file, not the text, because the LOC count changes on
        // nearly every edit and would make each repeat look new.
        try {
          const injectionBudget = require('./lib/injection-budget.cjs');
          const sessionId = injectionBudget.sessionIdFrom(data);
          const key = injectionBudget.hashContent(`post-edit-simplify:${fullPath}`);
          const bytes = Buffer.byteLength(text, 'utf8');
          if (injectionBudget.shouldInject('post-edit-simplify', key, { sessionId, bytes })) {
            injectionBudget.recordInjection('post-edit-simplify', bytes, key, { sessionId });
          } else {
            text = null;
          }
        } catch { /* optional lib — keep the text */ }

        if (text) process.stdout.write(text + '\n');
      }
      
      process.exit(0);
    } catch (e) {
      process.exit(0);
    }
  }
  main();
} catch (e) {
  process.exit(0);
}
