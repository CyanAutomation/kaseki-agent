# Caveman Mode Token Usage Baseline

**Purpose**: Establish baseline token usage measurements to quantify the impact of caveman optimizations.

**Date**: Not yet measured  
**Status**: Template - awaiting baseline measurements

---

## Measurement Methodology

1. **Test tasks** (3-5 representative workloads):
   - Small fix (e.g., single function bug fix)
   - Medium feature (e.g., add validation logic + tests)
   - Large refactor (e.g., restructure module + update dependents)

2. **Measurement**: Run each task with `KASEKI_CAVEMAN=0` and `KASEKI_CAVEMAN=1`

3. **Metrics tracked**:
   - Total input tokens
   - Total output tokens
   - Total tokens (sum)
   - Per-phase breakdown (scouting, coding, goal-check, run-eval)
   - Cache efficiency percentage

4. **Script**: `./scripts/measure-caveman-impact.sh --task "..." --repo "..."`

---

## Baseline Results (Placeholder)

### Task 1: Small Fix

**Description**: Fix null pointer bug in parser

| Mode | Input Tokens | Output Tokens | Total Tokens | Phases Breakdown |
|------|-------------|---------------|--------------|------------------|
| Verbose (caveman=0) | TBD | TBD | TBD | TBD |
| Terse (caveman=1) | TBD | TBD | TBD | TBD |
| **Delta** | **TBD** | **TBD** | **TBD** | **TBD%** |

### Task 2: Medium Feature

**Description**: Add email validation with tests

| Mode | Input Tokens | Output Tokens | Total Tokens | Phases Breakdown |
|------|-------------|---------------|--------------|------------------|
| Verbose (caveman=0) | TBD | TBD | TBD | TBD |
| Terse (caveman=1) | TBD | TBD | TBD | TBD |
| **Delta** | **TBD** | **TBD** | **TBD** | **TBD%** |

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
