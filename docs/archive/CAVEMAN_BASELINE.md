# Caveman Mode Token Usage Baseline

**Purpose**: Establish baseline token usage measurements to quantify the impact of caveman optimizations across all compression levels.

**Date**: Awaiting first measurements  
**Status**: Template - requires live environment with OpenRouter API access  
**Version**: Phase 2 complete (levels 0-2 available)

---

## Measurement Methodology

### Prerequisites

1. **Environment**: Running kaseki-agent installation with:
   - Valid OpenRouter API key configured
   - Docker environment or Node.js runtime
   - Access to target repositories
   - Sufficient time (~15-30 min per task × 3 levels × 3-5 tasks = 2-4 hours total)

2. **Tools**:
   - `scripts/measure-caveman-impact.sh` — automated comparison script
   - Target repositories with known codebases
   - Consistent task prompts across measurements

### Measurement Process

For each test task:

1. **Run at level 0 (verbose baseline)**:

   ```bash
   KASEKI_CAVEMAN_LEVEL=0 \
   TASK_PROMPT="[task description]" \
   REPO_URL="[target repo]" \
   ./run-kaseki.sh
   ```

2. **Run at level 1 (output-only compression, current default)**:

   ```bash
   KASEKI_CAVEMAN_LEVEL=1 \
   TASK_PROMPT="[same task description]" \
   REPO_URL="[same repo]" \
   ./run-kaseki.sh
   ```

3. **Run at level 2 (output + static sections compression)**:

   ```bash
   KASEKI_CAVEMAN_LEVEL=2 \
   TASK_PROMPT="[same task description]" \
   REPO_URL="[same repo]" \
   ./run-kaseki.sh
   ```

4. **Extract metrics**: From each run's `pi-summary.json`:
   - `token_usage.total_input_tokens`
   - `token_usage.total_output_tokens`
   - `token_usage.total_tokens`
   - `phase_token_stats.*` (per-phase breakdown)

5. **Calculate deltas**:
   - Level 1 vs Level 0: Output compression impact
   - Level 2 vs Level 0: Combined compression impact
   - Level 2 vs Level 1: Static section compression impact

### Test Task Selection

Choose 3-5 representative tasks covering different complexity levels:

**Small Fix** (baseline, 1-2 files):

- Single function bug fix
- Simple null check or edge case
- Expected: 5,000-15,000 total tokens at level 0

**Medium Feature** (3-5 files):

- Add validation logic with tests
- Implement new API endpoint
- Expected: 15,000-40,000 total tokens at level 0

**Large Refactor** (5-10 files):

- Restructure module with dependents
- Extract common functionality
- Expected: 40,000-80,000 total tokens at level 0

**Complex Feature** (10+ files, optional):

- Multi-component feature with integration
- Cross-cutting concern (auth, logging, etc.)
- Expected: 80,000-150,000 total tokens at level 0

**Edge Case Test** (specific scenario):

- Known difficult task (high retry rate)
- Complex validation requirements
- Expected: Variable (measure resilience to compression)

### Metrics to Track

For each run, record:

| Metric | Source | Purpose |
|--------|--------|---------|
| Total input tokens | `pi-summary.json.token_usage.total_input_tokens` | Measure prompt compression |
| Total output tokens | `pi-summary.json.token_usage.total_output_tokens` | Measure response compression |
| Total tokens | Sum of input + output | Overall efficiency |
| Per-phase input tokens | `phase_token_stats.*.input_tokens` | Identify optimization targets |
| Per-phase output tokens | `phase_token_stats.*.output_tokens` | Validate output compression |
| Run duration | `metadata.json.duration_seconds` | Check performance impact |
| Exit code | `exit_code` file | Verify quality not degraded |
| Changed files count | `changed-files.txt` | Verify behavior consistency |

---

## Baseline Results (Awaiting Measurements)

### Task 1: Small Fix

**Description**: Fix null pointer bug in parseRole() function  
**Repository**: TBD  
**Expected complexity**: 1-2 files, ~10,000 total tokens at level 0

| Level | Input Tokens | Output Tokens | Total Tokens | Input Reduction | Output Reduction | Total Reduction |
|-------|-------------|---------------|--------------|----------------|------------------|-----------------|
| 0 (verbose) | TBD | TBD | TBD | — | — | — |
| 1 (output-only) | TBD | TBD | TBD | TBD% | TBD% | TBD% |
| 2 (medium) | TBD | TBD | TBD | TBD% | TBD% | TBD% |

**Per-phase breakdown** (level 2 vs level 0):

- Goal-setting: TBD input, TBD output
- Scouting: TBD input, TBD output
- Coding: TBD input, TBD output
- Goal-check: TBD input, TBD output
- Run-evaluation: TBD input, TBD output

**Quality metrics**:

- Exit code: TBD (expect 0 for all levels)
- Changed files: TBD (expect same across levels)
- Validation: TBD (expect pass for all levels)

---

### Task 2: Medium Feature

