# Phase 3: Goal-Check Enhancement with Causality Assessment

## Overview

Phase 3 integrates validation failure causality analysis results into goal-check decision-making. This allows goal-check to make more informed verdicts by distinguishing between:

- **Implementation failures** (goal should fail) — Validation failures caused by code changes
- **Pre-existing issues** (goal might pass) — Validation failures not caused by code changes  
- **Mixed scenarios** (goal needs review) — Some failures from changes, some pre-existing
- **Inconclusive** (goal conservative fail) — Insufficient evidence to determine cause

## What Was Implemented

### 1. Goal-Check Causality Integration Library (src/lib/goal-check-causality-integration.ts)

**New TypeScript utility providing:**

- `loadCausalityAssessment()` - Load causality artifact from disk
- `extractGoalCheckContext()` - Extract actionable context for goal-check
- `formatCausalityForGoalCheck()` - Format causality for human-readable display
- `suggestVerdictAdjustment()` - Recommend verdict changes based on causality
- `generateCausalityPromptSection()` - Create prompt section for goal-check
- `isImplementationLikelyValid()` - Quick check if implementation is valid

**Verdict Adjustment Logic:**

- If failures are `pre_existing` with confidence ≥0.75: can pass despite failures
- If failures are `change_related` with confidence ≥0.75: must fail
- If failures are `mixed`: fail on change-related items, accept pre-existing
- If failures are `inconclusive`: conservative approach (fail)

### 2. Goal-Check Causality Integration Tests (src/lib/goal-check-causality-integration.test.ts)

**25 comprehensive tests covering:**

- Loading and parsing causality assessments
- Extracting actionable context for all verdict types
- Formatting causality for display
- Verdict adjustment logic for all scenarios
- Real-world integration scenarios
- Edge cases and error conditions

**Test Results: 25/25 passing ✅**

### 3. Shell Integration (kaseki-agent.sh - build_goal_check_prompt)

**Changes:**

- Added `causality_context` local variable
- Read validation-causality-analysis.json artifact
- Parse and format causality assessment using Node.js
- Include formatted causality context in goal-check prompt
- Place causality section before validation context for prominence

**Output Examples:**

```
VALIDATION FAILURE CAUSALITY ASSESSMENT:

Type: pre_existing
Confidence: 92%
Rationale: Database connection failures (ECONNREFUSED)

⚠️  Key Finding: Validation failures appear to be PRE-EXISTING (not caused by code changes).
   - You can assess goal-check verdict based on requirements implementation, not blocked by these failures.
   - Implementation may be valid despite validation failures.
```

## How Goal-Check Uses Causality

### Scenario 1: Failed Validation, Change-Related Failure (confidence ≥0.75)

```
Causality Assessment: change_related (88% confidence)
Goal-Check Prompt includes: "Implementation is NOT valid; failures must be fixed"
Suggested Action: Verdict should be met=false
Reasoning: Code changes directly caused failures
```

### Scenario 2: Failed Validation, Pre-Existing Failure (confidence ≥0.75)

```
Causality Assessment: pre_existing (93% confidence)
Goal-Check Prompt includes: "Implementation may be valid despite validation failures"
Suggested Action: Verdict can be met=true if requirements are met
Reasoning: Failures not caused by changes; don't block goal
```

### Scenario 3: Failed Validation, Mixed Causality

```
Causality Assessment: mixed (65% confidence)
Goal-Check Prompt includes: "Identify change-related failures and fail on those"
Suggested Action: Verdict must distinguish change-related vs pre-existing
Reasoning: Some failures block goal, some don't
```

### Scenario 4: Failed Validation, Inconclusive

```
Causality Assessment: inconclusive (45% confidence)
Goal-Check Prompt includes: "Be conservative; base verdict on other available evidence"
Suggested Action: Verdict should lean toward met=false unless strong other evidence
Reasoning: Not enough signal agreement; default to conservative
```

## Prompt Integration

The goal-check prompt now includes:

```
## Inputs to Inspect

**Causality Assessment** (NEW - helps interpret validation failures):
- Validation failure causality analysis: /results/validation-causality-analysis.json
- Type: change_related | pre_existing | mixed | inconclusive
- Confidence: percentage with interpretation
- Key findings and recommendations

**Goal-Setting Context** (existing):
- Goal requirements, SMART criteria, anti-patterns

**Agent Artifacts** (existing):
- Scouting report, changed files, git diff, validation logs
```

