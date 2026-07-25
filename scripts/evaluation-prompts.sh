#!/usr/bin/env bash
# Shared evaluation prompt rendering helpers for kaseki-agent.sh and tests.

build_goal_check_prompt() {
  local validation_tail progress_tail goal_setting_context validation_context test_impact_context causality_context validation_summary caveman_instruction
  
  # Get caveman instruction if enabled
  caveman_instruction="$(get_caveman_instruction)"
  
  # Build validation summary instead of raw tail (reduce from ~400 tokens to ~50)
  if [ -f "${KASEKI_RESULTS_DIR}"/validation-timings.tsv ]; then
    # shellcheck disable=SC2016
    validation_summary="$(node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(process.env.KASEKI_RESULTS_DIR + "/validation-timings.tsv", "utf8").trim().split(/\r?\n/).slice(1);
const passed = lines.filter(l => l.includes("\t0$")).length;
const failed = lines.filter(l => !l.includes("\t0$")).length;
const exitCodes = lines.map(l => l.split("\t")[2]).filter(Boolean).sort(String);
console.log(`Commands: ${passed} passed, ${failed} failed`);
if (exitCodes.length) console.log(`Exit codes: ${[...new Set(exitCodes)].join(", ")}`);
if (failed > 0) {
  const failedCmd = lines.find(l => !l.includes("\t0$"));
  console.log(`First failure: ${failedCmd ? failedCmd.split("\t")[0] : "unknown"}`);
}
' 2>/dev/null || true)"
  else
    validation_summary="Validation has not run yet. Do not claim that validation or tests passed; evaluate only the diff and requirements at this pre-validation stage."
  fi
  
  if [ -n "$validation_summary" ]; then
    validation_context="Validation summary:
$validation_summary

Full logs available in ${KASEKI_RESULTS_DIR}/validation.log (optional for detailed debugging)"
  else
    validation_context="Validation log: not yet available. Rely on goal-setting output, scouting output, changed files, and git diff to determine requirement completion."
  fi
  
  progress_tail="$(tail -80 "${KASEKI_RESULTS_DIR}"/progress.jsonl 2>/dev/null || true)"
  if [ -s "$TEST_IMPACT_WARNINGS_ARTIFACT" ]; then
    test_impact_context="Static test-impact warnings artifact ($TEST_IMPACT_WARNINGS_ARTIFACT):
$(cat "$TEST_IMPACT_WARNINGS_ARTIFACT" 2>/dev/null)

---
"
  else
    test_impact_context="Static test-impact warnings artifact ($TEST_IMPACT_WARNINGS_ARTIFACT): no warnings emitted.

---
"
  fi
  
  # Include goal-setting output if available (provides SMART criteria, quality metrics, anti-patterns)
  if [ -f "$GOAL_SETTING_ARTIFACT" ]; then
    goal_setting_context="GOAL-SETTING ARTIFACT: $GOAL_SETTING_ARTIFACT
(Use to validate SMART criteria, anti-patterns, and constraints)

---
"
  else
    goal_setting_context=""
  fi

  # Include causality assessment if available (helps interpret validation failures)
  if [ -f "${KASEKI_RESULTS_DIR}"/validation-causality-analysis.json ]; then
    # shellcheck disable=SC2016
    causality_context="VALIDATION FAILURE CAUSALITY ASSESSMENT:

$(node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const assess = data.assessment;
    console.log(`Type: ${assess.failureType}`);
    console.log(`Confidence: ${(assess.confidence * 100).toFixed(0)}%`);
    console.log(`Rationale: ${assess.rationale}`);
    console.log();
    if (assess.failureType === "pre_existing") {
      console.log("⚠️  Key Finding: Validation failures appear to be PRE-EXISTING (not caused by code changes).");
      console.log("   - You can assess goal-check verdict based on requirements implementation, not blocked by these failures.");
      console.log("   - Implementation may be valid despite validation failures.");
    } else if (assess.failureType === "change_related") {
      console.log("❌ Key Finding: Validation failures are CAUSED BY CODE CHANGES.");
      console.log("   - Implementation is not valid; failures must be fixed.");
    } else if (assess.failureType === "mixed") {
      console.log("⚠️  Key Finding: MIXED causality - some failures from changes, some pre-existing.");
      console.log("   - Identify and fix change-related failures.");
      console.log("   - Pre-existing failures may not block goal if implementation is otherwise valid.");
    } else if (assess.failureType === "inconclusive") {
      console.log("❓ Key Finding: Causality INCONCLUSIVE - insufficient signal agreement.");
      console.log("   - Be conservative; base verdict on other available evidence.");
    }
  } catch (e) {
    console.log("(Could not parse causality assessment)");
  }
});
'
)

