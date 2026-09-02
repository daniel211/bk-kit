#!/usr/bin/env node
// subagent-init.cjs - SubagentStart hook for beer-kit mobile toolkit
// Template variables: ios
// Trigger: SubagentStart (when bk-code dispatches agents)
// Purpose: Inject platform context, active plan, and rules to dispatched agents

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  async function main() {
    try {
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const payload = JSON.parse(input || '{}');
      const agentType = payload.agent_type || 'unknown';

      // Read BK_* env vars set by session-init (DRY — don't re-detect)
      const tmplPlatform = 'ios';
      const platform = process.env.BK_PLATFORM
        || (tmplPlatform && !tmplPlatform.startsWith('{{') ? tmplPlatform : null)
        || 'unknown';
      const projectRoot = process.env.BK_PROJECT_ROOT || resolveProjectRoot();
      const activePlan = process.env.BK_ACTIVE_PLAN || '';
      const hasFoundation = process.env.BK_HAS_FOUNDATION === 'true';
      const hasLSP = process.env.BK_LSP_AVAILABLE === 'true';

      // --- Task 3.3: Foundation context auto-injection ---
      // Agents that benefit from foundation context
      const FOUNDATION_AGENTS = [
        'bk-debugger', 'bk-code-reviewer', 'bk-security-auditor',
        'bk-performance-analyzer', 'bk-test-architect',
        'bk-code-simplifier'
      ];

      /**
       * Extract complete markdown sections up to a token budget.
       * Splits on ## headings, keeps full sections (never truncates mid-section).
       * @param {string} content - Markdown content
       * @param {number} maxChars - Approximate char budget (~4 chars/token)
       * @returns {string} Truncated content with complete sections
       */
      function extractSections(content, maxChars) {
        const sections = content.split(/^(?=## )/m);
        let result = '';
        let chars = 0;
        for (const section of sections) {
          if (chars + section.length > maxChars && chars > 0) break;
          result += section;
          chars += section.length;
        }
        return result;
      }

      async function injectFoundationContext(agentName) {
        if (!FOUNDATION_AGENTS.includes(agentName)) return '';

        const foundationPath = path.join(resolveProjectRoot(), 'bk', 'docs', 'foundation');
        // Budget: ~200 tokens for arch (~800 chars) + ~120 tokens for guidelines (~480 chars)
        let context = '\n\n--- Foundation Context (auto-injected) ---\n';

        try {
          const archFile = path.join(foundationPath, 'architecture.md');
          if (fs.existsSync(archFile)) {
            const arch = fs.readFileSync(archFile, 'utf8');
            const summary = extractSections(arch, 800);
            context += '\n### Architecture Summary\n' + summary + '\n';
          }

          const guidelinesFile = path.join(foundationPath, 'code-guidelines.md');
          if (fs.existsSync(guidelinesFile)) {
            const guidelines = fs.readFileSync(guidelinesFile, 'utf8');
            const summary = extractSections(guidelines, 480);
            context += '\n### Code Guidelines Summary\n' + summary + '\n';
          }
        } catch (e) {
          // Foundation docs not available — skip silently
          return '';
        }

        context += '--- End Foundation Context ---\n';
        return context;
      }

      // Build compact context for agent
      const lines = [];
      lines.push(`## MK Agent Context`);
      lines.push(`- Agent: ${agentType}`);
      lines.push(`- Platform: ${platform}`);
      lines.push(`- Project root: ${projectRoot}`);

      if (activePlan) {
        lines.push(`- Active plan: ${activePlan}`);
        // Check for SRS in plan dir
        const planSrs = path.join(projectRoot, activePlan, 'srs.md');
        if (fs.existsSync(planSrs)) {
          lines.push(`- Feature SRS: ${activePlan}/srs.md`);
        }
      }

      if (hasFoundation) lines.push(`- Foundation: bk/docs/foundation/`);

      lines.push(`- Platform context: .platform-context.${platform}.json`);
      if (hasLSP) lines.push(`- LSP: available (use for symbol navigation, references)`);
      lines.push(``);

      lines.push(`## Rules`);
      lines.push(`- Follow ${platform} naming conventions`);
      lines.push(`- Use localized string keys, never hardcoded UI text`);
      lines.push(`- Run lint after editing code files`);
      lines.push(`- File size < 200 LOC per file`);
      lines.push(`- Verify implementation covers reqs from phase YAML (if declared)`);

      // Inject foundation context for eligible agents (Task 3.3)
      const foundationCtx = await injectFoundationContext(agentType);
      if (foundationCtx) {
        lines.push(foundationCtx);
      }

      // SubagentStart requires hookSpecificOutput.additionalContext format
      const output = {
        hookSpecificOutput: {
          hookEventName: 'SubagentStart',
          additionalContext: lines.join('\n')
        }
      };

      console.log(JSON.stringify(output));
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[subagent-init] error: ${err.message}\n`);
      process.exit(0); // Fail-open
    }
  }
  main();
} catch (e) {
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'subagent-init', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0); // Fail-open
}
