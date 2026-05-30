# Feedback Loop Integration for Kaseki-Agent Evaluations

This document explains how evaluation verdicts feed back into the goal-setting quality scoring and Kaseki process improvement systems, closing the feedback loops that enable continuous optimization.

---

## Overview

Kaseki runs follow this cycle:

```
Goal-Setting (produces quality metrics, SMART scores, anti-patterns)
    ↓
Scouting (researches requirements)
    ↓
Coding Loop (agent makes changes)
    ↓
Validation (runs test/build/lint commands)
    ↓
Goal-Check (evaluates if goal was met)
    ├─→ [Feedback Path 1: Goal Quality Scoring]
    │
Run-Evaluation (assesses process quality)
    ├─→ [Feedback Path 2: Kaseki Improvements]
    │
GitHub Operations (creates PR, posts review)
```

**Feedback Path 1** uses goal-check verdicts to refine goal-setting quality scoring.  
**Feedback Path 2** uses run-evaluation insights to improve Kaseki infrastructure and processes.

---

## Feedback Path 1: Goal Quality Scoring

### What Gets Collected?

After goal-check completes, collect a feedback entry:

```json
{
  "instance_name": "kaseki-42",
  "goal_setting_output": {
    "goal": "Handle null values in parseRole() and add 5 edge-case tests",
    "quality_metrics": {
      "clarity": "high",
      "measurability": "high",
      "specificity": "medium",
      "scope_clarity": "high",
      "constraint_strength": "high"
    },
    "quality_score": 88,
    "smart_criteria": [
      { "criterion": "parseRole(null) returns 'Unnamed Role'", "smart_score": "high" },
      { "criterion": "5 edge-case tests for null/undefined/empty/long/special-char inputs", "smart_score": "high" }
    ]
  },
  "goal_check_verdict": {
    "met": true,
    "confidence": "high",
    "evidence_count": 4
  },
  "outcome": {
    "validation_passed": true,
    "coding_attempts": 1,
    "success": true
  },
  "correlation": {
    "goal_quality": 88,
    "outcome_success": true,
    "correlation_signal": "high-quality goal succeeded on first attempt"
  }
}
```

### How Is Feedback Analyzed?

Over time, patterns emerge:

| Goal Quality | Success Rate (Target: 80%+) | Insights |
|---|---|---|
| ≥85 ("high") | 87% | Well-formed goals succeed most of the time |
| 70-84 ("medium") | 62% | Medium-quality goals need refinement or retries |
| <70 ("low") | 31% | Low-quality goals are unreliable; users should invest in goal-setting |

### Feedback Loop Actions

The `analyzeGoalFeedback()` function produces recommendations:

```
Input: 50 runs with goal quality scores and outcomes
  ↓
Correlation analysis: Does goal quality predict success?
  ↓
Output recommendations:
  • "High-quality goals (≥85) have 87% success vs 31% for low-quality (<70)"
  • "Measurability dimension drives 65% of variance; focus here first"
  • "Scope_clarity has weak signal; may be redundant with specificity"
```

### Who Acts On This Feedback?

1. **Users**: "My goals with clarity='high' succeeded 90% of the time. I should always aim for this."
2. **Kaseki Maintainers**: "The measurability dimension predicts success; let's enhance goal-setting to emphasize this."
3. **System Monitoring**: Auto-alert if success rate drops below 50% for high-quality goals (indicates agent/environment degradation).

---

## Feedback Path 2: Kaseki Improvement Opportunities

### What Gets Collected?

Run-evaluation produces specific suggestions in `kaseki_improvement_opportunities`:

```json
{
  "category": "goal_setting",
  "priority": "high",
  "suggestion": "This goal had clarity='high' but specificity='medium'. Next goals should separate 'fix parseRole()' (specific) from 'improve error handling' (vague) into distinct goals."
}
```

### Categorization

Improvements are categorized by which stage they affect:

| Category | Affects | Examples |
|---|---|---|
| `goal_setting` | Goal-setting agent & prompt | "Goals need clearer scope boundaries" |
| `scouting` | Scouting agent & codebase context | "Scouting should list test file locations explicitly" |
| `coding` | Coding agent performance | "Agent timed out; consider longer timeout or split goal" |
| `validation` | Validation commands | "New command type Y would catch this error class" |
| `goal_check` | Goal-check evaluation | "Goal-check needs examples from goal-setting" |
| `run_evaluation` | Run-evaluation quality | "Confidence calibration seems off; review thresholds" |
| `process` | Overall pipeline | "Dependency caching misses; consider longer TTL" |

