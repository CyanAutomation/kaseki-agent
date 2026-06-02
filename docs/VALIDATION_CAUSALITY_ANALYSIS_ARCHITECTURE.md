# Validation Failure Causality Analysis - Architecture

## Overview

The validation failure causality analysis feature automatically assesses whether test failures are caused by code changes or pre-existing issues. It uses three independent signals with weighted confidence scoring.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     kaseki-agent.sh (orchestrator)              │
│                                                                 │
│  if [ VALIDATION_EXIT -ne 0 ]; then                            │
│    analyze_validation_failure_causality() ───┐                 │
│  fi                                           │                 │
└────────────────────────────────────────────────┼─────────────────┘
                                                 │
                                    ┌────────────▼──────────────┐
                                    │  Shell Function:          │
                                    │  analyze_validation_      │
                                    │  failure_causality()      │
                                    │                           │
                                    │  • Check baseline.log     │
                                    │  • Read validation.log    │
                                    │  • Invoke ts-node         │
                                    │  • Run analysis module    │
                                    │  • Generate artifact      │
                                    │  • Emit progress event    │
                                    └──────────┬────────────────┘
                                               │
                    ┌──────────────────────────▼──────────────────────┐
                    │  TypeScript Analysis Module:                    │
                    │  validation-causality-analysis.ts               │
                    │                                                 │
                    │  analyzeValidationFailureCausality()            │
                    │    ├─ Signal 1: Comparative Results             │
                    │    ├─ Signal 2: Log Causality Markers           │
                    │    └─ Signal 3: Code Impact Correlation         │
                    │                                                 │
                    │  assessCausality()                              │
                    │    └─ Combine signals with weighted scoring     │
                    │                                                 │
                    │  generateCausalityAnalysisArtifact()            │
                    │    └─ Write JSON to /results/                   │
                    └──────────┬───────────────────────────────────────┘
                               │
                ┌──────────────▼──────────────┐
                │  Output Artifact:           │
                │  validation-causality-      │
                │  analysis.json              │
                │                             │
                │  • timestamp                │
                │  • assessment.failureType   │
                │  • assessment.confidence    │
                │  • assessment.rationale     │
                │  • signals (3 detailed)     │
                └─────────────────────────────┘
```

## Signal Processing

### Signal 1: Comparative Test Results

```
Input: baseline.log, validation.log
Process:
  1. Parse both logs into test case lists
  2. Build set of tests in baseline
  3. Build set of tests in post-change
  4. Compare: newly failing, newly passing, consistent
  5. Count regressions vs improvements
Output:
  {
    newlyFailing: ["test_name"],
    newlyPassing: [],
    consistentlyFailing: [],
    regressionCount: 1,
    improvementCount: 0,
    indicatesChangeRelated: true
  }
Indicates Change Related: When regressionCount > 0
Weight: 0.4 (most reliable)
```

### Signal 2: Log Causality Markers

```
Input: validation.log, git.diff
Process:
  1. Scan logs for infrastructure failure markers:
     - Timeout: "timeout", "timed out", "ETIMEDOUT"
     - Connection: "ECONNREFUSED", "ENOTFOUND"
     - Memory: "out of memory", "ENOMEM"
  2. Extract changed filenames from diff
  3. Search logs for those filenames in stack traces
  4. Correlate with error context
Output:
  {
    markers: ["ECONNREFUSED"],
    changedFilesInStackTrace: [],
    infrastructureFailures: true,
    indicatesChangeRelated: false
  }
Indicates Change Related:
  - If changed files appear in stack trace: true
  - If infrastructure failure: false
  - Otherwise: inconclusive
Weight: 0.35 (good specificity)
```

### Signal 3: Code Impact Correlation

```
Input: git.diff, validation.log
Process:
  1. Extract identifiers from diff:
     - Function names
     - Class names
     - Interface names
     - Type names
     - Variable names
  2. Search validation.log for these identifiers
  3. Check error messages and stack traces
  4. Compute correlation strength:
     - HIGH: Multiple matches or exact stack trace hit
     - MEDIUM: Single match in error context
     - LOW: Matches but weak context
     - NONE: No matches
Output:
  {
    changedIdentifiers: ["validateConfig"],
    mentionedInLogs: ["validateConfig"],
    correlationStrength: "high",
    indicatesChangeRelated: true
  }
Indicates Change Related: correlation_strength >= "medium"
Weight: 0.25 (less reliable due to false positives)
```

## Verdict Calculation

```
confidence = weighted_score(signal1, signal2, signal3)
  where:
    weighted_score = (s1.weight * s1.indicates) 
                   + (s2.weight * s2.indicates) 
                   + (s3.weight * s3.indicates)

failureType = determine_verdict(weighted_score, signal_agreement)
  if weighted_score >= 0.75 && high_agreement:
    failureType = "change_related"
  elif weighted_score <= 0.25 && high_agreement:
    failureType = "pre_existing"
  elif signal_agreement < 0.5:
    failureType = "inconclusive"
  else:
    failureType = "mixed"

confidence = max(min(abs(weighted_score - 0.5) * 2, 1.0), agreement_factor)
```

## Integration Points

### 1. Baseline Validation Cache (Phase 1 Dependency)

The causality analysis depends on:

- Baseline validation log cached from previous run
- Cache key includes repo URL + validation commands
- Cache expires after 24 hours
- Located at: `{KASEKI_BASELINE_CACHE_ROOT}/<hash>/validation-baseline.log`

### 2. Validation Execution Flow

**Location in kaseki-agent.sh**: Line 7495

```bash
# After validation commands complete
if [ "$VALIDATION_EXIT" -ne 0 ]; then
  analyze_validation_failure_causality
