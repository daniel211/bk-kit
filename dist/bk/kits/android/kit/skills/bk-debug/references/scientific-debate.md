# Scientific Debate Pattern — Complex tier (bk-debug)

For bugs classified as **Complex** (multiple possible root causes, unclear reproduction):

**Instead of sequential investigation, use parallel hypothesis testing:**

1. **Generate Hypotheses** (conductor analyzes symptoms)
   - List 2-3 possible root causes based on error evidence
   - Each hypothesis should be testable and falsifiable

2. **Dispatch Hypothesis Agents** (parallel, in ONE message)
   - Agent A: Investigate hypothesis 1 — e.g., "Root cause is threading race condition in X"
   - Agent B: Investigate hypothesis 2 — e.g., "Root cause is state corruption in Y"  
   - Agent C (optional): Investigate hypothesis 3
   
   Each agent's prompt:
   ```
   Task: Investigate hypothesis: "{hypothesis}"
   
   Instructions:
   1. Gather evidence FOR this hypothesis
   2. Gather evidence AGAINST this hypothesis
   3. Rate confidence: high/medium/low
   4. If confidence is high, propose specific fix
   
   Output: bk/dev/shared/reports/debug-hypothesis-{N}-{feature}.md
   
   Format:
   ## Hypothesis: {hypothesis}
   ### Evidence FOR
   - {evidence with file:line}
   ### Evidence AGAINST
   - {evidence with file:line}
   ### Confidence: {high|medium|low}
   ### Proposed Fix (if high confidence)
   - {specific fix with file:line:change}
   ```

3. **Evaluate Results** (conductor synthesizes)
   - Compare evidence from all agents
   - Select hypothesis with strongest evidence
   - If no clear winner, combine insights and run targeted follow-up
   
4. **Dispatch Fix** based on winning hypothesis

> This pattern avoids anchoring bias from sequential investigation.
> Multiple agents actively trying to disprove each other produces higher-quality diagnosis.
> Per Anthropic Claude Deep Dive: "Scientific Debate Pattern — spawn multiple agents with
> different hypotheses and have them actively try to disprove each other."