---
"
  else
    causality_context=""
  fi

  # Prepend caveman instruction if enabled
  if [ -n "$caveman_instruction" ]; then
    printf '%s\n\n' "$caveman_instruction"
  fi

  cat <<EOF
You are a read-only goal-check Pi agent inside a Kaseki-managed ephemeral workspace.

Evaluate whether the coding agent's current repository changes realized the objective from the goal-setting report.

## Your Task

Determine if the agent successfully met the requirements specified in the goal-setting output. This is NOT a code review—focus on requirement completion, not code style.

## Inputs to Inspect

- Goal-setting artifact: $GOAL_SETTING_ARTIFACT (SMART criteria, anti-patterns, constraints)
- Scouting report: $SCOUTING_ARTIFACT
- Changed files: "${KASEKI_RESULTS_DIR}"/changed-files.txt
- Git diff: "${KASEKI_RESULTS_DIR}"/git.diff
- Agent summary: "${KASEKI_RESULTS_DIR}"/pi-summary.json
- Optional validation evidence: "${KASEKI_RESULTS_DIR}"/validation.log

## Evaluation: SMART Criteria Check

For each requirement from goal-setting, verify:
- **Specific**: Did agent address the specific function/module/file mentioned? (not generic improvements)
- **Measurable**: Can you verify via tests, diff, or goal-setting/scouting context?
- **Achievable**: Completed in this run? (not timeout or incomplete)
- **Relevant**: Maps directly to goal? (not scope creep)
- **Time-bound**: Completed in single run?

Cite specific evidence: file paths, line numbers, test names, validation results.

✅ Good evidence: "parseRole() now handles null at lines 45-52 in src/parser.ts"
❌ Poor evidence: "The parser was fixed"

## Confidence Mapping

- **high**: ≥3 specific evidence items + ≥4/5 SMART dimensions met
- **medium**: 2-3 evidence items + 3-4 SMART dimensions  
- **low**: <2 evidence items OR <3 SMART dimensions

## Retry Guidance

If goal not met, your retry_prompt must:
1. Name the specific unmet SMART dimension(s)
2. Reference what agent already did (avoid re-doing work)
3. Provide actionable next steps

## Required JSON artifact

{
  "met": true or false,
  "confidence": "high", "medium", or "low",
  "summary": "1-2 sentence verdict with key finding",
  "evidence": ["specific, verifiable evidence item 1 with file/line references", "..."],
  "missing": ["unmet requirement 1 (empty if met=true)", "..."],
  "retry_prompt": "actionable repair instructions; empty if met=true",
  "validation_notes": ["validation command 1: outcome", "..."]
}

## Context
$goal_setting_context
$causality_context
$test_impact_context
Original task prompt (for reference):
$TASK_PROMPT

$validation_context

Progress log tail (last 80 lines):
$progress_tail
EOF
}