**Description**: Add email validation with regex + unit tests  
**Repository**: TBD  
**Expected complexity**: 3-5 files, ~25,000 total tokens at level 0

| Level | Input Tokens | Output Tokens | Total Tokens | Input Reduction | Output Reduction | Total Reduction |
|-------|-------------|---------------|--------------|----------------|------------------|-----------------|
| 0 (verbose) | TBD | TBD | TBD | — | — | — |
| 1 (output-only) | TBD | TBD | TBD | TBD% | TBD% | TBD% |
| 2 (medium) | TBD | TBD | TBD | TBD% | TBD% | TBD% |

**Per-phase breakdown** (level 2 vs level 0):

- Goal-setting: TBD input, TBD output
- Scouting: TBD input, TBD output
- Coding: TBD input, TBD output
- Goal-check: TBD input, TBD output
- Run-evaluation: TBD input, TBD output

**Quality metrics**:

- Exit code: TBD
- Changed files: TBD
- Validation: TBD

---

### Task 3: Large Refactor

**Description**: Extract duplicate error handling to shared utility  
**Repository**: TBD  
**Expected complexity**: 5-10 files, ~50,000 total tokens at level 0

| Level | Input Tokens | Output Tokens | Total Tokens | Input Reduction | Output Reduction | Total Reduction |
|-------|-------------|---------------|--------------|----------------|------------------|-----------------|
| 0 (verbose) | TBD | TBD | TBD | — | — | — |
| 1 (output-only) | TBD | TBD | TBD | TBD% | TBD% | TBD% |
| 2 (medium) | TBD | TBD | TBD | TBD% | TBD% | TBD% |

**Per-phase breakdown** (level 2 vs level 0):

- Goal-setting: TBD input, TBD output
- Scouting: TBD input, TBD output
- Coding: TBD input, TBD output
- Goal-check: TBD input, TBD output
- Run-evaluation: TBD input, TBD output

**Quality metrics**:

- Exit code: TBD
- Changed files: TBD
- Validation: TBD

---

### Task 4: [Optional - Add More Tasks]

(Repeat structure for additional tasks)

---

## Summary Statistics (Awaiting Data)

### Aggregate Results

| Metric | Level 0 (verbose) | Level 1 (output-only) | Level 2 (medium) |
|--------|-------------------|----------------------|------------------|
| Avg input tokens | TBD | TBD | TBD |
| Avg output tokens | TBD | TBD | TBD |
| Avg total tokens | TBD | TBD | TBD |
| Avg input reduction | — | TBD% | TBD% |
| Avg output reduction | — | TBD% | TBD% |
| Avg total reduction | — | TBD% | TBD% |

### Cost Impact (Estimated)

At typical OpenRouter pricing ($1.50 per million tokens):

| Scenario | Level 0 Cost | Level 1 Cost | Level 2 Cost | Level 1 Savings | Level 2 Savings |
|----------|-------------|-------------|-------------|----------------|----------------|
| Single run (avg) | TBD | TBD | TBD | TBD% | TBD% |
| 100 runs/month | TBD | TBD | TBD | $TBD/mo | $TBD/mo |
| 1000 runs/month | TBD | TBD | TBD | $TBD/mo | $TBD/mo |

### Quality Validation

| Quality Check | Level 0 | Level 1 | Level 2 | Notes |
|--------------|---------|---------|---------|-------|
| Success rate | TBD% | TBD% | TBD% | Target: ≥95% for all levels |
| Avg changed files | TBD | TBD | TBD | Should be consistent |
| Validation pass rate | TBD% | TBD% | TBD% | Should be consistent |
| Avg run duration | TBD | TBD | TBD | May improve slightly with compression |

---

## Expected Results (Hypotheses)

Based on Phase 2 implementation and compression ratios:

### Level 1 (Output-Only) vs Level 0

- **Input tokens**: 0-5% reduction (minimal, instruction only)
- **Output tokens**: 70-80% reduction (caveman instruction effect)
- **Total tokens**: 40-50% reduction (output dominates)

### Level 2 (Medium) vs Level 0

- **Input tokens**: 15-25% reduction (static section compression)
- **Output tokens**: 70-80% reduction (same as level 1)
- **Total tokens**: 50-60% reduction (combined effect)

### Level 2 vs Level 1

- **Input tokens**: 15-25% reduction (static section effect isolated)
- **Output tokens**: 0-5% reduction (same caveman instruction)
- **Total tokens**: 10-15% additional reduction

### Quality Impact

- **Expected**: No regression in success rate, validation pass rate, or behavior
- **Rationale**: Technical terms preserved, semantic completeness maintained
- **Risk**: Low (TDD approach, pattern validation in tests)

---

## How to Run Measurements

### Option 1: Manual Execution (Most Control)

