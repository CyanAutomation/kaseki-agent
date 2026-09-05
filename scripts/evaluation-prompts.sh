#!/usr/bin/env bash
# Shared evaluation prompt rendering helpers for kaseki-agent.sh and tests.

build_goal_check_prompt() {
  local progress_summary goal_setting_context validation_context test_impact_context causality_context validation_summary caveman_instruction
  
  if declare -F construct_context_handoff >/dev/null; then
    construct_context_handoff "coding" "Return a schema-valid goal-check verdict supported by changed files and validation outcomes."
  fi
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
  
  progress_summary="$(node - "${KASEKI_RESULTS_DIR}/progress.jsonl" <<'NODE' 2>/dev/null || true
const fs=require('fs'); const file=process.argv[2]; let rows=[];
try { rows=fs.readFileSync(file,'utf8').trim().split(/\r?\n/).map(x=>JSON.parse(x)); } catch {}
const text=x=>String(x.message||x.detail||x.status||x.event||'').replace(/\s+/g,' ').trim();
const unique=a=>[...new Set(a.filter(Boolean))].sort();
const actions=unique(rows.map(x=>`${x.stage||x.phase||'unknown'}: ${text(x)}`));
const failures=actions.filter(x=>/fail|error|exit [1-9]/i.test(x));
const evidence=actions.filter(x=>/pass|complete|finished|wrote|met/i.test(x));
console.log(JSON.stringify({unique_tool_actions:actions.slice(0,40),failures:failures.slice(0,20),completion_evidence:evidence.slice(0,20)}));
NODE
)"
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

  # Use compressed instructions if caveman level >= 2
  local compressed_instructions=""
  if [ "${KASEKI_CAVEMAN_LEVEL:-1}" -ge 2 ]; then
    compressed_instructions="$(get_caveman_compressed_prompt goal-check 2>/dev/null || true)"
  fi

  if [ -n "$compressed_instructions" ]; then
    # Compressed version (caveman level 2+)
    cat <<EOF
$compressed_instructions

## Context
$goal_setting_context
$causality_context
$test_impact_context
Canonical input contract: ${KASEKI_RESULTS_DIR}/context-handoff.json (read first). Read a raw artifact only to answer a named unresolved_questions item.

$validation_context

Deterministic progress summary:
$progress_summary

Return exactly one JSON object matching the schema below as your final assistant message. Do not write files, use markdown/code fences, or add prose; Kaseki validates and persists the verdict itself.
Required structured evidence fields: "evidence_sources_inspected": string[], "contradictions": {"sources":string[],"description":string}[], and "confidence_calibration": {"outcome":string,"justification":string}.
EOF
  else
    # Verbose version (caveman level 0-1)
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

## Bounded evidence collection

The output target is advisory, not a completion limit. Preserve room for the
verdict: inspect the goal-setting and scouting artifacts first, then
changed-files and validation summary. Do not read the full git diff or lengthy
logs; if needed, read a bounded diff slice (at most 120 lines). Return the
required JSON as soon as you have enough evidence and never spend your final
turn on another tool call.

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

Return exactly one JSON object as the final assistant message. Do not write a file, use markdown/code fences, or include prose before/after the JSON. Kaseki validates and persists this response.

{
  "met": true or false,
  "confidence": "high", "medium", or "low",
  "summary": "1-2 sentence verdict with key finding",
  "evidence": ["specific, verifiable evidence item 1 with file/line references", "..."],
  "missing": ["unmet requirement 1 (empty if met=true)", "..."],
  "retry_prompt": "actionable repair instructions; empty if met=true",
  "validation_notes": ["validation command 1: outcome", "..."],
  "evidence_sources_inspected": ["goal-setting.json", "scouting.json", "changed-files.txt", "git.diff", "validation.log"],
  "contradictions": [{"sources": ["goal-check verdict", "git.diff"], "description": "description of conflict"}],
  "confidence_calibration": {"outcome": "met", "justification": "why the confidence matches the objective evidence"}
}

## Context
$goal_setting_context
$causality_context
$test_impact_context
Canonical input contract: ${KASEKI_RESULTS_DIR}/context-handoff.json (read first). Read a raw artifact only to answer a named unresolved_questions item.

$validation_context

Deterministic progress summary:
$progress_summary
EOF
  fi
}