### How Are Improvements Prioritized?

Each suggestion includes `priority: high|medium|low`:

- **High**: Unblocks failures or improves success rate >10%
- **Medium**: Improves efficiency or UX; estimated 5-10% gain
- **Low**: Nice-to-have; <5% estimated impact

### Actions on Feedback

| Improvement | Who Acts | How | Frequency |
|---|---|---|---|
| "Goal-setting should emphasize scope clarity" | Prompt writer | Update goal-setting prompt template | Per-release |
| "Scouting misses dependency graph" | Maintainer | Enhance scouting context generation | Per-release |
| "Validation command npm run typecheck catches 40% of errors" | Admin | Add to default `KASEKI_VALIDATION_COMMANDS` | Per-environment |
| "Agent timeout too short for monorepos" | Admin | Increase `KASEKI_AGENT_TIMEOUT_SECONDS` | Per-deployment |

---

## Integration Points

### Where Feedback Is Collected

1. **In kaseki-agent.sh** (after goal-check phase):

   ```bash
   # Pseudocode
   if goal_check_passed; then
     collect_goal_feedback "$instance_name" "$goal_setting_output" "$goal_check_verdict" "$outcome_metrics"
   fi
   ```

2. **In kaseki-agent.sh** (after run-evaluation phase):

   ```bash
   # Pseudocode
   if run_evaluation_passed; then
     collect_kaseki_improvements "$instance_name" "$run_evaluation_artifact"
   fi
   ```

3. **Stored in** [src/lib/goal-setting-feedback.ts](../src/lib/goal-setting-feedback.ts):

   ```typescript
   type GoalFeedbackEntry = {
     instance_name: string;
     goal_setting_output: GoalSettingOutput;
     goal_check_verdict: GoalCheckArtifact;
     outcome: RunOutcome;
     correlation: CorrelationSignal;
   };
   ```

### Where Feedback Is Analyzed

1. **Analysis script**: [scripts/analyze-goal-feedback.js](../scripts/analyze-goal-feedback.js) (created Phase 3)
   - Aggregates feedback from multiple runs
   - Computes correlations
   - Generates recommendations report

2. **Continuous monitoring** (future):
   - Dashboard showing goal quality → success rate correlation
   - Alert on anomalies (e.g., high-quality goals suddenly failing)
   - Trending: Is overall goal quality improving month-over-month?

---

## Concrete Examples

### Example 1: Goal Quality Feedback Loop

**Scenario**: User runs 10 kaseki instances with varying goal quality scores.

**Feedback collected**:

```
Run 1: goal_quality=92 → outcome=success (goal-check: met=true, high confidence)
Run 2: goal_quality=45 → outcome=failed (goal-check: met=false)
Run 3: goal_quality=88 → outcome=success
Run 4: goal_quality=38 → outcome=failed
Run 5: goal_quality=91 → outcome=success
...
```

**Analysis**:

```
Goals ≥85: 4/4 succeeded (100%)
Goals 60-84: 2/3 succeeded (67%)
Goals <60: 0/3 succeeded (0%)

Recommendation: "Goal quality is the primary predictor of success. 
Improving from low (40) to high (85) quality increases success rate from 0% to 100%."
```

**User Action**: "I need to invest in goal-setting. Let me ensure all my prompts have clarity='high' and measurability='high'."

---

### Example 2: Kaseki Improvement Feedback Loop

**Scenario**: Run-evaluation observes a pattern across 5 runs.

**Improvements identified**:

```
Run 42: "Scouting could identify critical files earlier (edge-case in parseRole). Categorize requirements by impact."
Run 44: "Similar issue: scouting identified requirement but didn't prioritize it."
Run 45: "Again: scouting has all info but doesn't suggest focus areas."
Run 47: "Scouting architecture section is too brief; agents miss monorepo implications."
Run 49: "Another scouting miss: performance implications not flagged."
```

**Analysis**:

