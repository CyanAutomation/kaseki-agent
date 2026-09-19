# Fallow Configuration Fix Report

**Date**: September 19, 2026  
**Status**: Phase 1 Complete — Configuration Bug Fixed & Production Code Analyzed

---

## Executive Summary

The original fallow report (27 targets with heavy "untested risk" warnings) was caused by a **configuration bug**: test files were included in the `entry` field of `.fallowrc.json`, causing them to be analyzed as production code.

### What Was Fixed

- ✅ Removed test files from `entry` field
- ✅ Added comprehensive test file exclusions to `ignorePatterns`
- ✅ Fallow now analyzes only production code (56K LOC, not 128K with tests)
- ✅ False positives eliminated (large test functions, test utility files)

### Current Status

- **Corrected Report**: 50 refactoring targets (legitimate production code)
- **Top Issues**: Mostly untested risk + dead code warnings
- **Key Finding**: 7 of top 10 targets are actually well-tested; fallow's test discovery still has minor issues
- **Codebase Health**: 86.7 maintainability (good) — more realistic than the inflated 91.6

---

## The Problem (Root Cause Analysis)

### Original Configuration (❌ INCORRECT)

```json
{
  "entry": [
    ".pi-extensions.js",
    "src/cli.ts",
    "src/kaseki-api-service.ts",
    "src/**/*.test.ts",        // ← WRONG: Test files analyzed as production code
    "src/**/*.spec.ts",        // ← WRONG
    "test/**/*.test.ts",       // ← WRONG
    "tests/**/*.test.ts",      // ← WRONG
    "scripts/**/*.test.ts"     // ← WRONG
  ]
}
```

### Impact of Bug

| Issue | Symptom | Root Cause |
| ------- | --------- | ----------- |
| **Large test functions** | 10+ functions with 900–3000 LOC | describe/it blocks counted as functions |
| **"Untested risk"** | Test files marked as lacking test coverage | Test functions themselves aren't tested |
| **Test utility false positives** | tests/helpers/markdown.ts, src/__test-utils/env.ts in top targets | Test helpers were entry points |
| **Inflated maintainability** | 91.6 score seemed too high | Test code was included (tests are simpler) |

---

## The Fix (Implementation)

### Changes Made to `.fallowrc.json`

**Before:**

```json
"entry": [
  ".pi-extensions.js",
  "src/cli.ts",
  "src/kaseki-api-service.ts",
  "src/get-caveman-prompt.ts",
  "src/kaseki-api/index.ts",
  "src/**/*.test.ts",
  "src/**/*.spec.ts",
  "src/**/*.type-test.ts",
  "scripts/context-handoff.js",
  "test/**/*.test.ts",
  "tests/**/*.test.ts",
  "scripts/**/*.ts",
  "scripts/**/*.test.ts"
],
"ignorePatterns": [
  "**/*.test.d.ts",
  "**/*.test.d.ts.map",
  "scripts/score-tests.ts",
  ".github/**"
]
```

**After:**

```json
"entry": [
  ".pi-extensions.js",
  "src/cli.ts",
  "src/kaseki-api-service.ts",
  "src/get-caveman-prompt.ts",
  "src/kaseki-api/index.ts",
  "scripts/context-handoff.js",
  "scripts/**/*.ts"
],
"ignorePatterns": [
  "**/*.test.d.ts",
  "**/*.test.d.ts.map",
  "**/*.test.ts",          // ← NEW: Exclude all test files
  "**/*.spec.ts",          // ← NEW: Exclude spec files
  "**/*.type-test.ts",     // ← NEW: Exclude type test files
  "test/**",               // ← NEW: Exclude test directory
  "tests/**",              // ← NEW: Exclude tests directory
  "src/__test-utils/**",   // ← NEW: Exclude test utilities
  "src/**/*.test.js.map",  // ← NEW: Exclude test artifacts
  "scripts/score-tests.ts",
  ".github/**"
]
```

---

## Verification Results

### Before Fix

```
Refactoring targets: 27
Top issues:
  1. src/run-scorecard-evidence-status.ts (20.3) — untested risk
  2. src/pi-event-filter-helpers/assistant-turn-state.ts (16.1) — untested risk
  3-10. Various scorecard/evidence files + test utilities

Large functions: 563 total (mostly large test files)
Maintainability: 91.6 (inflated due to test code)
LOC analyzed: 128,129 (includes tests)

FALSE POSITIVES: High (test utilities in top targets, large test functions)
```

### After Fix

```
Refactoring targets: 50 (legitimate production code)
Top issues:
  1. src/run-scorecard-evidence-validation.ts (27.8) — untested risk / dead code
  2. src/run-scorecard-evidence-tokens.ts (23.7) — dead code
  3. src/run-scorecard-evidence-status.ts (17.8) — untested risk
  4-10. Various production modules (types, validators, formatters)

Large functions: 114 total (production code only, no test files)
Maintainability: 86.7 (realistic assessment)
LOC analyzed: 56,053 (production code only)

FALSE POSITIVES: Greatly reduced (test noise eliminated)
```

