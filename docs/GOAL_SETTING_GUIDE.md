# Goal-Setting Agent: Comprehensive Guide

**Status**: All 10 improvements from OpenAI Codex best practices implemented (May 2026)

The goal-setting agent is the first stage in the Kaseki pipeline. It takes a user's raw task prompt and upgrades it into a mature, specific goal that sets expectations for downstream scouting and coding agents.

**Default Behavior**: Goal-setting is **enabled by default**. To disable it, set `KASEKI_GOAL_SETTING=0`.

**Pipeline Position**:

```
User Prompt → Goal-Setting Agent → Scouting → Coding Loop → Goal-Check → Run Evaluation
```

---

## Table of Contents

1. [Overview & Why Goal-Setting](#overview--why-goal-setting)
2. [What Makes a Good Goal](#what-makes-a-good-goal)
3. [The 10 Improvements (May 2026)](#the-10-improvements-may-2026)
4. [Configuration](#configuration)
5. [Practical Guide: Best Practices](#practical-guide-best-practices)
6. [Checking & Interpreting Goal Output](#checking--interpreting-goal-output)
7. [Exit Codes & Troubleshooting](#exit-codes--troubleshooting)
8. [Advanced: Goal-Check Causality](#advanced-goal-check-causality)
9. [API Reference](#api-reference)

---

## Overview & Why Goal-Setting?

According to [OpenAI's Codex guidance](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex), well-formed goals dramatically improve agent success rates by:

1. **Reducing ambiguity** — Vague prompts like "fix the parser" become specific: "Handle null values in parseRole() and add test coverage for edge cases"
2. **Setting success criteria** — Agents know when they're done ("all tests pass" vs. "make it better")
3. **Preventing scope creep** — Clear constraints prevent unintended changes
4. **Improving validation** — Post-goal-check evaluation becomes more accurate

**Related Documentation**:

- [Evaluation Best Practices](./EVALUATION_BEST_PRACTICES.md) — How goal-check and run-evaluation phases leverage goal-setting output
- [Feedback Loop Integration](./FEEDBACK_LOOP_INTEGRATION.md) — How evaluation verdicts feed back into process improvements

---

## What Makes a Good Goal?

A high-quality goal has these characteristics:

### 1. **Clarity**

- ✅ Good: "Refactor the authentication middleware to use JWT tokens instead of session cookies, and ensure backward compatibility with existing API clients."
- ❌ Poor: "Fix the auth system"

### 2. **Measurability**

- ✅ Good: "Add 5 new test cases to cover password validation edge cases (empty, too long, special characters), ensuring 100% line coverage on the validator."
- ❌ Poor: "Improve test coverage"

### 3. **Context**

- ✅ Good: "Migrate from deprecated `npm-shrinkwrap.json` to `package-lock.json` to align with Node.js ecosystem standards and reduce dependency conflicts."
- ❌ Poor: "Update lockfile"

### 4. **Constraints**

- ✅ Good: "Fix TypeScript errors in src/api/ WITHOUT modifying any generated GraphQL files or altering the API schema."
- ❌ Poor: "Fix TypeScript errors"

### 5. **Scope**

- ✅ Good: "Add error handling to the payment gateway module (src/payments/) for network timeouts, rate limits, and invalid responses. Do not modify the merchant configuration system (src/merchant/)."
- ❌ Poor: "Add error handling"

---

## The 10 Improvements (May 2026)

### Executive Summary

The goal-setting agent now produces **mature, production-ready goals** with these critical enhancements:

| Improvement | Impact | Status |
|---|---|---|
| **1. Explicit Anti-Patterns** ("do NOT" clauses) | Prevents unintended changes | ✅ Implemented |
| **2. SMART Criteria Validation** | Ensures success criteria are measurable | ✅ Implemented |
| **3. Codebase Context** | Preserves architectural conventions | ✅ Implemented |
| **4. Example-Driven Clarification** | Grounds agent understanding with examples | ✅ Implemented |
| **5. 5-Point Quality Scorecard** | Assesses goal maturity objectively | ✅ Implemented |
| **6. Constraint Categorization** | Helps agents prioritize safely | ✅ Implemented |
| **7. Goal-to-Outcome Feedback Loop** | Measures effectiveness over time | ✅ Infrastructure in place |
| **8. Reasoning Transparency** | Explains upgrade decisions | ✅ Included in output |
| **9. Iterative Refinement** | Retry mechanism for weak goals | ✅ Implemented |
| **10. Quality Warnings** | Flags high-risk goals early | ✅ Implemented |

---

### 1. Explicit Anti-Patterns ("Do NOT" Clauses)

**Why**: Vague constraints lead to unintended changes. Clear anti-patterns prevent accidents.

**What Changed**:

```json
{
  "anti_patterns": {
    "do_not_modify": ["src/generated/**", "config/*.json"],
    "do_not_break": ["API contracts", "backward compatibility"],
    "must_preserve": ["error messages", "existing behavior"]
  }
}
```

**Benefit**: Downstream quality gates can enforce these programmatically.

**Example**:

```
❌ Before: "Don't modify generated files"
✅ After: "do_not_modify": ["src/generated/**", "src/codegen/**"]
```

---

### 2. SMART Criteria Validation

**Why**: Weak criteria like "improve code quality" don't tell agents when they're done.

**What Changed**:

Success criteria are now validated against the SMART framework:
- **S**pecific: "Fix parseRole() null-handling"
- **M**easurable: "Add 5 edge-case tests"
- **A**chievable: "In 1 run, max 3 files"
- **R**elevant: "Tied to task goal"
- **T**ime-bound: "Complete in single run"

**New Schema**:

```json
{
  "success_criteria": [
    {
      "criterion": "all test cases pass",
      "smart_score": "high",
      "reasoning": "clearly measurable, test results show binary success"
    }
  ]
}
```

**Validator Behavior**:

- ✅ Accepts both old format (strings) and new format (SMART objects)
- ⚠️ Warns if >50% of criteria score as "low" SMART quality
- 🚫 Rejects goals with zero success criteria

---

### 3. Codebase Context Preservation

**Why**: Agents make better decisions when aware of tech stack, folder conventions, and patterns.

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

**Why**: Different constraint types need different enforcement.

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

**Priority Order**: Architectural → Technical → Operational → Business

---

### 5. Example-Based Goal Clarification

**Why**: Concrete examples beat abstract descriptions. Models perform better with "show, don't tell".

```json
{
  "examples": {
    "before": "parseRole(null) returned null; tests crash",
    "after": "parseRole(null) returns 'Unnamed Role'; tests pass"
  }
}
```

---

### 6. Multi-Dimensional Quality Metrics

**Why**: Single confidence score doesn't capture goal health.

**5-Point Scorecard**:

```json
{
  "quality_metrics": {
    "clarity": "high",           // Is goal unambiguous?
    "measurability": "high",     // Can agents tell when done?
    "specificity": "medium",     // Is scope well-bounded?
    "scope_clarity": "high",     // Are boundaries clear?
    "constraint_strength": "high" // Are guardrails testable?
  }
}
```

**Interpretation**:

- **High**: Excellent quality. Agent should succeed.
- **Medium**: Good quality. Most likely to succeed.
- **Low**: Poor quality. High failure risk. Consider retrying with better prompt.

---

### 7. Goal-to-Outcome Feedback Loop

**Why**: Can't optimize without measurement.

**Infrastructure** (`src/lib/goal-setting-feedback.ts`):

```typescript
const feedback = collectGoalFeedback(
  instance_name,
  goal_setting_output,
  stage_timings,
  metadata
);

const analysis = analyzeGoalFeedback(feedback_entries);
// Result: "High-quality goals have 80% vs 50% success"
```

**Metrics Tracked**:

- Goal quality score (0-100)
- SMART quality ("high" vs "low")
- Agent outcomes (success/failure)
- Correlation: Does goal quality predict success?

---

### 8. Reasoning Transparency

**Why**: Agents make better decisions when they understand the upgrade rationale.

**Example Output**:

```json
{
  "reasoning": "Original prompt was vague about scope. Upgraded to be specific: 'Fix parseRole()' → 'Handle null/undefined in parseRole() and add test coverage for 5 edge cases'. Anti-patterns added to prevent modifying generated files. Quality metrics show clarity=high, measurability=high."
}
```

---

### 9. Iterative Refinement / Retry Mechanism

**Current Behavior** (already implemented):

- Max 2 attempts for goal-setting
- Distinguishes transient failures (retry) vs deterministic failures (no retry)
- Falls back to original prompt if both attempts fail
- Tracks `KASEKI_GOAL_SETTING_ATTEMPTS` and `KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT`

---

### 10. Quality Warnings & Early Detection

**Why**: Flag high-risk goals before they reach downstream agents.

```typescript
const warnings = hasQualityWarnings(goal_setting_output);
// Returns:
// [
//   "Goal clarity is low - may cause agent confusion",
//   "Success criteria not measurable - agent may not know when done",
//   "No explicit anti-patterns defined - recommended for safety"
// ]
```

**Logged To**: `/results/goal-setting-validation-errors.jsonl`

---

## Configuration

### Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `KASEKI_GOAL_SETTING` | `1` (enabled) | Set to `0` to disable goal-setting |
| `KASEKI_GOAL_SETTING_MODEL` | same as `KASEKI_SCOUTING_MODEL` | Optional Pi model override |
| `KASEKI_GOAL_SETTING_TIMEOUT_SECONDS` | `300` | Max seconds for goal-setting agent |

### API Request Example

```json
{
  "repoUrl": "https://github.com/user/repo",
  "ref": "main",
  "taskPrompt": "Fix the bug in user authentication",
  "goalSetting": {
    "enabled": true,
    "model": "openrouter/anthropic/claude-3-opus",
    "timeoutSeconds": 300
  }
}
```

---

## Practical Guide: Best Practices

### Writing Better Input Prompts

**Goal**: Your input prompt directly affects goal quality.

**❌ Before (Vague)**:

```
"Fix TypeScript errors"
```

**✅ After (Specific & Structured)**:

```
Fix TypeScript compilation errors in src/api/ directory:
1. Update type annotations for async/await functions (Request/Response objects)
2. Replace `any` types with specific interfaces
3. Ensure build passes: npm run build with zero errors

Do NOT modify:
- src/generated/ (auto-generated files)
- API schema files (*.schema.ts)

Success criteria:
- npm run build succeeds with zero TypeScript errors
- No lines changed outside src/api/
- All existing tests pass
```

**Result**: Clear scope, specific anti-patterns, and measurable success criteria → better goal upgrades.

---

### Leveraging Constraint Categories

Different constraint types guide agent behavior differently:

```typescript
const goal = JSON.parse(fs.readFileSync('/results/goal-setting.json'));

// Operational constraints (execution limits)
console.log('Operational:', goal.constraints.operational);
// → ["max 3 files changed", "must not require migration"]

// Architectural constraints (structure preservation)
console.log('Architectural:', goal.constraints.architectural);
// → ["respect service boundaries", "no new dependencies"]

// Technical constraints (code quality)
console.log('Technical:', goal.constraints.technical);
// → ["must pass TypeScript", "100% test pass rate"]

// Business constraints (behavior preservation)
console.log('Business:', goal.constraints.business);
// → ["maintain backward compatibility", "no data loss"]
```

---

### Using Anti-Patterns in Quality Gates

```bash
# Extract do_not_modify files from goal
FORBIDDEN_FILES=$(jq -r '.anti_patterns.do_not_modify[]' /results/goal-setting.json)

# Check if agent modified any forbidden files
CHANGED_FILES=$(git diff --name-only origin/main)

for file in $CHANGED_FILES; do
  if [[ "$FORBIDDEN_FILES" =~ "$file" ]]; then
    echo "❌ ERROR: Agent modified forbidden file: $file"
    exit 1
  fi
done
```

---

### Analyzing Feedback Patterns (Multi-Run Analysis)

Track how goal quality correlates with success:

```typescript
import { collectGoalFeedback, analyzeGoalFeedback } from './src/lib/goal-setting-feedback';

const feedback_entries = [];

// After each kaseki run:
const goal = JSON.parse(fs.readFileSync('/results/goal-setting.json'));
const metadata = JSON.parse(fs.readFileSync('/results/metadata.json'));
const feedback = collectGoalFeedback('kaseki-1', goal, stage_timings, metadata);
feedback_entries.push(feedback);

// After multiple runs, analyze patterns:
const analysis = analyzeGoalFeedback(feedback_entries);

console.log('Analysis Results:');
console.log(`  Total runs: ${analysis.total_runs}`);
console.log(`  Success rate: ${(analysis.success_rate * 100).toFixed(0)}%`);
console.log(`  Avg quality score: ${analysis.average_quality_score}/100`);

// Check patterns
console.log('\nKey Insight:');
console.log(`  High-quality goals: ${(analysis.patterns.high_quality_goals_success_rate * 100).toFixed(0)}% success`);
console.log(`  Low-quality goals: ${(analysis.patterns.low_quality_goals_success_rate * 100).toFixed(0)}% success`);
```

---

## Checking & Interpreting Goal Output

### Inspecting the Goal-Setting Artifact

After a kaseki run, inspect the upgraded goal:

```bash
# View the generated goal-setting output
cat /results/goal-setting.json | jq .

# Check quality metrics
cat /results/goal-setting.json | jq '.quality_metrics'

# View anti-patterns
cat /results/goal-setting.json | jq '.anti_patterns'

# See constraint categories
cat /results/goal-setting.json | jq '.constraints'

# Check for quality warnings
cat /results/goal-setting-validation-errors.jsonl
```

### Example Output

```json
{
  "upgraded_goal": "Implement null-safety in parseRole() for FriendlyName field with fallback to 'Unnamed Role'. Add 5 edge-case tests. Ensure all tests pass and no API schema changes.",
  "quality_metrics": {
    "clarity": "high",
    "measurability": "high",
    "specificity": "high",
    "scope_clarity": "high",
    "constraint_strength": "high"
  },
  "confidence": "high",
  "anti_patterns": {
    "do_not_modify": ["src/generated/**"],
    "do_not_break": ["API contracts"],
    "must_preserve": ["error message formats"]
  },
  "constraints": {
    "operational": ["max 3 files changed"],
    "architectural": ["no new dependencies"],
    "technical": ["must pass TypeScript checks"],
    "business": ["maintain backward compatibility"]
  }
}
```

---

### Interpreting SMART Criteria Quality

```typescript
const goal = JSON.parse(fs.readFileSync('/results/goal-setting.json'));

goal.success_criteria.forEach((c, i) => {
  const criterion = typeof c === 'string' ? c : c.criterion;
  const score = typeof c === 'object' ? c.smart_score : 'unknown';
  
  console.log(`[${i}] ${criterion}`);
  console.log(`    SMART Score: ${score}`);
});
```

**SMART Score Meanings**:

- **High**: Specific, Measurable, Achievable, Relevant, Time-bound
- **Low**: Vague, not measurable, scope unclear

---

### Debugging Low-Quality Goals

If a goal scores below 50/100:

#### Step 1: Check Quality Warnings

```bash
cat /results/goal-setting-validation-errors.jsonl
```

Output might show:

```
{"type": "warning", "message": "Goal clarity is low - may cause agent confusion"}
{"type": "warning", "message": "Success criteria not measurable - agent may not know when done"}
{"type": "warning", "message": "No explicit anti-patterns defined - recommended for safety"}
```

#### Step 2: Improve Your Input Prompt

**If clarity is low**:
- Be more specific: "Fix parseRole()" vs "Fix the function"
- Add context: Explain WHY the change matters

**If measurability is low**:
- Add concrete metrics: "Add 5 tests" vs "improve coverage"
- Define acceptance criteria: "all tests pass" vs "make it better"

**If anti-patterns are missing**:
- List what NOT to change: "Don't modify src/generated/"
- Define preservation rules: "Keep error message format"

#### Step 3: Re-Run with Improved Prompt

```bash
export TASK_PROMPT="Better, more specific prompt"
./run-kaseki.sh kaseki-2
```

---

## Exit Codes & Troubleshooting

### Goal-Setting Exit Codes

| Code | Meaning | Fix |
|------|---------|-----|
| 0 | Success | Goal-setting completed successfully |
| 101 | Timeout | Goal-setting took >KASEKI_GOAL_SETTING_TIMEOUT_SECONDS |
| 102 | Model unavailable | Specified model not accessible |
| 103 | API error | Provider returned error (check logs) |
| 104 | Invalid prompt | Task prompt is too short or empty |

### Exit Code Solutions

#### Exit 101: Timeout

**Symptom**: Goal-setting phase exceeds timeout.

**Cause**: Model is slow or overloaded.

**Fixes**:

```bash
# Option 1: Increase timeout
export KASEKI_GOAL_SETTING_TIMEOUT_SECONDS=600

# Option 2: Use faster model
export KASEKI_GOAL_SETTING_MODEL=openrouter/openai/gpt-3.5-turbo

# Option 3: Disable goal-setting (not recommended)
export KASEKI_GOAL_SETTING=0
```

#### Exit 102: Model Unavailable

**Symptom**: "Model not found" or "Model deprecated" error.

**Fix**: Update to available model:

```bash
export KASEKI_GOAL_SETTING_MODEL=openrouter/anthropic/claude-3-5-sonnet
```

#### Exit 103: API Error

**Symptom**: Provider returns error (503, 429, auth failure, etc.).

**Fixes**:

- Check API key: `export OPENROUTER_API_KEY=sk-or-...`
- Verify account credits
- Check provider status
- Wait for rate limit to reset (429)

#### Exit 104: Invalid Prompt

**Symptom**: "Task prompt too short or empty" message.

**Fix**: Provide a longer, more descriptive prompt:

```bash
export TASK_PROMPT="Detailed description of what needs to be fixed or implemented"
```

---

## Advanced: Goal-Check Causality

### What is Goal-Check?

**Goal-check** is the fourth stage in the pipeline that validates the coding agent's output against the goal-setting output.

**Pipeline Position**:

```
User Prompt → Goal-Setting → Scouting → Coding Loop → Goal-Check → Run Evaluation
```

### How Goal-Check Uses Goal-Setting Output

The goal-check agent receives:

1. **Original Goal** (from goal-setting.json)
2. **Coding Agent Output** (changes, timings, metadata)
3. **Run Artifacts** (tests, builds, validation)

**Goal-Check Validates**:

- ✅ Did the agent address the goal?
- ✅ Are all success criteria met?
- ✅ Were anti-patterns observed?
- ✅ Were constraints respected?
- ✅ Is the output production-ready?

### Interpreting Goal-Check Output

```bash
# View goal-check verdict
cat /results/goal-check.json | jq .

# Check if all criteria passed
cat /results/goal-check.json | jq '.criteria_validation'

# See constraint violations
cat /results/goal-check.json | jq '.constraint_violations'
```

### Causality Analysis

Goal-check performs **causality analysis** to ensure:

1. **Necessity**: Did ALL changes contribute to the goal?
2. **Sufficiency**: Are the changes SUFFICIENT to meet all criteria?
3. **Orthogonality**: Did the agent avoid unrelated modifications?

**Example**:

```json
{
  "goal_check_verdict": "PASS",
  "causality_analysis": {
    "necessity": "PASS",  // All changes relate to goal
    "sufficiency": "PASS", // Changes sufficient for all criteria
    "orthogonality": "PASS" // No unrelated modifications
  },
  "criteria_validation": [
    {
      "criterion": "parseRole() returns 'Unnamed Role' for null",
      "status": "PASS",
      "evidence": "Test at line 42 demonstrates behavior"
    },
    {
      "criterion": "5 edge-case tests added",
      "status": "PASS",
      "evidence": "5 test cases in tests/parseRole.test.ts"
    }
  ]
}
```

---

## API Reference

### Updated Goal-Setting Output Schema (v2)

File: `/results/goal-setting.json`

```typescript
interface GoalSettingOutput {
  // Original input
  original_prompt: string;
  
  // Upgraded goal
  upgraded_goal: string;
  
  // Requirements and success criteria
  key_requirements: string[];
  success_criteria: Array<{
    criterion: string;
    smart_score: "high" | "medium" | "low";
    reasoning: string;
  }>;
  
  // Anti-patterns (new in v2)
  anti_patterns?: {
    do_not_modify: string[];      // Globs/paths to not touch
    do_not_break: string[];       // Contracts/behaviors to preserve
    must_preserve: string[];      // Specific elements to keep
  };
  
  // Constraints (new in v2)
  constraints?: {
    operational: string[];        // Execution limits
    architectural: string[];      // Structure preservation
    technical: string[];          // Code quality
    business: string[];           // Behavior preservation
  };
  
  // Examples (new in v2)
  examples?: {
    before: string;
    after: string;
  };
  
  // Codebase context (new in v2)
  codebase_signals?: {
    tech_stack: string;
    structure: string;
    patterns: string[];
  };
  
  // Quality assessment (new in v2)
  quality_metrics: {
    clarity: "high" | "medium" | "low";
    measurability: "high" | "medium" | "low";
    specificity: "high" | "medium" | "low";
    scope_clarity: "high" | "medium" | "low";
    constraint_strength: "high" | "medium" | "low";
  };
  
  // Reasoning for upgrade
  reasoning: string;
  
  // Confidence in this goal
  confidence: "high" | "medium" | "low";
}
```

### TypeScript Helpers

```typescript
import {
  GoalSettingOutput,
  calculateGoalQualityScore,
  hasQualityWarnings,
  SmartCriterion,
  AntiPatterns,
  QualityMetrics,
} from './types/goal-setting';

// Load and work with goal-setting output
const goal: GoalSettingOutput = JSON.parse(
  fs.readFileSync('/results/goal-setting.json', 'utf-8')
);

// Calculate quality (0-100)
const quality = calculateGoalQualityScore(goal);

// Check for warnings
const warnings = hasQualityWarnings(goal);

if (quality < 50) {
  console.warn('⚠️  Goal quality below 50/100:', warnings);
}

// Use anti-patterns in quality gates
if (goal.anti_patterns?.do_not_modify) {
  validateChangedFilesNotIn(goal.anti_patterns.do_not_modify);
}
```

---

## Backward Compatibility

✅ **Fully Backward Compatible**:

- Old `potential_constraints` field still supported (logged as warning)
- Success criteria accept both string and SmartCriterion formats
- Validation non-blocking: missing new fields → warnings, not errors

**Recommendation**: Update code to use new schemas, but old scripts will still work.

---

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Kaseki with Goal-Setting Evaluation
on: [workflow_dispatch]

jobs:
  run-kaseki:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run kaseki with goal-setting
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          KASEKI_GOAL_SETTING: "1"
          KASEKI_GOAL_SETTING_TIMEOUT_SECONDS: "300"
          TASK_PROMPT: ${{ inputs.task_prompt }}
        run: ./run-kaseki.sh
      
      - name: Check goal quality
        run: |
          QUALITY=$(jq '.quality_score' /agents/kaseki-results/kaseki-1/goal-setting.json)
          if [ "$QUALITY" -lt 50 ]; then
            echo "⚠️  Goal quality below 50/100"
            jq '.warnings' /agents/kaseki-results/kaseki-1/goal-setting.json
          fi
```

---

## Migration from Previous Versions

If you were using older goal-setting docs, here's the mapping:

- **GOAL_SETTING_IMPROVEMENTS.md** → Section "The 10 Improvements (May 2026)" ✅
- **GOAL_SETTING_PRACTICAL_GUIDE.md** → Section "Practical Guide: Best Practices" ✅
- **GOAL_SETTING_EXIT_CODES.md** → Section "Exit Codes & Troubleshooting" ✅
- **GOAL-SETTING-FIXES-SUMMARY.md** → Integrated into troubleshooting ✅
- **GOAL_CHECK_CAUSALITY_INTEGRATION.md** → Section "Advanced: Goal-Check Causality" ✅

All content is consolidated into this single master reference document.

---

## Related Documentation

- [Task Prompt Templates](./TASK_PROMPT_TEMPLATES.md) — Examples of well-formed prompts
- [Evaluation Best Practices](./EVALUATION_BEST_PRACTICES.md) — How goal-check phase works
- [Quality Gates](./QUALITY_GATES.md) — Enforcing goals with allowlists and constraints
- [Feedback Loop Integration](./FEEDBACK_LOOP_INTEGRATION.md) — Measuring goal effectiveness

---

## Support & Questions

For issues with goal-setting:

1. Check [Exit Codes & Troubleshooting](#exit-codes--troubleshooting)
2. Review [Practical Guide: Best Practices](#practical-guide-best-practices)
3. Inspect `/results/goal-setting-validation-errors.jsonl` for warnings
4. See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for general kaseki issues