```
Pattern detected: Scouting lacks prioritization/impact signals.

Suggestion: Enhance scouting-prompt to include:
1. "Rank requirements by impact: critical, important, nice-to-have"
2. "Call out performance/architecture implications explicitly"
3. "Suggest focus areas for coding agent"

Priority: HIGH
Estimated impact: +20% success rate for complex goals
```

**Action**: Maintainer updates scouting prompt and re-runs 20 test cases. If success rate improves, commit the change.

---

## Data Schema

### GoalFeedbackEntry (Phase 3 Implementation)

```typescript
interface GoalFeedbackEntry {
  // Identifiers
  instance_name: string;
  timestamp: string;
  git_ref: string;
  repo_url: string;

  // Input: Goal-Setting Output
  goal_setting_output: {
    goal: string;
    quality_metrics: {
      clarity: "low" | "medium" | "high";
      measurability: "low" | "medium" | "high";
      specificity: "low" | "medium" | "high";
      scope_clarity: "low" | "medium" | "high";
      constraint_strength: "low" | "medium" | "high";
    };
    quality_score: number; // 0-100
    smart_criteria: Array<{
      criterion: string;
      smart_score: "low" | "medium" | "high";
    }>;
  };

  // Evaluation Result
  goal_check_verdict: {
    met: boolean;
    confidence: "low" | "medium" | "high";
    summary: string;
    evidence_count: number;
    missing_items_count: number;
  };

  // Outcome Metrics
  outcome: {
    validation_passed: boolean;
    coding_attempts: number;
    total_duration_seconds: number;
    diff_lines: number;
    success: boolean; // Overall: goal-check met + validation passed
  };

  // Computed Correlation
  correlation: {
    goal_quality: number;
    outcome_success: boolean;
    confidence_match: boolean; // Did evaluator's confidence align with outcome?
    signal_strength: "strong" | "weak";
    recommendation?: string;
  };
}
```

---

## Feedback Loop Best Practices

### 1. **Separate Goal Feedback from Kaseki Feedback**

- ✅ Do: Goal-check failures → analyze goal quality
- ✅ Do: Run-evaluation suggestions → analyze process/infrastructure
- ❌ Don't: Mix them (goal quality ≠ kaseki process quality)

### 2. **Aggregate Before Acting**

- ✅ Do: Collect 20+ runs before changing goal-setting prompt
- ✅ Do: Look for patterns across multiple suggestions before major refactor
- ❌ Don't: React to single run (noise vs. signal)

### 3. **Validate Changes**

After implementing an improvement:

- [ ] Run 10 test cases with new approach
- [ ] Compare success rate before/after
- [ ] Did success rate improve as predicted?
- [ ] Did it introduce new issues?

### 4. **Document Feedback Actions**

When you act on feedback, note:

```
Date: 2026-06-01
Feedback Signal: "Scouting misses dependency-graph context in 4/20 runs"
Action Taken: Enhanced scouting prompt with "Identify key dependencies"
Result: Success rate improved from 65% → 82%
Status: ✅ Committed to main
```

---

## Monitoring & Dashboards (Future Capability)

```
┌─ Goal Quality → Success Rate Dashboard
├─ Show: Goal quality (0-100) vs outcome (pass/fail)
├─ Display: Trend line, confidence intervals, suggestions
│
├─ Kaseki Improvement Suggestions Tracker
├─ Show: Open suggestions, priority, implementation status
│
├─ Evaluation Confidence Calibration
├─ Show: Evaluator predictions vs outcomes (confusion matrix)
│
└─ Feedback Loop Health
  ├─ Are improvements being acted on?
  ├─ Are they having predicted impact?
  └─ Feedback loop latency (days from suggestion to action)
```

---

## Summary

Feedback loops close the learning cycle:

1. **Goal Quality Feedback**: Goal-check verdicts inform goal-setting quality scoring. Users/maintainers learn what goal characteristics predict success.

2. **Kaseki Improvement Feedback**: Run-evaluation insights drive infrastructure improvements. Pipeline gets better over time.

3. **Virtuous Cycle**: Better goals → better goal-check inputs → better outcomes → better suggestions → better kaseki infrastructure → better coding agent success

This document enables teams to close these loops deliberately and measure their impact.
