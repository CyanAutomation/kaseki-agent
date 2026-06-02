# Validation Failure Causality Analysis

## Overview

The validation failure causality analysis feature automatically determines whether test failures are caused by code changes or are pre-existing issues in the repository. This helps reviewers quickly understand the nature of validation failures and make better decisions about whether to retry, fix, or merge.

## The Problem

When a kaseki-agent run completes with validation failures, it can be difficult to determine:

- Is the failure caused by my code change?
- Was the test already failing before my change?
- Is it an infrastructure issue unrelated to code?

This ambiguity slows down the review process and can lead to:

- Unnecessary retries on infrastructure failures
- False confidence in changes that don't actually fix the issue
- Wasted effort investigating unrelated problems

## The Solution: Three-Signal Causality Analysis

Kaseki analyzes validation failures using three independent signals, each contributing to a final verdict:

### Signal 1: Comparative Test Results (40% weight)

**What it does**: Compares test results before and after the code change.

**Example**:

```
Baseline (before change):
  ✓ should parse input
  ✓ should validate config
  
After change:
  ✓ should parse input
  ✗ should validate config - TypeError: config.version is undefined
```

**Analysis**: The failure in `should validate config` is NEW, meaning it's likely caused by the change.

**Output**:

- Number of newly failing tests
- Number of newly passing tests
- Number of consistently failing tests (both before and after)

### Signal 2: Log Causality Markers (35% weight)

**What it does**: Looks for specific markers in failure logs that indicate infrastructure issues vs code issues.

**Infrastructure Failure Markers**:

- Timeout errors (`timeout`, `timed out`, `ETIMEDOUT`)
- Connection errors (`ECONNREFUSED`, `ENOTFOUND`)
- Resource exhaustion (`out of memory`, `ENOMEM`)

**Code Causality Markers**:

- Changed function names appearing in stack traces
- Changed file names mentioned in error messages

**Example**:

```
Baseline & After Change (both failing):
  ✗ should connect to database
  Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Analysis**: `ECONNREFUSED` indicates database service isn't running. This is infrastructure, not code. Verdict: `pre_existing`.

### Signal 3: Code Impact Correlation (25% weight)

**What it does**: Analyzes what code actually changed and whether those changes could plausibly cause the failure.

**Analysis Process**:

1. Extract identifiers from git diff (function names, class names, variable names)
2. Search failure logs for those identifiers
3. Compute correlation strength (high/medium/low/none)

**Example**:

```
Changed Code:
  - function validateConfig(config: Config) {
  -   return config.version !== undefined;
  + }
  + function validateConfig(config: Config) {
  +   return config.version === undefined; // Bug!
  + }

Failure Message:
  "should validate config - Error: Expected true but got false"
  Stack trace mentions "validateConfig"

Analysis**: validateConfig is in the changed code AND appears in the failure context → correlation strength = HIGH
```

## Output: Causality Verdict

After analyzing all three signals, kaseki produces a verdict with confidence:

### Verdict Types

**`change_related` (confidence 0.75-1.0)**

- One or more signals strongly indicate the failure is caused by the code change
- Example: New test failure + changed function in stack trace + no infrastructure issues
- **Recommendation**: Fix the code or revert the change

**`pre_existing` (confidence 0.75-1.0)**

- Multiple signals indicate the failure existed before the change
- Example: Consistent failure across baselines + infrastructure markers + no code correlation
- **Recommendation**: Investigate pre-existing issues or ignore if unrelated to current change

**`mixed` (confidence 0.5-0.75)**

- Signals conflict; some indicate change-related, others indicate pre-existing
- Example: New failure for function that wasn't changed
- **Recommendation**: Manual investigation needed

**`inconclusive` (confidence < 0.5)**

- Not enough signal agreement to make a reliable determination
- Example: Only partial logs available, or failure type unclear
- **Recommendation**: Manual review or gather more information

## Accessing Causality Analysis

### In the Artifacts

After a validation failure, kaseki generates:

```
/results/validation-causality-analysis.json
```

**Example output**:

```json
{
  "timestamp": "2024-06-02T12:00:00.000Z",
  "assessment": {
    "failureType": "change_related",
    "confidence": 0.85,
    "rationale": "1 new test failure(s) introduced by change.",
    "signals": {
      "comparativeResults": {
        "analysis": {
          "newlyFailing": ["should validate config"],
          "newlyPassing": [],
          "consistentlyFailing": [],
          "regressionCount": 1,
          "improvementCount": 0
        },
        "indicatesChangeRelated": true,
        "weight": 0.4
      },
      "logMarkers": {
        "markers": [],
        "indicatesChangeRelated": false,
        "weight": 0.35
      },
      "codeImpact": {
        "analysis": {
          "changedIdentifiers": ["validateConfig"],
          "mentionedInLogs": ["validateConfig"],
          "correlationStrength": "high"
        },
        "indicatesChangeRelated": true,
        "weight": 0.25
      }
    }
  },
  "version": "1.0"
}
```

### In Progress Events

During validation failure analysis, kaseki emits progress events:

```
[PROGRESS] validation causality analysis | analyzing failure causality (3 signals)
[PROGRESS] validation causality analysis | completed: change_related (85% confidence)
```

### In Summary Output

The `result-summary.md` includes causality analysis results:

```markdown
## Validation Failure Causality Analysis

