# Agent Input/Output Matrix (bk-agent-contract §4)

| Agent | Required Input | Output |
|-------|----------------|--------|
| bk-researcher | Feature description | requirements.md |
| design-validator | Figma URL | discovery.json, component-contracts.json |
| design-spec-writer | Figma nodeId + slug | design.md (per screen) |
| design-asset-exporter | assets.json (from design.md) | platform asset folders + asset-export-report.json |
| api-integrator | API spec | endpoints.json, models.json |
| bk-{platform}-developer (e.g. bk-ios-developer) | requirements, design, api, spec_index | impl report (md) |
| bk-unit-test-agent | impl report(s), test-cases, spec_index | test-files.json |
| bk-code-reviewer | impl report(s), spec_index | code-review.md |
| security-auditor | impl report(s) | security.md |