```bash
# For each task, run three times with different levels:

# Task: Fix null handling in parser
TASK="Fix null pointer in parseRole() when input is undefined"
REPO="CyanAutomation/crudmapper"

# Level 0 (verbose)
KASEKI_CAVEMAN_LEVEL=0 TASK_PROMPT="$TASK" REPO_URL="$REPO" ./run-kaseki.sh
# Save results: cp /agents/kaseki-results/kaseki-1 /tmp/baseline-task1-level0

# Level 1 (output-only)
KASEKI_CAVEMAN_LEVEL=1 TASK_PROMPT="$TASK" REPO_URL="$REPO" ./run-kaseki.sh
# Save results: cp /agents/kaseki-results/kaseki-2 /tmp/baseline-task1-level1

# Level 2 (medium)
KASEKI_CAVEMAN_LEVEL=2 TASK_PROMPT="$TASK" REPO_URL="$REPO" ./run-kaseki.sh
# Save results: cp /agents/kaseki-results/kaseki-3 /tmp/baseline-task1-level2

# Extract metrics
jq '.token_usage' /tmp/baseline-task1-level0/pi-summary.json
jq '.token_usage' /tmp/baseline-task1-level1/pi-summary.json
jq '.token_usage' /tmp/baseline-task1-level2/pi-summary.json
```

### Option 2: Automated Script (Faster)

```bash
# Use measure-caveman-impact.sh (currently compares level 0 vs 1 only)
# Note: Script needs updating to support level 2 comparison

./scripts/measure-caveman-impact.sh \
  --task "Fix null pointer in parseRole()" \
  --repo "CyanAutomation/crudmapper" \
  --output /tmp/caveman-baseline

# TODO: Enhance script to compare levels 0, 1, and 2 in single run
```

### Option 3: CI/CD Integration (Continuous Monitoring)

```yaml
# .github/workflows/caveman-baseline.yml
name: Caveman Baseline Measurement

on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sunday
  workflow_dispatch:

jobs:
  measure:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run baseline measurements
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        run: |
          # Run measurement suite
          ./scripts/measure-caveman-baseline-suite.sh
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: caveman-baseline-${{ github.run_number }}
          path: /tmp/caveman-baseline/
```

---

## Next Steps

1. **Prerequisites**:
   - [ ] Set up environment with OpenRouter API key
   - [ ] Identify 3-5 target repositories with known tasks
   - [ ] Allocate 2-4 hours for measurement runs
   - [ ] Prepare task descriptions (consistent prompts)

2. **Execution**:
   - [ ] Run Task 1 at levels 0, 1, 2
   - [ ] Run Task 2 at levels 0, 1, 2
   - [ ] Run Task 3 at levels 0, 1, 2
   - [ ] (Optional) Run Tasks 4-5 at levels 0, 1, 2

3. **Analysis**:
   - [ ] Extract token metrics from all runs
   - [ ] Calculate reduction percentages
   - [ ] Validate quality consistency (exit codes, changed files)
   - [ ] Document findings in this file

4. **Reporting**:
   - [ ] Update this document with actual measurements
   - [ ] Create summary report: `docs/CAVEMAN_IMPACT_REPORT.md`
   - [ ] Update cost estimates in `docs/COST_ESTIMATION.md`
   - [ ] Update skill guidance in `.agents/skills/cost-optimization/SKILL.md`

---

## References

- [docs/CAVEMAN_PHASE2_COMPLETE.md](CAVEMAN_PHASE2_COMPLETE.md) — Implementation summary
- [docs/ADVANCED_CONFIG.md](ADVANCED_CONFIG.md) — KASEKI_CAVEMAN_LEVEL configuration
- [src/caveman/caveman-prompts.ts](../src/caveman/caveman-prompts.ts) — Compression templates
- [src/caveman/caveman-prompts.test.ts](../src/caveman/caveman-prompts.test.ts) — Validation tests

### Task 3: Large Refactor

**Description**: Restructure auth module + update callers

| Mode | Input Tokens | Output Tokens | Total Tokens | Phases Breakdown |
|------|-------------|---------------|--------------|------------------|
| Verbose (caveman=0) | TBD | TBD | TBD | TBD |
| Terse (caveman=1) | TBD | TBD | TBD | TBD |
| **Delta** | **TBD** | **TBD** | **TBD** | **TBD%** |

---

## Aggregate Baseline Summary

| Metric | Verbose Mode | Terse Mode | Reduction | % Saved |
|--------|-------------|------------|-----------|---------|
| Average input tokens | TBD | TBD | TBD | TBD% |
| Average output tokens | TBD | TBD | TBD | TBD% |
| Average total tokens | TBD | TBD | TBD | TBD% |

**Expected impact**: Current caveman mode (output-only compression) should show ~10-20% output token reduction, minimal input token change.

---

## Next Steps

1. Run baseline measurements: `./scripts/measure-caveman-impact.sh`
2. Record results in this document
3. Use baseline to measure Phase 2-3 improvements:
   - Phase 2 (compressed guardrails): Target 15-25% input reduction
   - Phase 3 (compressed artifacts): Target 30-40% input reduction

---

## Notes

- Baseline measurements establish "control" for optimization validation
- Per-phase breakdown enables targeted compression (e.g., scouting vs goal-check)
- Cost calculations assume $0.50/1M tokens (typical mid-tier model)
