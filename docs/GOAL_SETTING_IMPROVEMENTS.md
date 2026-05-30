# Goal-Setting Agent Improvements (May 2026)

**Status**: All 10 improvements from OpenAI Codex best practices implemented

This document describes the comprehensive enhancements made to the goal-setting agent phase to align with [OpenAI's Codex guidance](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) on using goals in code generation.

---

## Executive Summary

The goal-setting agent now produces **mature, production-ready goals** with 5 critical additions:

| Improvement | Impact | Status |
|---|---|---|
| **Explicit Anti-Patterns** ("do NOT" clauses) | Prevents unintended changes | ✅ Implemented |
| **SMART Criteria Validation** | Ensures success criteria are measurable | ✅ Implemented |
| **Codebase Context** | Preserves architectural conventions | ✅ Implemented |
| **Example-Driven Clarification** | Grounds agent understanding with examples | ✅ Implemented |
| **5-Point Quality Scorecard** | Assesses goal maturity objectively | ✅ Implemented |
| **Constraint Categorization** | Helps agents prioritize safely | ✅ Implemented |
| **Goal-to-Outcome Feedback Loop** | Measures effectiveness over time | ✅ Infrastructure in place |
| **Reasoning Transparency** | Explains upgrade decisions | ✅ Included in output |
| **Iterative Refinement** | Retry mechanism for weak goals | ✅ Implemented |
| **Quality Warnings** | Flags high-risk goals early | ✅ Implemented |

---

## Phase 1: High-Impact Quick Wins (Completed)

### 1. Explicit Anti-Patterns / "Do NOT" Clauses

**Why**: Vague constraints lead to unintended changes. Clear anti-patterns prevent accidents.

**What Changed**:

- **Before**: Flat list of "potential_constraints"
- **After**: Structured `anti_patterns` with three categories:

  ```json
  {
    "do_not_modify": ["src/generated/**", "config/*.json"],
    "do_not_break": ["API contracts", "backward compatibility"],
    "must_preserve": ["error messages", "existing behavior"]
  }
  ```

**Benefit**: Downstream agents can enforce these programmatically (e.g., quality gates reject changes to `do_not_modify` files).

**Example**:

```
❌ Before: "Don't modify generated files"
✅ After: "do_not_modify": ["src/generated/**", "src/codegen/**"]
```

---

### 2. SMART Criteria Validation

**Why**: Weak criteria like "improve code quality" don't tell agents when they're done.

**What Changed**:

- **Before**: Free-form success criteria as strings
- **After**: Validated against SMART framework:
  - **S**pecific: "Fix parseRole() null-handling"
  - **M**easurable: "Add 5 edge-case tests"
  - **A**chievable: "In 1 run, max 3 files"
  - **R**elevant: "Tied to task goal"
  - **T**ime-bound: "Complete in single run"

**New Schema**:

```json
{
  "criterion": "all test cases pass",
  "smart_score": "high",
  "reasoning": "clearly measurable, test results show binary success"
}
```

**Validator Behavior**:

- ✅ Accepts both old format (strings) and new format (SMART objects)
- ⚠️ Warns if >50% of criteria score as "low" SMART quality
- 🚫 Rejects goals with zero success criteria

---

### 3. Codebase Context Preservation

**Why**: Agents make better decisions when aware of tech stack, folder conventions, and patterns.

**What Changed**:

- Goal-setting prompt now explicitly encourages:
  - Tech stack hints from `package.json` (if inferrable)
  - Folder structure patterns (monorepo vs. single-module)
  - Existing conventions (test naming, error message formats)

**Example Output**:

```json
{
  "codebase_signals": {
    "tech_stack": "Node.js + TypeScript + Vitest",
    "structure": "monorepo with src/ and tests/ directories",
    "patterns": [
      "Tests use describe/it pattern",
      "Error messages follow 'action failed: reason' format"
    ]
  }
}
```

---

### 4. Constraint Categorization

**Why**: Different constraint types need different enforcement. Helps agents prioritize.

**What Changed**:

```json
{
  "constraints": {
    "operational": [
      "max 3 files changed",
      "must not require migration"
    ],
    "architectural": [
      "respect service boundaries",
      "no new external dependencies"
    ],
    "technical": [
      "must pass TypeScript checks",
      "no deprecated APIs"
    ],
    "business": [
      "maintain user-facing behavior",
      "no data loss"
    ]
  }
}
```

**Benefit**: Scouting + coding agents can prioritize: architectural constraints first, then technical, then operational.

---

## Phase 2: Medium-Impact Infrastructure

### 5. Example-Based Goal Clarification

**Why**: Concrete examples beat abstract descriptions.

**New Field**:

```json
{
  "examples": {
    "before": "parseRole(null) returned null; tests crash",
    "after": "parseRole(null) returns 'Unnamed Role'; tests pass"
  }
}
```

**Agent Benefit**: Models perform better with "show, don't tell".

---

### 6. Multi-Dimensional Quality Metrics

**Why**: Single confidence score doesn't capture goal health.

**New 5-Point Scorecard**:

```json
{
  "quality_metrics": {
    "clarity": "high",        // Is goal unambiguous?
    "measurability": "high",  // Can agents tell when done?
    "specificity": "medium",  // Is scope well-bounded?
    "scope_clarity": "high",  // Are boundaries clear?
    "constraint_strength": "high"  // Are guardrails testable?
  }
}
```

**Helper Functions** (in `src/types/goal-setting.ts`):

- `calculateGoalQualityScore()` — 0-100 quality score
- `hasQualityWarnings()` — Flags risky goals early

---

## Phase 3: Critical for Long-Term Optimization

### 7. Goal-to-Outcome Feedback Loop

**Why**: Can't optimize without measurement. How do we know upgraded goals help?

**Infrastructure Created** (`src/lib/goal-setting-feedback.ts`):

```typescript
// After each run, collect feedback:
const feedback = collectGoalFeedback(
  instance_name,
  goal_setting_output,
  stage_timings,
  metadata
);

// Store feedback for analysis:
feedback_entries.push(feedback);

// Analyze patterns over time:
const analysis = analyzeGoalFeedback(feedback_entries);
console.log(analysis.recommendations); // e.g., "High-quality goals have 80% vs 50% success"
```

**Metrics Tracked**:

- Goal quality score (0-100)
- SMART quality ("high" vs "low")
- Agent outcomes (scouting, coding, validation success)
- Overall run success rate
- Correlation: Does goal quality predict success?

**Future Capability**:

```
Run 1: High-quality goal → Success
Run 2: Low-quality goal → Failure
Run 3: High-quality goal → Success
... pattern analysis ...
Recommendation: "Focus on goal quality — 80% vs 50% success rate"
```

---

### 8. Reasoning Transparency

**Why**: Agents make better decisions when they understand the upgrade rationale.

**New Field in Output**:

```json
{
  "reasoning": "Original prompt was vague about scope. Upgraded to be specific: 'Fix parseRole()' → 'Handle null/undefined in parseRole() and add test coverage for 5 edge cases'. Anti-patterns added to prevent modifying generated files. Quality metrics show clarity=high, measurability=high, scope_clarity=high."
}
```

---

### 9. Iterative Refinement / Retry Mechanism

**Why**: On rare transient failures, goal-setting should retry and improve.

**Current Behavior** (already in place):

- Max 2 attempts for goal-setting
- Distinguishes transient failures (retry) vs deterministic failures (don't retry)
- Falls back to original prompt if both attempts fail
- Tracks `KASEKI_GOAL_SETTING_ATTEMPTS` and `KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT`

---

### 10. Quality Warnings & Early Detection

**Why**: Flag high-risk goals before they reach downstream agents.

**New Helper** (in `src/types/goal-setting.ts`):

```typescript
const warnings = hasQualityWarnings(goal_setting_output);
// Returns array of warnings like:
// [
//   "Goal clarity is low - may cause agent confusion",
//   "Success criteria not measurable - agent may not know when done",
//   "No explicit anti-patterns defined - recommended for safety"
// ]
```

**Logged To**: `/results/goal-setting-validation-notes.txt`

---

## Integration & Usage

### Updated Output Artifact

File: `/results/goal-setting.json`

**Old Schema** (v1):

```json
{
  "original_prompt": "...",
  "upgraded_goal": "...",
  "key_requirements": [...],
  "success_criteria": [...],
  "potential_constraints": [...],
  "reasoning": "...",
  "confidence": "high"
}
```

**New Schema** (v2):

```json
{
  "original_prompt": "...",
  "upgraded_goal": "...",
  "key_requirements": [...],
  "success_criteria": [
    {
      "criterion": "all tests pass",
      "smart_score": "high",
      "reasoning": "clearly measurable"
    }
  ],
  "anti_patterns": {
    "do_not_modify": ["src/generated/**"],
    "do_not_break": ["API contracts"],
    "must_preserve": ["error messages"]
  },
  "constraints": {
    "operational": [...],
    "architectural": [...],
    "technical": [...],
    "business": [...]
  },
  "examples": {
    "before": "...",
    "after": "..."
  },
  "quality_metrics": {
    "clarity": "high",
    "measurability": "high",
    "specificity": "medium",
    "scope_clarity": "high",
    "constraint_strength": "high"
  },
  "reasoning": "...",
  "confidence": "high"
}
```

### TypeScript Integration

Import and use goal-setting types in your code:

```typescript
import {
  GoalSettingOutput,
  calculateGoalQualityScore,
  hasQualityWarnings,
  SmartCriterion,
  AntiPatterns,
  QualityMetrics,
} from './types/goal-setting';

// Load goal-setting output
const goal: GoalSettingOutput = JSON.parse(
  fs.readFileSync('/results/goal-setting.json', 'utf-8')
);

// Check goal quality
const quality = calculateGoalQualityScore(goal); // 0-100
const warnings = hasQualityWarnings(goal);

if (quality < 50) {
  console.warn('⚠️  Goal quality below 50/100:', warnings);
}

// Use anti-patterns in quality gates
if (goal.anti_patterns?.do_not_modify) {
  validateChangedFilesNotIn(goal.anti_patterns.do_not_modify);
}

// Use constraints in agent guidance
const tech_constraints = goal.constraints?.technical || [];
// Pass to downstream agents for validation
```

---

## Configuration & Environment Variables

Goal-setting configuration (unchanged, but see new options in docs):

```bash
export KASEKI_GOAL_SETTING=1                          # Enable (default)
export KASEKI_GOAL_SETTING_MODEL=openrouter/anthropic/claude-3-opus
export KASEKI_GOAL_SETTING_TIMEOUT_SECONDS=300        # Read-only phase, usually fast
```

---

## Migration & Backward Compatibility

✅ **Fully Backward Compatible**:

- Old `potential_constraints` field still supported (logged as warning)
- Success criteria accept both string and SmartCriterion formats
- Validation non-blocking: missing new fields → warnings, not errors

**Recommendation**: Update code to use new `constraints` schema, but old scripts will still work.

---

## Validation & Testing

### Running Validation

The enhanced validator runs on every goal-setting output:

```bash
# Automatically runs after Pi goal-setting agent completes
# Output: /results/goal-setting-validation-errors.jsonl (errors)
# Output: /results/goal-setting-validation-notes.txt (warnings)
```

### Test Suite

Goal-setting test cases cover:

1. Backward compatibility (old schema still works)
2. SMART criteria detection
3. Anti-pattern enforcement
4. Constraint categorization
5. Quality metric calculation
6. Feedback loop collection & analysis

Located in: `tests/goal-setting.test.ts` (to be added)

---

## Best Practices & Examples

### Writing Better Task Prompts (So Goals Are Better)

**Bad Prompt** ❌:

```
"Fix the parser bug"
```

**Better Prompt** ✅:

```
"Fix parseRole() to safely handle null/undefined values in the FriendlyName field.
It should fall back to 'Unnamed Role' instead of preserving arbitrary non-string values.
Add test coverage for 5 edge cases. All tests must pass.
Do not modify src/generated/ or alter the API schema."
```

**Result**: Better upgraded goal with specific success criteria, clear anti-patterns, and measurable constraints.

---

### Expected Goal Output

For the improved prompt above, expect:

```json
{
  "upgraded_goal": "Implement null-safety in parseRole() for FriendlyName field with fallback to 'Unnamed Role'. Add 5 edge-case tests. Ensure all tests pass and no API schema changes.",
  "success_criteria": [
    {
      "criterion": "parseRole() returns 'Unnamed Role' for null/undefined FriendlyName",
      "smart_score": "high"
    },
    {
      "criterion": "5 edge-case tests added and passing",
      "smart_score": "high"
    },
    {
      "criterion": "no TypeScript errors",
      "smart_score": "high"
    }
  ],
  "anti_patterns": {
    "do_not_modify": ["src/generated/**"],
    "do_not_break": ["API schema", "function signature"]
  },
  "quality_metrics": {
    "clarity": "high",
    "measurability": "high",
    "specificity": "high",
    "scope_clarity": "high",
    "constraint_strength": "high"
  }
}
```

---

## Next Steps & Future Enhancements

1. **Feedback Loop Dashboard**: Visualize goal quality → success correlation over time
2. **Adaptive Model Selection**: Use feedback to pick best goal-setting model
3. **Goal Template Library**: Pre-built patterns for common task types
4. **Interactive Goal Builder**: UI to refine weak goals before sending to agents
5. **A/B Testing**: Compare old vs new goal schemas on production runs

---

## Troubleshooting

### Goal quality is low?

1. Check `/results/goal-setting-validation-notes.txt` for specific warnings
2. Review `/results/goal-setting.json` quality_metrics
3. Use helper function: `hasQualityWarnings(goal)` to get actionable list
4. Improve input prompt clarity

### Agent still making unintended changes?

1. Check anti_patterns: are `do_not_modify` files being enforced?
2. Ensure quality gate validates changed files against allowlist
3. Review constraints: are they being passed to coding agents?

### Goal-setting agent failed?

1. Check `/results/goal-setting-stderr.log`
2. Review `/results/goal-setting-validation-errors.jsonl`
3. Check KASEKI_GOAL_SETTING_TIMEOUT_SECONDS (default 300s)
4. Run with KASEKI_DEBUG_RAW_EVENTS=1 for full event stream

---

## References

- [OpenAI Codex Best Practices](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)
- [Goal-Setting Guide](./GOAL_SETTING_GUIDE.md)
- [TypeScript Types](../src/types/goal-setting.ts)
- [Feedback Loop Implementation](../src/lib/goal-setting-feedback.ts)