## Benefits

### For Goal-Check Accuracy

1. **Fewer False Negatives**: Pre-existing failures don't incorrectly fail valid implementations
2. **Better Detection**: Change-related failures correctly identified as implementation issues
3. **Mixed Scenarios**: Nuanced assessment of partially-valid implementations
4. **Confidence Calibration**: Low-confidence assessments use conservative approach

### For Development Experience

1. **Faster Feedback**: Goal-check verdict less dependent on flaky infrastructure
2. **Smarter Retries**: Pre-existing failures don't trigger unnecessary retries
3. **Better Context**: Goal-check has causality information to make better decisions
4. **Clear Communication**: Causality rationale explained in goal-check prompt

### For Long-Term Learning

1. **Accuracy Metrics**: Track how often causality verdicts are correct
2. **Signal Effectiveness**: Measure which signals are most predictive
3. **Threshold Tuning**: Optimize confidence thresholds based on outcomes
4. **Pattern Detection**: Identify common failure types for proactive fixes

## Output Artifacts

### In Goal-Check Prompt

Causality assessment formatted as structured section:

```
VALIDATION FAILURE CAUSALITY ASSESSMENT:

Type: [failure type]
Confidence: [percentage]
Rationale: [human-readable explanation]

[Key findings and recommendations specific to failure type]
```

### Referenced by Goal-Check

Goal-check can now:

- Read /results/validation-causality-analysis.json
- Understand causality signals and confidence scores
- Use recommendation to adjust verdict appropriately
- Document causality rationale in validation_notes

## Integration Points

### Phase 2 Dependency

This phase depends on Phase 2 (Validation Failure Causality Analysis):

- Requires `/results/validation-causality-analysis.json` artifact
- Uses causality verdict (change_related | pre_existing | mixed | inconclusive)
- Uses confidence score (0.0-1.0)

### Phase 4 (Auto-Retry) Ready

Phase 4 will use causality to implement smart retries:

- Retry on pre_existing with confidence ≥0.75 if implementation_valid=true
- Skip retry on change_related with confidence ≥0.75
- Conservative retry on mixed/inconclusive

## Configuration

### Disable Causality Assessment

If needed, disable causality assessment (e.g., if not yet available):

```bash
# In kaseki-agent.sh, modify build_goal_check_prompt:
# Comment out causality_context section
# Goal-check will still work, just without causality info
```

### Adjust Confidence Thresholds

Modify verdict adjustment logic in src/lib/goal-check-causality-integration.ts:

```typescript
// Current: 0.75 confidence threshold for high-confidence verdicts
// Can adjust based on feedback: 0.70, 0.80, etc.
```

## Files Modified/Created

**New Production Code:**

- `src/lib/goal-check-causality-integration.ts` (290 lines)
  - Verdict adjustment logic
  - Context extraction and formatting
  - Prompt section generation

**New Tests:**

- `src/lib/goal-check-causality-integration.test.ts` (290 lines)
  - 25 comprehensive tests, all passing

**Modified Production Code:**

- `kaseki-agent.sh` - build_goal_check_prompt() function
  - Added causality context reading
  - Added causality section to prompt

## Verification Status

✅ **25/25 Integration Tests Passing**
✅ **Shell Syntax Valid**
✅ **All Dependencies Met** (Phase 2 causality analysis)
✅ **Prompt Format Verified**
✅ **Real-World Scenarios Tested**

## Next Steps (Phase 4: Auto-Retry)

When ready to implement auto-retry:

1. Check goal-check verdict and causality assessment
2. If verdict is met=false and failure is pre_existing (high confidence):
   - Optionally retry coding agent
   - Track retry success rate
3. Respect KASEKI_GOAL_CHECK_MAX_RETRIES
4. Update metrics on retry success/failure

## Known Limitations

1. **Requires Phase 2**: Causality assessment must be available
2. **First-Run**: If no baseline validation, causality skipped
3. **Manual Interpretation**: Goal-check prompt includes causality but agent still makes final verdict
4. **Confidence Calibration**: Thresholds based on early data, may need tuning

## Future Improvements

- Machine learning model to predict causality with higher accuracy
- Repository-specific causality rules (e.g., "database tests often flaky")
- Automatic threshold tuning based on feedback
- Integration with run-evaluation for outcome tracking
- Causality history across runs for pattern detection
