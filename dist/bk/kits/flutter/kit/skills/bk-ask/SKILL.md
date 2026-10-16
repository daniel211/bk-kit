---
name: bk-ask
description: "Answer technical and architectural questions about mobile development with expert consultation."
user-invocable: true
argument-hint: "[technical-question]"
---

# Technical Consultation: $ARGUMENTS

Answer technical question or architecture challenge in mobile development context.
Read-only consultation — no code changes.

<Use_When>
- User asks a technical or architectural question about mobile dev
- User says "how should I", "what's the best approach", "explain", "compare"
- Architecture decisions: state management, navigation, networking, storage, DI
- Platform-specific questions: iOS/Android/cross-platform tradeoffs
- Performance, security, or scalability concerns
</Use_When>

<Do_Not_Use_When>
- Implementation needed — use /bk-code
- Bug fix — use /bk-debug
- Planning a feature — use /bk-plan
- Code review — use /bk-review
</Do_Not_Use_When>

## CRITICAL ENFORCEMENT

- Step 2 (Research) **MUST** Task(bk-researcher) background when question needs codebase context — DO NOT research yourself
- Quick questions: may skip researcher (exception)
- If Architecture/Platform/Security question with 0 Task() calls → INCOMPLETE

## Foundation Context

Load project context before answering:
1. Check `bk/docs/foundation/overview.md` — project platform, architecture, patterns
2. Check `bk/docs/foundation/dependencies.md` — current tech stack
3. Check `bk/docs/foundation/conventions.md` — code conventions in use
4. If foundation missing → answer generically, note assumptions

## Process

### Step 1: Classify Question

| Type | Indicators | Approach |
|------|-----------|----------|
| **Architecture** | "how to structure", "pattern", "design", DI, modules | Full consultation with all 4 advisors |
| **Platform** | "iOS vs Android", "SwiftUI vs UIKit", "Compose vs XML" | Platform-specific comparison |
| **Performance** | "optimize", "memory", "battery", "frame rate" | Profiling-focused, measurable advice |
| **Security** | "auth", "encryption", "keychain", "certificate pinning" | Security-first, OWASP Mobile Top 10 |
| **Quick** | Clear, narrow question with obvious answer | Direct answer, skip full consultation |

### Step 2: Research (if needed)

For Architecture/Platform/Security questions:
- Scout codebase with Explore agents to understand current patterns
- Check `bk/docs/foundation/` for existing decisions
- If question involves unfamiliar tech → dispatch researcher agent (background)

### Background Research (if question needs codebase context)

```
Task(subagent_type: "bk-researcher", run_in_background: true,
  description: "Research context for question", prompt: "
  Gather context for question: {user_question}
  Search codebase for relevant patterns, files, recent changes.
  Output: bk/dev/shared/research/ask-context.md (max 100 lines)
")
```

Continue formulating answer while researcher runs in background.
Incorporate researcher findings when available.

### Step 3: Expert Consultation

Four specialized advisors evaluate the question:

1. **Mobile Architect** — system boundaries, module structure, data flow, navigation graph
2. **Platform Specialist** — platform-specific APIs, OS constraints, native vs shared code decisions
3. **Performance Engineer** — memory, threading, rendering pipeline, battery impact
4. **Risk Analyst** — tradeoffs, migration cost, breaking changes, vendor lock-in

**Quick type:** Skip this step, answer directly.

### Step 4: Synthesize Answer

## Output Format

**Be honest, be brutal, straight to the point, and be concise.**

### Quick Questions
Direct answer in 1-3 paragraphs. Code snippet if helpful.

### Architecture/Platform/Security Questions

1. **Context** — what the project currently uses (from foundation docs)
2. **Analysis** — breakdown of the challenge with mobile-specific considerations
3. **Recommendation** — concrete choice with rationale, not "it depends"
4. **Alternatives** — other options with pros/cons (table format)
5. **Risks** — what could go wrong, migration concerns
6. **Next Steps** — what to do next (e.g., "run `/bk-plan` to plan implementation")

## Constraints

- DO NOT implement code — consultation only
- DO NOT create plans — suggest `/bk-plan` if implementation needed
- Always ground advice in project's current architecture (from foundation docs)
- Prefer battle-tested patterns over novel approaches
- YAGNI / KISS / DRY — every recommendation must honor these
- If question is ambiguous → ask clarifying question via `AskUserQuestion` before answering
