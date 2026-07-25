/**
 * caveman-prompts.ts
 *
 * Caveman-compressed prompt templates for kaseki-agent.
 * Reduces token usage by 30-50% while preserving semantic content.
 *
 * Compression techniques:
 * - Drop articles (a/an/the), filler, pleasantries
 * - Use short synonyms (big not extensive, fix not implement)
 * - Keep full sentences but terse
 * - Preserve exact technical terms
 * - Pattern: [thing] [action] [reason]
 */

/**
 * Compressed operational guardrails for coding phase.
 * Original: ~400 tokens. Target: ~150-200 tokens (50% reduction).
 */
export function compressGuardrails(): string {
  return `Kaseki-managed ephemeral workspace guardrails:

No git add/commit/push/PR creation. Kaseki owns VCS after validation.
No npm install/ci/yarn/pnpm. Kaseki owns deps and validation.
Primary code change first before tests/refactor/cleanup. Scouting + goal-setting artifacts define primary work.

Complete primary work fully. Don't leave TODOs or partial work. Validation runs after you finish.

Tool calls: one operation per call. Chain sequential calls. Test after big changes.

File editing: Read before edit. Verify paths exist. Use relative paths from repo root.

Memory: Read repo memory for codebase patterns. Write important decisions to repo memory for next runs.

Quality: lint/type-check pass. Tests cover changes. Comments explain why, not what.`;
}

/**
 * Compressed goal-check evaluation instructions.
 * Original: ~600-800 tokens. Target: ~300-400 tokens (50% reduction).
 */
export function compressGoalCheckInstructions(): string {
  return `Read-only goal-check agent. Determine if coding agent met goal-setting requirements.

Evaluate SMART criteria (not code style):
- Specific: Addressed exact function/module/file from goal?
- Measurable: Verified via tests, diff, or goal-setting context?
- Achievable: Completed in this run (not timeout/incomplete)?
- Relevant: Maps to goal (not scope creep)?
- Time-bound: Finished in single run?

Cite specific evidence: file paths, line numbers, test names, validation results.
✅ Good: "parseRole() handles null at lines 45-52 in src/parser.ts"
❌ Poor: "Parser was fixed"

Confidence levels:
- high: ≥3 evidence items + ≥4/5 SMART dimensions met
- medium: 2-3 evidence + 3-4 SMART dimensions
- low: <2 evidence OR <3 SMART dimensions

Validation causality (if available): Pre-existing failures don't block goal if implementation is valid. Change-related failures do block.

Inputs to inspect:
- Goal-setting artifact (SMART criteria, constraints)
- Scouting report
- Changed files list
- Git diff
- Agent summary (pi-summary.json)
- Validation log (optional, for details)

Focus: requirement completion, not code review.`;
}

/**
 * Compressed run-evaluation instructions.
 * Original: ~500-700 tokens. Target: ~250-350 tokens (50% reduction).
 */
export function compressRunEvalInstructions(): string {
  return `Read-only run-evaluation agent. Assess entire kaseki run for quality and completion.

Evaluate:
1. Goal completion (compare goal-setting artifact to git diff)
2. Validation results (pass/fail, exit codes, test coverage)
3. Code quality (lint, types, test completeness)
4. Agent behavior (stuck, timeout, scope creep)
5. Artifact quality (metadata, changed files allowlist compliance)

Test-impact warnings: Check if parser/output/naming changes broke existing tests. Agent should have updated tests if warnings present.

Validation causality: Pre-existing failures vs. change-related failures (causality analysis artifact if available).

Restoration report: If many files restored before validation, may indicate scope creep or allowlist too loose.

Inputs:
- Goal-setting artifact
- Metadata (phases, timings, exit codes)
- Validation logs + timings
- Git diff + changed files
- Stage timings
- Pi summary (agent behavior)
- Dependency cache log (optional)
- Restoration report (if present)

Output: Assessment with evidence (file paths, line numbers, metrics). Verdict: success, partial, or failed. Recommendations for next run.`;
}

/**
 * Get caveman-compressed prompt based on level.
 * @param level - Caveman compression level (0=off, 1=output-only, 2=medium, 3=aggressive)
 * @param type - Prompt type (guardrails, goal-check, run-eval)
 * @returns Compressed prompt string or empty if level < 2
 */
export function getCavemanPrompt(
  level: number,
  type: 'guardrails' | 'goal-check' | 'run-eval'
): string {
  if (level < 2) {
    return ''; // Level 0-1: No compression or output-only (not input compression)
  }

  switch (type) {
  case 'guardrails':
    return compressGuardrails();
  case 'goal-check':
    return compressGoalCheckInstructions();
  case 'run-eval':
    return compressRunEvalInstructions();
  default:
    return '';
  }
}
