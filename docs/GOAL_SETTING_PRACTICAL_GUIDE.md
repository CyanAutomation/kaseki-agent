# Practical Guide: Using Goal-Setting Improvements

**Quick Reference**: How to leverage all 10 improvements in your kaseki workflows

---

## 1. Writing Better Input Prompts

**Goal**: Your input prompt directly affects goal quality. Better prompts → better goals → better agent outcomes.

### ❌ Before (Vague)

```
"Fix TypeScript errors"
```

### ✅ After (Specific & Structured)

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

**Why**: Clear scope, specific anti-patterns, and measurable success criteria lead to better goal upgrades.

---

## 2. Checking Your Generated Goal

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
cat /results/goal-setting-validation-notes.txt
```

### Example Output

```json
{
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
  }
}
```

---

## 3. Interpreting Quality Metrics

Check the `quality_metrics` object from the goal-setting output to evaluate goal maturity:

```typescript
const goal = JSON.parse(fs.readFileSync('/results/goal-setting.json'));
const metrics = goal.quality_metrics;

// Check quality levels
console.log(`Clarity: ${metrics.clarity}`);
console.log(`Measurability: ${metrics.measurability}`);
console.log(`Specificity: ${metrics.specificity}`);
console.log(`Scope Clarity: ${metrics.scope_clarity}`);
console.log(`Constraint Strength: ${metrics.constraint_strength}`);
```

**Quality Interpretation**:
- **High**: Excellent quality. Agent should succeed.
- **Medium**: Good quality. Most likely to succeed.
- **Low**: Poor quality. High failure risk. Consider retrying with better prompt.

---

## 4. Interpreting SMART Criteria Quality

Check each success criterion for SMART properties:

```typescript
const goal = JSON.parse(fs.readFileSync('/results/goal-setting.json'));

goal.success_criteria.forEach((c, i) => {
  const criterion = typeof c === 'string' ? c : c.criterion;
  const score = typeof c === 'object' ? c.smart_score : 'unknown';
  
  console.log(`[${i}] ${criterion}`);
  console.log(`    SMART Score: ${score}`);
  if (typeof c === 'object' && c.reasoning) {
    console.log(`    Reason: ${c.reasoning}`);
  }
});
```

**SMART Score Meanings**:
- **High**: Specific ("fix parseRole() null"), Measurable ("all tests pass"), Achievable, Relevant, Time-bound
- **Low**: Vague ("improve quality"), not measurable, scope unclear

---

## 5. Using Anti-Patterns in Quality Gates

Anti-patterns can enforce downstream guardrails:

```bash
# Extract do_not_modify files from goal
jq -r '.anti_patterns.do_not_modify[]' /results/goal-setting.json

# Check if agent modified any forbidden files
FORBIDDEN_FILES=$(jq -r '.anti_patterns.do_not_modify[]' /results/goal-setting.json)
CHANGED_FILES=$(git diff --name-only origin/main)

for file in $CHANGED_FILES; do
  if [[ "$FORBIDDEN_FILES" =~ "$file" ]]; then
    echo "❌ ERROR: Agent modified forbidden file: $file"
    exit 1
  fi
done
```

---

## 6. Leveraging Constraint Categories

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

**Usage**: Pass these to downstream agents for sequencing and prioritization.

---

## 7. Using Examples for Clarity

If the goal includes before/after examples, show them to agents:

```bash
# Extract examples
jq -r '.examples' /results/goal-setting.json

# Example output:
# {
#   "before": "parseRole(null) → TypeError: Cannot read property 'name'",
#   "after": "parseRole(null) → {name: 'Unnamed Role'}"
# }
```

**Benefit**: Models respond better to concrete examples than abstract descriptions.

---

## 8. Analyzing Feedback Patterns (Multi-Run Analysis)

Track how goal quality correlates with success across multiple runs:

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
console.log('\nPatterns:');
console.log(`  High-quality goals: ${(analysis.patterns.high_quality_goals_success_rate * 100).toFixed(0)}% success`);
console.log(`  Low-quality goals: ${(analysis.patterns.low_quality_goals_success_rate * 100).toFixed(0)}% success`);
console.log(`  With anti-patterns: ${(analysis.patterns.with_anti_patterns_success_rate * 100).toFixed(0)}% success`);
console.log(`  Without anti-patterns: ${(analysis.patterns.without_anti_patterns_success_rate * 100).toFixed(0)}% success`);

// Get recommendations
console.log('\nRecommendations:');
analysis.recommendations.forEach(r => console.log(`  ✓ ${r}`));
```

**Key Insight**: If high-quality goals have 85% success vs. 50% for low-quality → **focus on goal quality**.

---

## 9. Debugging Low-Quality Goals

If a goal scores below 50/100:

### Step 1: Check Quality Warnings

```bash
cat /results/goal-setting-validation-notes.txt
```