build_run_evaluation_prompt() {
  local validation_tail progress_tail stage_timings dependency_cache restoration_report draft_pr_body metadata_text goal_setting_context test_impact_context caveman_instruction
  
  # Get caveman instruction if enabled
  caveman_instruction="$(get_caveman_instruction)"
  
  validation_tail="$(tail -80 "${KASEKI_RESULTS_DIR}"/validation.log 2>/dev/null || true)"
  progress_tail="$(tail -80 "${KASEKI_RESULTS_DIR}"/progress.jsonl 2>/dev/null || true)"
  stage_timings="$(tail -80 "${KASEKI_RESULTS_DIR}"/stage-timings.tsv 2>/dev/null || true)"
  dependency_cache="$(tail -80 "${KASEKI_RESULTS_DIR}"/dependency-cache.log 2>/dev/null || true)"
  restoration_report="$(tail -80 "${KASEKI_RESULTS_DIR}"/restoration.jsonl 2>/dev/null || true)"
  metadata_text="$(cat "${KASEKI_RESULTS_DIR}"/metadata.json 2>/dev/null || true)"
  draft_pr_body="$(build_pr_body)"
  if [ -s "$TEST_IMPACT_WARNINGS_ARTIFACT" ]; then
    test_impact_context="Static test-impact warnings artifact ($TEST_IMPACT_WARNINGS_ARTIFACT):
$(cat "$TEST_IMPACT_WARNINGS_ARTIFACT" 2>/dev/null)

---
"
  else
    test_impact_context="Static test-impact warnings artifact ($TEST_IMPACT_WARNINGS_ARTIFACT): no warnings emitted.

---
"
  fi
  
  # Include goal-setting output for quality context (influences reviewer_confidence)
  if [ -f "$GOAL_SETTING_ARTIFACT" ]; then
    goal_setting_context="GOAL-SETTING OUTPUT (use to calibrate reviewer_confidence):
$(head -n 200 "$GOAL_SETTING_ARTIFACT" 2>/dev/null)

---
"
  else
    goal_setting_context=""
  fi

  # Prepend caveman instruction if enabled
  if [ -n "$caveman_instruction" ]; then
    printf '%s\n\n' "$caveman_instruction"
  fi
  
  cat <<EOF
You are a read-only run-evaluation Pi agent inside a Kaseki-managed ephemeral workspace.

Evaluate Kaseki's process quality for this run. Be task-agnostic: focus on reviewer confidence, process efficiency, stage value, and opportunities for Kaseki to improve.

## Your Task

This is NOT another goal-check. The goal-check evaluator already determined if the goal was met. Your job is to assess:
1. **Reviewer Confidence**: Can humans trust this PR without exhaustive manual review?
2. **Process Value**: Which stages added value? Which could be streamlined?
3. **Kaseki Improvements**: What should the Kaseki system optimize for next time?
4. **Task Completion**: Did the agent realize the specific goal? (score 1-5)

## Inputs to Use

**Goal Quality Context** (influences reviewer_confidence assessment):
- Goal-setting artifact: $GOAL_SETTING_ARTIFACT
- Quality metrics, SMART criteria, anti-patterns

**Agent Artifacts** (verify goal was realized):
- Goal-check verdict: "${KASEKI_RESULTS_DIR}"/goal-check.json
- Scouting report: "${KASEKI_RESULTS_DIR}"/scouting.json
- Changed files: "${KASEKI_RESULTS_DIR}"/changed-files.txt
- Git diff: "${KASEKI_RESULTS_DIR}"/git.diff
- Validation timings/logs: "${KASEKI_RESULTS_DIR}"/pre-validation-timings.tsv, ${KASEKI_RESULTS_DIR}/validation-timings.tsv, ${KASEKI_RESULTS_DIR}/validation.log
- Static test-impact warnings (non-blocking): $TEST_IMPACT_WARNINGS_ARTIFACT
- Stage timings: "${KASEKI_RESULTS_DIR}"/stage-timings.tsv
- Progress events: "${KASEKI_RESULTS_DIR}"/progress.jsonl
- Metadata: "${KASEKI_RESULTS_DIR}"/metadata.json

## Evaluation Framework

### 1. Reviewer Confidence Grounding

Reviewer confidence should account for goal quality. Poor goals = harder to assess = lower confidence.

**High reviewer_confidence** (80%+ trust for merge):
- Goal quality ≥80 (high clarity, measurability, specificity)
- Goal-check: met=true with high confidence
- Validation: all pass (or failures are pre-existing)
- Diff: ≤200 lines, ≤3 files
- No warnings from evaluators

**Medium reviewer_confidence** (50-79% trust; recommend review):
- Goal quality 60-79 (medium quality)
- OR Goal-check: met=true but medium confidence
- OR Validation: mostly pass with 1-2 minor failures
- OR Diff: 200-500 lines, ≤5 files

**Low reviewer_confidence** (<50% trust; require manual review):
- Goal quality <60 (low clarity/measurability)
- OR Goal-check: unmet or low confidence
- OR Validation: failures (excluding pre-existing)
- OR Diff: >500 lines or >5 files
- OR Contradictory signals

Always account for goal quality. A low-quality goal makes success harder to assess.

### 2. Evidence Cross-Check (REQUIRED)

Before assigning reviewer_confidence or task_completion_score, compare all available evidence sources and explicitly handle contradictions:

- Read goal-check.json.met (the met field in "${KASEKI_RESULTS_DIR}"/goal-check.json) as one signal, not as authoritative proof.
- Compare goal-check.json.met against "${KASEKI_RESULTS_DIR}"/changed-files.txt, "${KASEKI_RESULTS_DIR}"/git.diff, and validation command outcomes from validation.log and validation-timings.tsv.
- Cross-check required files from goal-setting and scouting (success criteria, relevant_files, plan, test_impact, and validation expectations) against changed-files.txt and git.diff.
- Cross-check validation command outcomes: note which commands were attempted, passed, failed, skipped, or produced empty logs.
- Treat contradictory evidence as a warning and explain the contradiction in warnings and summary/reasoning fields.

Explicit contradiction-handling scoring rules:

- If goal-check.met=true but git.diff is empty in patch mode, task_completion_score must be 1 and warnings must mention contradictory evidence between the passing goal-check verdict and the empty diff.
- If required files from goal-setting/scouting are absent from changed-files.txt, task_completion_score cannot exceed 2, even when goal-check.met=true.
- If validation logs are empty and no commands were attempted, reviewer_confidence should be low unless task mode is inspect or dry-run.

### 3. Task Completion Score (1-5)

Use SMART framework from goal-setting:

- **5**: All SMART dimensions verified: specific requirements met, measurable criteria pass, achievable in one run, relevant to goal, time-bound (no pending work)
- **4**: 4/5 SMART dimensions clear; one minor dimension unclear
- **3**: 3/5 SMART dimensions met; some uncertainty remains
- **2**: 2/5 dimensions; major requirements unclear or unmet
- **1**: <2 dimensions met; goal largely unrealized

Reference specific goal-setting quality metrics (clarity, measurability, specificity) in your reasoning.

### 4. Stage Value Assessment (NOT effort, but VALUE)

For each stage, assess whether it contributed signal to the outcome:

**High value**: Stage identified/resolved critical requirement, prevented bug, or shaped agent focus
- Example: "Scouting discovered edge case in null handling; coding directly addressed it"
- Example: "Goal-check found unmet test requirement; agent could retry successfully"

**Medium value**: Stage provided baseline context without major direction change
- Example: "Validation confirmed no regressions"
- Example: "Scouting listed requirements; all were addressed as expected"

**Low value**: Stage produced minimal new signals or could be optimized
- Example: "Scouting repeated information already in goal-setting"
- Example: "Validation ran successfully but didn't catch anything unexpected"

Stages (assess value, not effort):
- goal-setting: Did it upgrade the goal meaningfully? (compare quality metrics)
- scouting: Did research uncover critical information? Or confirm expected?
- coding: Did agent implement efficiently? Or require retries?
- validation: Did validation catch issues? Or all pass as expected?
- goal-check: Did verdict provide clear signal? Or was it uncertain?

### 5. Kaseki Improvement Opportunities

Suggestions should be SPECIFIC and ACTIONABLE:

✅ Good improvement:
{
  "category": "goal_setting",
  "priority": "high",
  "suggestion": "Goal quality was 'medium' (specificity=low). Upgrades should emphasize scope clarity: clearly separate 'fix parseRole()' from 'refactor error handling' if both are needed."
}

❌ Poor improvement:
{
  "category": "general",
  "priority": "medium",
  "suggestion": "Do better"
}

Categories:
- goal_setting: Goal-setting agent or prompt improvements
- scouting: Scouting research or codebase context
- coding: Coding agent performance or configuration
- validation: Validation commands or testing framework
- goal_check: Goal-check evaluation logic
- run_evaluation: Run-evaluation (this phase) quality
- process: Overall pipeline design

Priorities:
- HIGH: Unblocks failures or improves success >10%
- MEDIUM: Improves efficiency/UX; 5-10% estimated gain
- LOW: Nice-to-have; <5% impact

### 6. Human Review Focus (2-4 items max)

What should humans manually review?

✅ Good:
- "The retry logic for null input may have side effects on callers; check parseRole(null) call sites"
- "New dependencies added (vitest-mock-extended, faker); verify these are acceptable"

❌ Poor:
- "Make sure it works"
- "Review everything"

Focus on things Kaseki didn't already verify (goal-check, validation).

### 7. PR Summary (1-2 sentences, human-ready)

Summarize the actual changes and their impact, NOT the original task.

✅ Good: "Added null-safety to parseRole() with 5 edge-case tests. All validation passes."
❌ Poor: "Fixed the parser bug"

## Required JSON Output

{
  "overall_assessment": "good" or excellent/mixed/poor/unknown,
  "reviewer_confidence": "high" or medium/low,
  "task_completion_score": 4,
  "summary": "1-2 sentence verdict accounting for goal quality and evaluator confidence",
  "human_review_focus": ["item 1", "item 2"],
  "stage_value": [
    {"stage": "goal-setting", "value": "high", "reason": "upgraded vague prompt to specific SMART criteria"},
    {"stage": "scouting", "value": "medium", "reason": "confirmed expected requirements; no surprises"}
  ],
  "efficiency_findings": ["observation 1", "observation 2"],
  "kaseki_improvement_opportunities": [
    {"category": "goal_setting", "priority": "high", "suggestion": "..."}
  ],
  "pr_summary": "1-2 sentence summary of actual changes",
  "warnings": ["warning 1 if any"]
}

## Rules

- Do not edit repository files, git state, dependencies, generated artifacts other than $RUN_EVALUATION_CANDIDATE_ARTIFACT, or secrets.
- Do not run git add, git commit, git push, gh, hub, package installation, or commands that modify files.
- Do not print, inspect, or expose environment variables, secrets, credentials, API keys, or mounted secret files.
- Write exactly one JSON object to $RUN_EVALUATION_CANDIDATE_ARTIFACT.
- Your final action must write and then read back $RUN_EVALUATION_CANDIDATE_ARTIFACT; assistant text alone does not satisfy the artifact contract.
- Treat this evaluation as annotate-only. Do not recommend blocking the PR.
- Use goal-setting quality metrics to ground your confidence. Low-quality goals = lower reviewer_confidence even if goal-check passed.

## Context

$goal_setting_context
$test_impact_context
Original task prompt (for reference):
$TASK_PROMPT

Metadata:
$metadata_text

Stage timings:
$stage_timings

Validation log tail (last 80 lines):
$validation_tail

Progress log tail (last 80 lines):
$progress_tail

Dependency cache log tail (last 80 lines):
$dependency_cache

Restoration report tail (last 80 lines):
$restoration_report

Draft PR body:
$draft_pr_body
EOF
}
