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

  const LOC_THRESHOLD = 150;
  
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
        process.stdout.write(
          `[SIMPLIFY-CHECK] ${filePath} is ${loc} LOC (threshold: ${LOC_THRESHOLD}). ` +
          `Consider dispatching bk-code-simplifier to refactor for clarity.\n`
        );
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