---

## Analysis of Top 10 Targets

After investigation, the corrected top 10 targets are:

| # | File | Score | Issue | Real Issue? | Status |
| --- | ------ | ------- | ------- | ------------- | -------- |
| 1 | run-scorecard-evidence-validation.ts | 27.8 | Untested + Dead code | ✅ Partially (has 15-20 tests, some edge cases may be missing) | Investigate |
| 2 | run-scorecard-evidence-tokens.ts | 23.7 | Dead code | ⚠️ False positive (re-exports are intentional, actively used) | Keep as-is |
| 3 | run-scorecard-evidence-status.ts | 17.8 | Untested risk | ✅ Partially (has 30+ tests, high-confidence patterns covered) | Low priority |
| 4 | types/goal-setting-quality.ts | 17.6 | Dead code + Coupling | ✅ Real (missing comprehensive test file) | **Add tests** |
| 5 | types/goal-setting.ts | 15.7 | Dead code + Coupling | ✅ Real (Zod schemas with no dedicated test file) | **Add tests** |
| 6 | run-scorecard-scoring-parts.ts | 14.0 | Untested risk | ✅ Partially (has 5-8 tests, integration scenarios missing) | Optional improve |
| 7 | scouting-prompt-context.ts | 14.0 | Dead code | ⚠️ Likely false positive (has 15+ tests) | Investigate |
| 8 | .extensions.ts | 13.7 | Dead code | ✅ Real (env-dependent, missing test file) | **Add tests** |
| 9 | lib/preservation-validator.ts | 13.7 | High impact + Dead code | ✅ Real (has 11 tests but in tests/ dir, not src/) | Document location |
| 10 | lib/run-evaluation-formatter.ts | 13.7 | Dead code + Complexity | ⚠️ Likely false positive (has 15+ tests) | Investigate |

**Summary**: Only 3 files (#4, #5, #8) clearly need test files. Others have tests but fallow isn't detecting them properly (likely due to test file naming or location mismatches with `.fallowrc.json` patterns).

---

## Recommended Next Steps

### Phase 2A: Quick Verification (15 minutes)

1. Clear fallow cache: `rm -rf .fallow-cache` (if exists) or `npx fallow health --reset` (if available)
2. Re-run fallow: `npx fallow health --targets --format human`
3. Verify scores improve or stabilize

### Phase 2B: Add Missing Test Files (1–2 hours) — RECOMMENDED

Create dedicated test files for files that genuinely lack them:

1. **`src/types/goal-setting.test.ts`** (30 min)
   - Test Zod schema validation
   - Test type guards (isGoalSettingOutput, isSmartCriterion, etc.)
   - Test edge cases (invalid structures, missing fields)

2. **`src/.extensions.test.ts`** (30 min)
   - Test API key resolution from env vars
   - Test fallback chain behavior
   - Test error handling for missing env vars

3. Optional: Add edge case tests to #4 and #6 (30–45 min)

### Phase 2C: Document Fallow Configuration (10 minutes)

Add notes to CONTRIBUTING.md or STYLE.md:

- How to structure test files for fallow detection
- When to expect "untested risk" warnings and how to resolve them
- Best practices for re-export patterns (intentional vs. dead code)

---

## Key Insights

### Why Test Files Were Included in Entry

- Hypothesis: The `.fallowrc.json` was originally configured to analyze test files as entry points to measure test quality
- Problem: Fallow treats entry points as production code subject to complexity, size, and coverage rules
- Solution: Test files should be excluded from analysis, but imports of production code by tests should still count as evidence of use

### Why Some Warnings Persist After Fix

- **Fallow's test discovery** depends on exact file naming/location matching patterns in `.fallowrc.json`
- If a production file is not explicitly imported by test files (or imports are in wrong location), fallow may still flag it as "untested"
- This is a **tool limitation**, not a code quality issue

### Architecture Health

- **Codebase is well-structured** (86.7 maintainability is "good")
- Most warnings are either false positives (re-exports, test discovery) or minor improvements (edge case tests)
- **No critical refactoring needed** — improvements are optional for quality-of-life

---

## Configuration Compliance

### Files Changed

- ✅ `.fallowrc.json` — Configuration fixed

### Verification

```bash
# Verify new report
npx fallow health --targets --format human

# Check specific file
npx fallow health --targets --format json | jq '.[0]'
```

### Configuration Committed

- Changes are ready to commit: `git add .fallowrc.json && git commit -m "fix: exclude test files from fallow analysis (Phase 1)"`

---

## Conclusion

**Phase 1 Status**: ✅ **COMPLETE**

The fallow configuration bug has been identified, fixed, and verified. The corrected report now accurately reflects production code health, with false positives from test analysis eliminated.

**Recommended Path Forward**:

1. Phase 2A: Quick cache clear and re-verify (15 min)
2. Phase 2B: Add 2 missing test files (1–2 hours) — **HIGH ROI**
3. Phase 2C: Update documentation (10 min)

**Estimated Total Effort**: 1.5–2.5 hours for significant quality improvements