**Verdict**: change_related  
**Confidence**: 85%  
**Rationale**: 1 new test failure(s) introduced by change.

**Analysis Details**:
- Signal 1 (Comparative Results): New failure detected ✓
- Signal 2 (Log Markers): No infrastructure failures ✓
- Signal 3 (Code Impact): Changed function in failure context ✓
```

## Real-World Examples

### Example 1: Bug in Changed Code

**Scenario**: Developer changes validation logic, test fails

**Signal 1 (Comparative Results)**:

- Baseline: ✓ passing
- Post-change: ✗ failing
- → Indicates change_related ✓

**Signal 2 (Log Markers)**:

- No timeout/connection/memory errors
- → Doesn't indicate infrastructure ✓

**Signal 3 (Code Impact)**:

- Changed: `validateConfig()` function
- Error mentions: `validateConfig in assertion`
- → High correlation with change ✓

**Verdict**: `change_related` (95% confidence) — Fix the validation logic

### Example 2: Flaky Test (Pre-existing)

**Scenario**: Tests that sometimes pass/fail due to timing issues

**Signal 1 (Comparative Results)**:

- Baseline: ✗ failing (flaky)
- Post-change: ✗ failing (same test, same error)
- No new failures, no improvements
- → Doesn't indicate change_related ✓

**Signal 2 (Log Markers)**:

- Timeout detected in error message
- → Indicates infrastructure/flakiness ✓

**Signal 3 (Code Impact)**:

- Changed: Database connection pool config
- Error mentions: Unrelated UI library
- → No correlation ✓

**Verdict**: `pre_existing` (92% confidence) — Not caused by change, likely flaky test

### Example 3: Infrastructure Failure (Pre-existing)

**Scenario**: Database service not running, tests fail

**Signal 1 (Comparative Results)**:

- Baseline: ✗ failing
- Post-change: ✗ failing (same error)
- → Doesn't indicate change_related ✓

**Signal 2 (Log Markers)**:

- `ECONNREFUSED 127.0.0.1:5432`
- → Strong indicator of infrastructure failure ✓

**Signal 3 (Code Impact)**:

- Changed: Comments in README
- Error relates to: Database connection
- → No correlation ✓

**Verdict**: `pre_existing` (98% confidence) — Infrastructure issue, not code

## Limitations & Caveats

1. **Depends on Baseline**: Requires a baseline validation cache to compare against. First run won't have causality analysis.

2. **Log Quality**: Accuracy depends on how well test frameworks format error messages. Custom logging frameworks might not be recognized.

3. **Concurrent Changes**: Can't distinguish between effects of multiple changes in a single diff. Assumes all code changes are related.

4. **Silent Failures**: If test failures don't produce logs (e.g., process killed), analysis might be inconclusive.

5. **Flaky Tests**: Very flaky tests (random pass/fail) may show mixed verdicts. Consider marking them as known-flaky.

## Configuration

### Disabling Causality Analysis

Set environment variable to skip causality analysis (useful if TypeScript runner unavailable):

```bash
KASEKI_CAUSALITY_ANALYSIS_DISABLED=1
```

### Adjusting Signal Weights

Modify the weights in `src/lib/validation-causality-analysis.ts` if you want different signals to have more/less influence:

```typescript
const SIGNAL_WEIGHTS = {
  comparativeResults: 0.4,  // 40%
  logMarkers: 0.35,         // 35%
  codeImpact: 0.25          // 25%
};
```

## Integration with Goal-Check

When goal-check is enabled, causality analysis results inform the goal verdict:

- **change_related failures**: Goal considered unmet if critical tests fail
- **pre_existing failures**: Goal might still be met if non-critical tests fail
- **inconclusive**: Goal verdict requires manual review

See [GOAL_SETTING_PRACTICAL_GUIDE.md](./GOAL_SETTING_PRACTICAL_GUIDE.md) for details.

## Troubleshooting

### "validation causality analysis | skipped (no baseline)"

**Cause**: First run, no baseline to compare against.  
**Solution**: Run kaseki again with same repo/commands. Second run will have baseline.

### "validation causality analysis | TypeScript analysis unavailable"

**Cause**: `ts-node` or `npx` not available in container.  
**Solution**: Update base Docker image to include Node.js dev tools, or rebuild image.

### "validation-causality-analysis.json not created"

**Cause**: TypeScript analysis had runtime error.  
**Solution**: Check `/results/stdout.log` and `/results/stderr.log` for details.

### Verdict seems wrong

**Steps**:

1. Inspect `validation-causality-analysis.json` artifact
2. Review each signal's analysis in detail
3. Check `validation-baseline.log` vs `validation.log` for differences
4. Consider signal weight adjustments or log format issues

## Future Improvements

- **Machine Learning**: Train model on historical causality verdicts to improve accuracy
- **Custom Rules**: Allow repository-specific rules (e.g., "database tests are often flaky")
- **Parallel Test Analysis**: Identify which specific test assertion failed
- **Failure Clustering**: Group related failures to identify systemic issues
- **Auto-Retry**: Automatically retry on pre_existing failures with high confidence

## References

- [Validation Architecture](./VALIDATION_ARCHITECTURE.md)
- [Baseline Validation Caching](./BASELINE_VALIDATION_CACHE.md)
- [Goal-Check Integration](./GOAL_SETTING_PRACTICAL_GUIDE.md)