Output might show:
```
goal-setting-warnings:
  Goal clarity is low - may cause agent confusion
  Success criteria not measurable - agent may not know when done
  No explicit anti-patterns defined - recommended for safety
```

### Step 2: Improve Your Input Prompt

**If clarity is low**:
- Be more specific: "Fix parseRole()" vs "Fix the function"
- Add context: Explain WHY the change matters

**If measurability is low**:
- Add concrete metrics: "Add 5 tests" vs "improve coverage"
- Define acceptance criteria: "all tests pass" vs "make it better"

**If anti-patterns are missing**:
- List what NOT to change: "Don't modify src/generated/"
- Define preservation rules: "Keep error message format"

### Step 3: Re-Run with Improved Prompt

```bash
export TASK_PROMPT="Better, more specific prompt"
./run-kaseki.sh kaseki-2
```

---

## 10. Integrating with CI/CD

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
          TASK_PROMPT: "Your detailed task prompt here"
        run: |
          docker run --rm \
            -e OPENROUTER_API_KEY \
            -e TASK_PROMPT \
            -v $(pwd):/workspace \
            kaseki-agent:latest \
            ./run-kaseki.sh
      
      - name: Check goal quality
        run: |
          QUALITY=$(jq '.quality_score' /results/goal-setting.json)
          if [ "$QUALITY" -lt 50 ]; then
            echo "❌ Goal quality too low: $QUALITY/100"
            jq '.quality_metrics' /results/goal-setting.json
            exit 1
          fi
          echo "✅ Goal quality: $QUALITY/100"
      
      - name: Validate anti-patterns
        run: |
          FORBIDDEN=$(jq -r '.anti_patterns.do_not_modify[]?' /results/goal-setting.json)
          CHANGED=$(git diff --name-only origin/main)
          for file in $CHANGED; do
            if [[ "$FORBIDDEN" == *"$file"* ]]; then
              echo "❌ Agent modified forbidden file: $file"
              exit 1
            fi
          done
          echo "✅ All changed files allowed by anti-patterns"
```

---

## 11. Monitoring Dashboard Metrics

Track these over time:

| Metric | Target | Why |
|--------|--------|-----|
| Goal Quality Score | > 75 | Better goals → better outcomes |
| SMART Criteria Quality | High | Ensures success criteria are measurable |
| Anti-Patterns Count | > 0 | Prevents unintended changes |
| High-Quality Goal Success Rate | > 80% | Validates goal-quality correlation |
| Goal-Setting Timeout Rate | < 5% | Goal-setting should be fast (read-only) |

---

## 12. Common Patterns & Solutions

### Pattern: Goals Too Specific (Low Achievability)

**Problem**: Goal requires complex refactoring in single run

**Solution**: Break into smaller goals across multiple runs

```
❌ "Refactor entire auth system"
✅ Run 1: "Add JWT token support"
✅ Run 2: "Migrate session cookies to JWT"
✅ Run 3: "Remove deprecated session code"
```

---

### Pattern: Goals Too Vague (Low Clarity)

**Problem**: Goal doesn't specify exactly what to fix

**Solution**: Include examples and explicit success criteria

```
❌ "Fix the parser"
✅ "Fix parseRole() to handle null FriendlyName.
   Before: parseRole(null) → TypeError
   After: parseRole(null) → {name: 'Unnamed Role'}
   Add 5 edge-case tests."
```

---

### Pattern: Missing Context (Low Scope Clarity)

**Problem**: Agent doesn't know where changes belong

**Solution**: Specify files and boundaries

```
❌ "Add error handling"
✅ "Add error handling to src/api/gateway.ts.
   Do NOT modify src/api/schema.ts.
   Catch errors: timeout (5s), rate_limit (429), invalid_response.
   Format errors per src/error-formatter.ts pattern."
```

---

## Summary Checklist

- [ ] Review `/results/goal-setting.json` after each run
- [ ] Check `quality_metrics` for weak areas
- [ ] Validate `anti_patterns` are enforced downstream
- [ ] Track quality_metrics across runs for trends
- [ ] Monitor `success_criteria` SMART scores
- [ ] Collect `GoalFeedbackEntry` data across runs
- [ ] Analyze patterns with `analyzeGoalFeedback()`
- [ ] Alert if any quality_metrics are "low"
- [ ] Iterate on input prompts based on feedback
- [ ] Track correlation: goal quality → agent success

---

## References

- [Goal-Setting Improvements](./GOAL_SETTING_IMPROVEMENTS.md)
- [Goal-Setting Guide](./GOAL_SETTING_GUIDE.md)
- TypeScript Types: [`src/types/goal-setting.ts`](../src/types/goal-setting.ts)
- Feedback Infrastructure: [`src/lib/goal-setting-feedback.ts`](../src/lib/goal-setting-feedback.ts)
- Test Suite: [`tests/goal-setting-improvements.test.ts`](../tests/goal-setting-improvements.test.ts)