fi
```

**Behavior**:

- Only runs if validation failed (VALIDATION_EXIT != 0)
- Gracefully skips if baseline unavailable
- Non-blocking (failure doesn't stop execution)
- Emits progress events

### 3. Artifact Generation

**Output Location**: `/results/validation-causality-analysis.json`

**Artifact Structure**:

```json
{
  "timestamp": "ISO8601",
  "assessment": {
    "failureType": "change_related|pre_existing|mixed|inconclusive",
    "confidence": 0.0-1.0,
    "rationale": "Human-readable explanation",
    "signals": {
      "comparativeResults": {
        "analysis": { /* detailed data */ },
        "indicatesChangeRelated": true|false,
        "weight": 0.4
      },
      "logMarkers": {
        "markers": ["marker1", "marker2"],
        "indicatesChangeRelated": true|false,
        "weight": 0.35
      },
      "codeImpact": {
        "analysis": { /* detailed data */ },
        "indicatesChangeRelated": true|false,
        "weight": 0.25
      }
    }
  },
  "version": "1.0"
}
```

## Data Flow Example

```
Run kaseki-agent with change to validateConfig():

1. Pre-change baseline runs (Phase 1):
   - Executes validation commands
   - All tests pass
   - Saves results to cache as:
     {CACHE_ROOT}/{HASH}/validation-baseline.log
     {CACHE_ROOT}/{HASH}/metadata.json

2. Post-change run on same repo:
   - Agent makes code changes
   - Validation runs: 1 new test failure
   - VALIDATION_EXIT = 1 (non-zero)
   
3. analyze_validation_failure_causality() called:
   - Reads baseline from cache (Phase 1)
   - Reads post-change validation.log
   - Reads git.diff (contains validateConfig change)
   - Reads changed-files.txt
   
4. TypeScript module processes signals:
   - Signal 1: Parse logs → newlyFailing=["should validate config"]
   - Signal 2: Scan logs → no ECONNREFUSED, no timeout
   - Signal 3: Extract "validateConfig" from diff → found in error message
   
5. Verdict calculation:
   - Signal1: indicatesChangeRelated=true (weight 0.4)
   - Signal2: indicatesChangeRelated=false (weight 0.35)
   - Signal3: indicatesChangeRelated=true (weight 0.25)
   - weighted_score = (0.4*1) + (0.35*0) + (0.25*1) = 0.65
   - Result: failureType="change_related", confidence=0.85
   
6. Artifact written:
   - /results/validation-causality-analysis.json created
   - Progress event emitted: "Verdict: change_related (85% confidence)"
   - Agent continues to next phase
```

## Error Handling

**Graceful Degradation Strategy**:

1. **No baseline available**: Skip analysis (non-fatal)

   ```
   First run always skips (no baseline to compare)
   ```

2. **TypeScript runner unavailable**: Skip analysis (non-fatal)

   ```
   If npx/ts-node not available, emit message and continue
   ```

3. **Malformed logs**: Skip signal, continue with others

   ```
   If parsing fails, signal returns "inconclusive"
   ```

4. **Artifact write fails**: Non-fatal, continue execution

   ```
   Artifact generation is best-effort
   ```

5. **Analysis timeout**: Non-fatal, continue execution

   ```
   Timeout cap: 10 seconds (shouldn't occur in practice)
   ```

## Performance Characteristics

**Time Complexity**:

- O(n) where n = lines in validation logs
- Typical logs: 1-10 MB
- Parse time: ~50-100 ms

**Space Complexity**:

- O(k) where k = number of unique test names
- Typical: ~100-500 unique tests
- Memory: <10 MB

**Artifact Size**:

- Typical: 2-5 KB JSON
- Maximum: ~10 KB (large diffs)

## Future Enhancements

1. **Machine Learning**: Train model on historical causality verdicts
2. **Custom Rules**: Repository-specific failure patterns
3. **Failure Clustering**: Group related failures to identify systemic issues
4. **Auto-Retry**: Automatic retry on pre_existing failures with high confidence
5. **Metrics**: Track accuracy of causality verdicts against actual root causes

## Dependencies

**Required**:

- Node.js (already used by kaseki)
- TypeScript (already used by kaseki)

**Optional**:

- `ts-node` or `npx` (for TypeScript execution)
- `jq` (for artifact parsing in shell)

**No New External Dependencies**: Analysis uses only built-in Node.js modules

## Testing Strategy

**Unit Tests** (28 tests):

- Individual signal functions
- Verdict calculation logic
- Artifact generation
- Real-world scenarios

**Integration Tests**:

- Shell function definition
- Call site validation
- End-to-end execution flow

**Manual Testing**:

- Run kaseki on target repos
- Inspect generated artifacts
- Verify verdict accuracy

## Monitoring & Observability

**Progress Events**:

```
[PROGRESS] validation causality analysis | analyzing failure causality (3 signals)
[PROGRESS] validation causality analysis | completed: change_related (85% confidence)
```

**Artifacts**:

- `/results/validation-causality-analysis.json` - primary output
- `/results/stdout.log` - analysis execution details
- `/results/stderr.log` - analysis errors (if any)

**Metrics** (for Phase 3 integration):

- Verdict accuracy rate
- Signal agreement percentage
- False positive rate
- Typical execution time

## References

- [VALIDATION_CAUSALITY_ANALYSIS.md](./VALIDATION_CAUSALITY_ANALYSIS.md) - User guide
- [BASELINE_VALIDATION_CACHE.md](./BASELINE_VALIDATION_CACHE.md) - Phase 1 (dependency)
- [src/lib/validation-causality-analysis.ts](../src/lib/validation-causality-analysis.ts) - Implementation
- [src/lib/validation-causality-analysis.test.ts](../src/lib/validation-causality-analysis.test.ts) - Tests