build_run_evaluation_prompt() {
  local validation_tail progress_tail stage_timings dependency_cache restoration_report draft_pr_body metadata_text goal_setting_context test_impact_context caveman_instruction repository_default_branch repository_facts
  
  if declare -F construct_context_handoff >/dev/null; then
    construct_context_handoff "validation" "Return the schema-valid run evaluation and process-quality scorecard."
  fi
  # Canonical handoff replaces copied raw tails. The evaluator may inspect the
  # bounded set of evidence named by artifact_paths for its required cross-checks.
  validation_tail=""
  progress_tail=""
  stage_timings=""
  dependency_cache=""
  restoration_report=""
  metadata_text=""
  draft_pr_body=""
  goal_setting_context="Canonical input contract: ${KASEKI_RESULTS_DIR}/context-handoff.json (read first). For the required process-evidence cross-checks, inspect only files listed in artifact_paths; inspect any other raw artifact only for a named unresolved question."
  test_impact_context=""
  repository_default_branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
  repository_default_branch="${repository_default_branch:-${GIT_REF:-main}}"
  repository_facts="Repository facts detected from this checkout: requested ref=${GIT_REF:-main}; default branch=${repository_default_branch}. Do not flag the configured default branch as uncertain unless this evidence conflicts with an inspected repository artifact."
  # Get caveman instruction if enabled
  caveman_instruction="$(get_caveman_instruction)"
  

  # Prepend caveman instruction if enabled
  if [ -n "$caveman_instruction" ]; then
    printf '%s\n\n' "$caveman_instruction"
  fi
  
  # Use compressed instructions if caveman level >= 2
  local compressed_instructions=""
  if [ "${KASEKI_CAVEMAN_LEVEL:-1}" -ge 2 ]; then
    compressed_instructions="$(get_caveman_compressed_prompt run-eval 2>/dev/null || true)"
  fi

  if [ -n "$compressed_instructions" ]; then
    # Compressed version (caveman level 2+)
    cat <<EOF
$compressed_instructions

In addition to stage_value reasons, return evidence_sources_inspected, contradictions, confidence_calibration, and phase_scorecard using the structured contract in the verbose prompt. Record actually inspected sources and prefer machine-readable counts and ratios.

## Context
$goal_setting_context
$test_impact_context
$repository_facts
Original task prompt:
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
  else
    # Verbose version (caveman level 0-1) - keeping existing full instructions
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

**Repository facts**
$repository_facts

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
- Record only evidence sources you actually opened in evidence_sources_inspected. Do not infer inspection from availability.
- List every conflict among verdict, diff, changed files, and validation in contradictions; use an empty array only after checking all four.

Explicit contradiction-handling scoring rules:

- If goal-check.met=true but git.diff is empty in patch mode, task_completion_score must be 1 and warnings must mention contradictory evidence between the passing goal-check verdict and the empty diff.
- If required files from goal-setting/scouting are absent from changed-files.txt, task_completion_score cannot exceed 2, even when goal-check.met=true.
- If validation logs are empty and no commands were attempted, reviewer_confidence should be low unless task mode is inspect or dry-run.
- High reviewer confidence without validation evidence is capped at medium. A passing verdict with an empty patch-mode diff is capped at task_completion_score=1; missing required files caps it at 2.

### 2a. Phase Scorecard Evidence

Populate structured phase_scorecard alongside the human-readable stage_value reasons. Prefer counts, file intersections, timings, retries, and token usage from artifacts over evaluator impressions.

- goal-setting: compare the original task to goal-setting.json; record quality uplift, measurable success-criteria completeness, and scope precision.
- scouting: record schema validity; relevant-file precision/recall against changed-files.txt; whether risks, edge cases, and validation expectations were addressed in git.diff or validation; retry count, elapsed time, token usage; and unique information beyond goal-setting.
- goal-check and run-evaluation: record required/actually inspected sources, contradictions, schema validity, retry count, confidence calibration against the final objective outcome, evaluator elapsed time, and token usage.

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
  "evidence_sources_inspected": ["goal-check.json", "changed-files.txt", "git.diff", "validation.log", "validation-timings.tsv"],
  "contradictions": [{"sources": ["goal-check.json", "git.diff"], "description": "passing verdict conflicts with empty patch"}],
  "confidence_calibration": {"objective_outcome": "met", "calibrated": true, "reason": "confidence is supported by diff and validation"},
  "phase_scorecard": {
    "goal-setting": {"quality_uplift": 0.25, "success_criteria_completeness": 1.0, "scope_precision": 0.9},
    "scouting": {"schema_valid": true, "relevant_file_precision": 1.0, "relevant_file_recall": 0.75, "identified_items": 4, "addressed_items": 3, "retry_count": 0, "elapsed_seconds": 12, "token_usage": 1400, "unique_beyond_goal_setting": true},
    "goal-check": {"required_sources": ["goal-setting.json", "scouting.json", "changed-files.txt", "git.diff"], "inspected_sources": ["goal-setting.json", "scouting.json", "changed-files.txt", "git.diff"], "schema_valid": true, "retry_count": 0, "elapsed_seconds": 8, "token_usage": 900},
    "run-evaluation": {"required_sources": ["goal-check.json", "changed-files.txt", "git.diff", "validation.log"], "inspected_sources": ["goal-check.json", "changed-files.txt", "git.diff", "validation.log"], "schema_valid": true, "retry_count": 0, "elapsed_seconds": 6, "token_usage": 700}
  },
  "efficiency_findings": ["observation 1", "observation 2"],
  "kaseki_improvement_opportunities": [
    {"category": "goal_setting", "priority": "high", "suggestion": "..."}
  ],
  "pr_summary": "1-2 sentence summary of actual changes",
  "warnings": ["warning 1 if any"]
}

## Rules

- Do not edit repository files, git state, dependencies, generated artifacts, or secrets.
- Do not run git add, git commit, git push, gh, hub, package installation, or commands that modify files.
- Do not print, inspect, or expose environment variables, secrets, credentials, API keys, or mounted secret files.
- Return exactly one JSON object as your final assistant message. Do not write files, use markdown/code fences, or add prose; Kaseki validates and persists the response.
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
  fi
}
