/**
 * codex-review-report.mjs — Write the Codex review as JSON + Markdown.
 *
 * Paths are codex-suffixed (`code-review-codex-{feature}.*`): bk-code-reviewer owns the
 * unsuffixed name and bk-gemini-reviewer the gemini one, so `/bk-review --engine all` keeps
 * all three reports instead of one clobbering another.
 *
 * Verdict semantics match bk-gemini-review: `approve` / `request_changes` are review results;
 * `error` is a harness failure with a `### Harness Error` section and no findings.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const AGENT = 'bk-codex-reviewer';

const count = (result, sev) =>
  result.summary?.[sev] ?? result.findings.filter(f => f.severity === sev).length;
const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * @param {object} p
 * @param {string} p.projectRoot
 * @param {string} p.feature
 * @param {string} p.model — label for the report (the requested id, or "codex-default")
 * @param {object} p.result — {verdict, summary, findings, error?}
 * @param {string[]} p.files
 * @param {string} [p.rawOutput] — saved next to the report when parsing failed
 * @returns {{mdPath: string, jsonPath: string, verdict: string, counts: object}}
 */
export function writeReport({ projectRoot, feature, model, result, files, rawOutput }) {
  const dir = join(projectRoot, 'bk', 'dev', 'shared', 'reports');
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `code-review-codex-${feature}`);

  if (rawOutput) {
    try {
      writeFileSync(`${base}.raw.txt`, rawOutput, 'utf8');
      console.error(`   Raw response saved to: ${base}.raw.txt`);
    } catch (_) { /* best effort */ }
  }

  const counts = {
    critical: count(result, 'critical'), major: count(result, 'major'),
    minor: count(result, 'minor'), info: count(result, 'info')
  };
  const verdict = result.verdict
    || (counts.critical > 0 || counts.major > 0 ? 'request_changes' : 'approve');

  let md = `## Code Review (Codex): ${feature}
**Agent**: ${AGENT} | **Model**: ${model} | **Date**: ${new Date().toISOString()} | **Verdict**: ${verdict}

### Files Reviewed
${files.length > 0 ? files.map(f => `- ${f}`).join('\n') : '- No changed files'}

### Findings
| # | Severity | File | Line | Rule | Message | Suggestion |
|---|----------|------|------|------|---------|------------|
`;

  if (result.findings.length === 0 && verdict === 'error') {
    md += '| - | - | - | - | - | Review did not run to completion — see Harness Error below. | - |\n';
  } else if (result.findings.length === 0) {
    md += '| - | info | - | - | clean-arch | No issues found. Code passes architectural and safety inspection. | - |\n';
  } else {
    result.findings.forEach((f, i) => {
      md += `| ${i + 1} | ${f.severity} | ${f.file} | ${f.line || 1} | ${f.rule} | ${cell(f.message)} | ${cell(f.suggestion)} |\n`;
    });
  }

  if (result.error) {
    md += `
### Harness Error
The Codex review harness did not complete. This is a tooling failure, **not** a finding
about the code under review — do not treat this report as a passed or failed review.

- **What happened**: ${result.error.message}
- **How to fix**: ${result.error.remediation}
`;
  }

  const status = verdict === 'error' ? 'error' : 'complete';
  md += `
### Summary
- Critical: ${counts.critical} | Major: ${counts.major} | Minor: ${counts.minor} | Info: ${counts.info}
- **Verdict**: ${verdict}

<!-- metadata: {"schema_version":"1.0","agent":"${AGENT}","model":"${model}","feature":"${feature}","verdict":"${verdict}","status":"${status}"} -->
`;

  writeFileSync(`${base}.json`, JSON.stringify(result, null, 2), 'utf8');
  writeFileSync(`${base}.md`, md, 'utf8');
  return { mdPath: `${base}.md`, jsonPath: `${base}.json`, verdict, counts };
}
