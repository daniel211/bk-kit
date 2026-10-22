/**
 * docs-builder.mjs — Template engine for the beer-kit static docs site.
 *
 * Reads HTML templates from templates/docs/, injects catalog data via
 * {{PLACEHOLDER}} replacement, copies assets, and writes output to outDir.
 *
 * Exported: buildDocs(catalog, templateDir, outDir, platform, lang)
 */

import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── i18n ─────────────────────────────────────────────────────────────────────

/** Load locale JSON from templates/docs/locales/{lang}.json. Returns { ui, descriptions }. */
function loadLocale(templateDir, lang) {
  const localePath = join(templateDir, 'locales', `${lang}.json`);
  if (!existsSync(localePath)) return null;
  return JSON.parse(readFileSync(localePath, 'utf8'));
}

/** Apply locale descriptions to catalog items + examples. Mutates items in-place. */
function translateCatalog(catalog, locale) {
  if (!locale?.descriptions) return;
  const desc = locale.descriptions;
  const lists = [catalog.agents, catalog.skills, catalog.rules, catalog.examples].filter(Boolean);
  for (const list of lists) {
    for (const item of list) {
      if (desc[item.name]) item.description = desc[item.name];
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Escape HTML special characters to prevent XSS in generated pages. */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Map item type/platform to a CSS badge class.
 * @param {{ type: string, platform?: string }} item
 * @returns {string} badge class name
 */
function badgeClass(item) {
  if (item.type === 'platform' && item.platform) {
    return `badge-${item.platform}`;
  }
  return `badge-${item.type}`;
}

/**
 * Render a single card for an agent, skill, rule, or example item.
 * @param {{ name: string, description: string, type: string, platform?: string }} item
 * @returns {string} HTML card string
 */
function renderCard(item) {
  const searchTerms = [item.name, item.description, item.type, item.platform].filter(Boolean).join(' ');
  const badge = badgeClass(item);
  const labelText = item.platform ?? item.type;
  return `<div class="card" data-type="${esc(item.type)}" data-search="${esc(searchTerms.toLowerCase())}">
  <div class="card-header">
    <h3>${esc(item.name)}</h3>
    <span class="badge ${esc(badge)}">${esc(labelText)}</span>
  </div>
  <p>${esc(item.description)}</p>
</div>`;
}

// ─── Per-template content generators ─────────────────────────────────────────

/**
 * Build replacement map for agents.html.
 * Splits catalog.agents into base (type=base) and platform groups.
 */
function agentsReplacements(catalog) {
  const base = catalog.agents.filter(a => a.type === 'base');
  const platform = catalog.agents.filter(a => a.type === 'platform');
  return {
    '{{AGENT_LIST}}': base.map(renderCard).join('\n'),
    '{{SIDEBAR_AGENTS}}': platform.map(renderCard).join('\n'),
  };
}

/**
 * Build replacement map for skills.html.
 * Splits catalog.skills into workflow (type=base) and platform groups.
 */
function skillsReplacements(catalog) {
  const workflow = catalog.skills.filter(s => s.type === 'base');
  const platform = catalog.skills.filter(s => s.type === 'platform');
  return {
    '{{SKILL_LIST}}': workflow.map(renderCard).join('\n'),
    '{{SIDEBAR_SKILLS}}': platform.map(renderCard).join('\n'),
  };
}

/**
 * Build replacement map for workflows.html.
 * Renders all catalog.rules as cards injected at {{WORKFLOW_CONTENT}}.
 */
function workflowsReplacements(catalog) {
  return {
    '{{WORKFLOW_CONTENT}}': (catalog.rules ?? []).map(renderCard).join('\n'),
  };
}

/**
 * Build replacement map for examples.html.
 * Renders catalog.examples if present, else empty state message.
 */
function examplesReplacements(catalog) {
  const examples = catalog.examples ?? defaultExamples();
  return {
    '{{EXAMPLE_LIST}}': examples.map(renderCard).join('\n'),
  };
}

/** Built-in example usecases showing kit workflows. */
function defaultExamples() {
  return [
    { name: 'Bootstrap New Project', type: 'base', description: 'Run bk init --kit <platform> → scaffolds .claude/ with agents, skills, hooks. Then use /bk-bootstrap to set up project structure, dependencies, and CI/CD.' },
    { name: 'Generate API Layer from Swagger', type: 'base', description: 'Import OpenAPI/Swagger spec → /bk-generate parses endpoints → generates models, API client, and repository layer with proper error handling.' },
    { name: 'Debug a Crash', type: 'base', description: 'Use /bk-debug with crash logs or stack trace → bk-debugger agent analyzes root cause → suggests fix with code patch → /bk-test validates the fix.' },
    { name: 'Code Review Workflow', type: 'base', description: 'After implementation, /bk-review triggers bk-code-reviewer → checks code quality, patterns, security → generates review report with actionable items.' },
    { name: 'Design to Code (Figma)', type: 'base', description: 'Set FIGMA_API_KEY → /bk-spec --design reads Figma over its REST API and extracts components, colors, typography (design-validator + design-spec-writer + design-asset-exporter) → /bk-code generates platform-native UI code (SwiftUI/Compose/Flutter widgets). No MCP server needed; the default --engine auto runs the extraction through Gemini when this machine can, and through Claude when it cannot.' },
    { name: 'iOS — SwiftUI View from Design', type: 'ios', platform: 'ios', description: 'Figma screen → /bk-spec --design → /bk-code → SwiftUI View with @State, @Binding, proper previews. Follows MVVM + Coordinator pattern per bk-ios rules.' },
    { name: 'Android — Compose Screen from API', type: 'android', platform: 'android', description: 'OpenAPI endpoint → /bk-generate → Kotlin data classes, Retrofit service, ViewModel with StateFlow, Compose UI. Follows Clean Architecture layers.' },
    { name: 'Flutter — Widget + BLoC from Spec', type: 'flutter', platform: 'flutter', description: 'Feature spec → /bk-code → Dart models, BLoC/Cubit with states, Widget tree with BlocBuilder. Includes unit + widget tests.' },
    { name: 'Python — FastAPI Endpoint from Spec', type: 'python', platform: 'python', description: 'Feature spec → /bk-code → Pydantic schemas, FastAPI router with dependency-injected service, SQLAlchemy repository + Alembic migration. pytest tests; ruff + mypy clean.' },
    { name: 'Web — React Page from Design', type: 'web', platform: 'web', description: 'Figma screen → /bk-spec --design → /bk-code → typed React components (Next.js or Vite), data fetching with loading/error states. Vitest/Jest unit tests + a Playwright flow.' },
  ];
}

/**
 * Apply all placeholder replacements to a template string.
 * @param {string} template - Raw HTML template content
 * @param {Record<string, string>} replacements - Map of {{KEY}} → HTML string
 * @returns {string} Processed HTML
 */
function applyReplacements(template, replacements) {
  let result = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    // Replace all occurrences of the placeholder
    result = result.split(placeholder).join(value);
  }
  return result;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build the static docs site from catalog data and HTML templates.
 *
 * Steps:
 *   1. Create output directories (assets/, data/)
 *   2. Write catalog JSON to data/catalog.json for client-side use
 *   3. Copy static assets (style.css, app.js) from templateDir/assets/
 *   4. Process each HTML template: replace placeholders, write to outDir
 *
 * @param {{ agents: Array, skills: Array, rules: Array, examples?: Array }} catalog
 * @param {string} templateDir - Absolute path to templates/docs/ directory
 * @param {string} outDir - Absolute path to write output
 * @param {string} platform - Active platform (ios | android | flutter | python | web)
 * @param {string} [lang='vi'] - Language code (en | vi)
 */
export function buildDocs(catalog, templateDir, outDir, platform, lang = 'vi') {
  // 0. Set default examples if not provided, then load locale and translate
  if (!catalog.examples) catalog.examples = defaultExamples();
  const locale = loadLocale(templateDir, lang);
  if (locale) translateCatalog(catalog, locale);

  // 1. Create output directories
  mkdirSync(join(outDir, 'assets'), { recursive: true });
  mkdirSync(join(outDir, 'data'), { recursive: true });

  // 2. Write catalog JSON for client-side search / dynamic use
  // Strip absolute paths from catalog before writing (security)
  const safeCatalog = { platform, lang };
  for (const key of ['agents', 'skills', 'rules', 'examples']) {
    if (catalog[key]) {
      safeCatalog[key] = catalog[key].map(({ path, ...rest }) => rest);
    }
  }
  writeFileSync(
    join(outDir, 'data', 'catalog.json'),
    JSON.stringify(safeCatalog, null, 2),
    'utf8'
  );

  // Copy locale files for client-side language toggle
  const localesOutDir = join(outDir, 'locales');
  mkdirSync(localesOutDir, { recursive: true });
  for (const l of ['en', 'vi']) {
    const src = join(templateDir, 'locales', `${l}.json`);
    if (existsSync(src)) copyFileSync(src, join(localesOutDir, `${l}.json`));
  }

  // 3. Copy static assets from templateDir/assets/
  for (const asset of ['style.css', 'app.js']) {
    const src = join(templateDir, 'assets', asset);
    if (existsSync(src)) {
      copyFileSync(src, join(outDir, 'assets', asset));
    }
  }

  // 4. Build UI string replacements from locale
  const ui = locale?.ui ?? {};
  const uiReplacements = {
    '{{LANG}}': lang,
    '{{UI_SITE_NAME}}': esc(ui.siteName ?? 'beer-kit'),
    '{{UI_SITE_TAGLINE}}': esc(ui.siteTagline ?? 'Mobile Development Kit for Claude Code'),
    '{{UI_HOME}}': esc(ui.home ?? 'Home'),
    '{{UI_AGENTS}}': esc(ui.agents ?? 'Agents'),
    '{{UI_SKILLS}}': esc(ui.skills ?? 'Skills'),
    '{{UI_WORKFLOWS}}': esc(ui.workflows ?? 'Workflows'),
    '{{UI_EXAMPLES}}': esc(ui.examples ?? 'Examples'),
    '{{UI_SEARCH}}': esc(ui.searchPlaceholder ?? 'Search...'),
    '{{UI_FILTER_ALL}}': esc(ui.filterAll ?? 'All'),
    '{{UI_FILTER_BASE}}': esc(ui.filterBase ?? 'General'),
    '{{UI_NO_RESULTS}}': esc(ui.noResults ?? 'No results match your search.'),
    '{{UI_RULES}}': esc(ui.rules ?? 'Rules'),
    '{{UI_HOOKS}}': esc(ui.hooks ?? 'Hooks'),
    '{{UI_BASE_AGENTS}}': esc(ui.baseAgents ?? 'Base Agents'),
    '{{UI_PLATFORM_AGENTS}}': esc(ui.platformAgents ?? 'Platform Agents'),
    '{{UI_BASE_SKILLS}}': esc(ui.baseSkills ?? 'Base Skills'),
    '{{UI_PLATFORM_SKILLS}}': esc(ui.platformSkills ?? 'Platform Skills'),
    '{{UI_AGENTS_SUBTITLE}}': esc(ui.agentsSubtitle ?? ''),
    '{{UI_SKILLS_SUBTITLE}}': esc(ui.skillsSubtitle ?? ''),
    '{{UI_WORKFLOWS_SUBTITLE}}': esc(ui.workflowsSubtitle ?? ''),
    '{{UI_EXAMPLES_SUBTITLE}}': esc(ui.examplesSubtitle ?? ''),
    '{{UI_SEARCH_AGENTS}}': esc(ui.searchAgents ?? 'Search agents…'),
    '{{UI_SEARCH_SKILLS}}': esc(ui.searchSkills ?? 'Search skills…'),
    '{{UI_SEARCH_WORKFLOWS}}': esc(ui.searchWorkflows ?? 'Search workflows…'),
    '{{UI_SEARCH_EXAMPLES}}': esc(ui.searchExamples ?? 'Search examples…'),
    '{{UI_ARCH_OVERVIEW}}': esc(ui.archOverview ?? 'Architecture Overview'),
    '{{UI_DEV_PIPELINE}}': esc(ui.devPipeline ?? 'Development Pipeline'),
    '{{UI_AGENT_ORCHESTRATION}}': esc(ui.agentOrchestration ?? 'Agent Orchestration'),
    '{{UI_AGENT_COMM_FLOW}}': esc(ui.agentCommFlow ?? 'Agent Communication Flow'),
  };

  // 5. Process each template: read → replace placeholders → write
  const templates = [
    { file: 'index.html', replacements: {} },
    { file: 'agents.html', replacements: agentsReplacements(catalog) },
    { file: 'skills.html', replacements: skillsReplacements(catalog) },
    { file: 'workflows.html', replacements: workflowsReplacements(catalog) },
    { file: 'examples.html', replacements: examplesReplacements(catalog) },
  ];

  for (const { file, replacements } of templates) {
    const templatePath = join(templateDir, file);
    if (!existsSync(templatePath)) continue;

    const raw = readFileSync(templatePath, 'utf8');
    const html = applyReplacements(applyReplacements(raw, uiReplacements), replacements);
    writeFileSync(join(outDir, file), html, 'utf8');
  }
}
