# Baseline Test Failure Comparison

## Overview

Kaseki Agent can distinguish **pre-existing test failures** (failures that already exist in the main branch) from **newly-introduced test failures** (failures caused by the agent's changes). This feature provides valuable insight into whether the agent's changes improved, maintained, or worsened test stability.

## How It Works

### The Two-Phase Validation Approach

1. **Phase 1: Baseline Validation** (automatic, before agent runs)
   - Kaseki checks out the `main` branch into a temporary workspace
   - Runs the same validation commands on the pristine main branch
   - Records baseline test results

2. **Phase 2: Working Validation** (automatic, after agent runs)
   - Kaseki runs validation commands on the agent's modified code
   - Compares working results against baseline results

3. **Classification** (automatic, at end of run)
   - **Pre-existing**: Test failed in both baseline and working
   - **Newly-introduced**: Test passed in baseline, failed in working ⚠️
   - **Fixed**: Test failed in baseline, passed in working ✅
   - **Changed**: Test status changed between baseline and working

## Configuration

### Enabling/Disabling

```bash
# Enable baseline validation (default: enabled)
export KASEKI_BASELINE_VALIDATION_ENABLED=1

# Disable baseline validation
export KASEKI_BASELINE_VALIDATION_ENABLED=0
```

### Cache Settings

```bash
# Cache directory (default: /cache/kaseki-baseline)
export KASEKI_BASELINE_CACHE_ROOT=/custom/cache/path

# Cache expiration (default: 7 days)
export KASEKI_BASELINE_CACHE_MAX_AGE_DAYS=14
```

## Results & Artifacts

### In Result Summary

The `result-summary.md` now includes:

```markdown
- Test failure analysis: completed
  - ⚠️ **Newly introduced failures: 1**
  - See test-baseline-comparison.json for full breakdown
```

### Detailed Results

File: `/results/test-baseline-comparison.json`

```json
{
  "baseline_validation_exit_code": 0,
  "working_validation_exit_code": 1,
  "summary": {
    "total_pre_existing": 2,
    "total_newly_introduced": 1,
    "total_fixed": 0,
    "total_tests": 3
  },
  "classification": {
    "should validate input": {
      "baseline_status": "failed",
      "working_status": "failed",
      "category": "pre-existing"
    },
    "should handle edge case": {
      "baseline_status": "passed",
      "working_status": "failed",
      "category": "newly-introduced"
    }
  }
}
```

### Metadata Integration

The `metadata.json` includes:

```json
{
  "baseline_validation_enabled": true,
  "baseline_cache_status": "completed",
  "baseline_validation_exit_code": 0,
  "test_failure_classification_status": "completed",
  "newly_introduced_failures_count": 1
}
```

## Artifacts Generated

For each kaseki run with baseline validation enabled:

- **validation-baseline.log** — Full output from running validation commands on main branch
- **validation-baseline-timings.tsv** — Per-command execution timings for baseline
- **validation-baseline-env.log** — Environment snapshot during baseline validation
- **test-baseline-comparison.json** — Structured classification data with summary

## Supported Test Frameworks

The baseline validation feature supports any framework that produces test output in one of these formats:

### Jest Output

```
PASS src/module.test.js
  ✓ should validate input (15ms)
  ✗ should handle edge case (8ms)

Tests: 1 passed, 1 failed
```

### Vitest Output

```
✓ src/module.test.ts (2)
  PASS  should validate input (15ms)
  FAIL  should handle edge case (8ms)

Tests: 1 passed, 1 failed
```

### Mocha Output

```
✓ should validate input
✗ should handle edge case

2 tests
```

## Use Cases

### Use Case 1: Verify the Agent Didn't Break Tests

```bash
export KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run test"
export KASEKI_BASELINE_VALIDATION_ENABLED=1

# Run kaseki
./run-kaseki.sh

# Check results
cat /agents/kaseki-results/kaseki-1/test-baseline-comparison.json
# If newly_introduced_failures_count > 0, the agent introduced regressions
```

### Use Case 2: Fix Known Failing Tests

```bash
# Create a task to fix a specific pre-existing test
export TASK_PROMPT="Fix the failing test: should validate input"
export KASEKI_BASELINE_VALIDATION_ENABLED=1

# Run kaseki
./run-kaseki.sh

# In the results, you should see this test move from pre-existing to fixed
cat /agents/kaseki-results/kaseki-1/test-baseline-comparison.json
```

### Use Case 3: Monitor Test Stability Over Time

```bash
# Set a custom cache to track changes across runs
export KASEKI_BASELINE_CACHE_ROOT=/shared/kaseki-baseline
export KASEKI_BASELINE_CACHE_MAX_AGE_DAYS=30

# Multiple runs with same configuration will reuse cached baseline
for i in {1..5}; do
  ./run-kaseki.sh
  echo "Run $i: $(jq '.summary.total_newly_introduced' /agents/kaseki-results/kaseki-$i/test-baseline-comparison.json) newly-introduced"
done
```

## Performance Impact

- **Baseline Checkout**: ~30-60 seconds (git clone + npm ci)
- **Baseline Validation**: Same as pre-agent validation duration
- **Test Analysis**: < 1 second for classification
- **Disk Usage**: ~200MB per cached repository (in /cache/kaseki-baseline)

### Optimization Tips

1. **Cache Hit Rate**: First run caches the baseline; subsequent runs reuse it
2. **Selective Validation**: Use specific npm scripts in `KASEKI_PRE_AGENT_VALIDATION_COMMANDS` instead of running all tests
3. **Parallel Execution**: Baseline validation runs independently and could be parallelized (future enhancement)

## Troubleshooting

### Baseline checkout fails

**Problem**: `checkout_baseline_failed` error in result-summary.md

**Solutions**:

- Verify `main` branch exists: `git branch -r origin/main`
- Check git connectivity: `git ls-remote $REPO_URL`
- Verify disk space: `df /cache/kaseki-baseline`

### No test results in test-baseline-comparison.json

**Problem**: `test_failure_classification_status: "skipped"`

**Solutions**:

- Check if `KASEKI_PRE_AGENT_VALIDATION_ENABLED=1`
- Verify validation logs exist: `ls /results/validation-baseline.log`
- Check test output format is recognized
- Look at `validation-baseline.log` for test output

### Cache not being used

**Problem**: Baseline checkout happens every run despite enabled caching

**Solutions**:

- Check cache directory permissions: `ls -la /cache/kaseki-baseline`
- Verify `KASEKI_BASELINE_CACHE_MAX_AGE_DAYS` - cache older than this is invalidated
- Clear cache to start fresh: `rm -rf /cache/kaseki-baseline`

### Newly-introduced failures showing as pre-existing

**Problem**: Test that passed in main is shown as pre-existing failure

**Solutions**:

- Verify baseline validation actually runs: Check `validation-baseline.log`
- Check if test names match exactly (including whitespace)
- Look at raw classification in `test-baseline-comparison.json`

## Integration with CI/CD

### GitHub Actions Example

```yaml
- name: Run Kaseki with Baseline Validation
  env:
    KASEKI_PRE_AGENT_VALIDATION_COMMANDS: "npm run test:unit"
    KASEKI_BASELINE_VALIDATION_ENABLED: "1"
    KASEKI_BASELINE_CACHE_ROOT: "/tmp/kaseki-baseline"
  run: ./run-kaseki.sh

- name: Check for Newly-Introduced Failures
  run: |
    NEWLY_INTRODUCED=$(jq '.summary.total_newly_introduced' \
      /agents/kaseki-results/kaseki-1/test-baseline-comparison.json)
    
    if [ "$NEWLY_INTRODUCED" -gt 0 ]; then
      echo "❌ Agent introduced $NEWLY_INTRODUCED new test failures!"
      exit 1
    fi
```

## Advanced: Custom Classification Logic

The `analyze-test-failures.ts` module can be customized for:

- Custom test framework support
- Weighted failure categories
- Integration with test management systems
- Custom reporting formats

See [src/analyze-test-failures.ts](../src/analyze-test-failures.ts) for the implementation.

## Future Enhancements

- [ ] Parallel baseline execution in separate container
- [ ] Persistent result caching for rapid comparison
- [ ] HTML report generation with trend analysis
- [ ] Integration with GitHub checks for visible PR feedback
- [ ] Configurable failure thresholds and approval gates
- [ ] Test impact analysis combining coverage data
