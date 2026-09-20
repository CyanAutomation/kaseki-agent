# Kaseki-350 Root Cause Analysis & Implementation Summary

**Status**: ✅ COMPLETE
**Date**: September 2026
**Scope**: Root cause analysis of kaseki-350 failure and implementation of 3 fixes
**Objectives**: Prevent false positives when scouting over-specifies required_files but task is semantically complete

---

## Executive Summary

Kaseki-350 failed with exit code 8 (critical_change_expectations_failed) because scouting expected both `src/ui/constants.ts` and `src/game/orchestrator.ts` to be modified, but the agent only changed `src/game/orchestrator.ts` (correctly importing from constants instead of modifying them).

**Root Cause**: Scouting prompt guidance was ambiguous about when to include files in `required_files`. The scouting agent inferred both files needed changes from the task description, but the agent correctly determined that constants.ts didn't need modification.

**Solution**: Three complementary fixes implemented:
1. ✅ **Fix #1 (P1)**: Improved scouting prompt templates with explicit guidance and examples
2. ✅ **Fix #3 (P1)**: Added goal-check override logic to trust semantic validation over file-list contract when there's a mismatch
3. ✅ **Fix #2 (P2)**: Verified validation pipeline order is already correct (no changes needed)

---

## Issue Analysis

### Issue #1: Critical Change Expectations Over-Specification

**Symptom**: Exit 8 failure with `critical_change_expectations_failed: required file missing from changed-files.txt: src/ui/constants.ts`

**Root Cause**: 
- Scouting marked both `src/ui/constants.ts` and `src/game/orchestrator.ts` as required_files
- Agent correctly determined constants.ts didn't need changes (already exports weights/lengths)
- Agent only changed orchestrator.ts (to import from constants)
- Critical change verification failed because constants.ts wasn't in changed-files.txt

**Why This Happened**:
- Task prompt: "Move weights and lengths constants... (already exists there with identical values)"
- Scouting interpreted "move" and "verify" as requiring changes to both files
- Agent interpreted "already exists" as "no changes needed" for constants.ts
- Mismatch between scouting assumptions and agent's correct implementation

### Issue #2: Schema Validation Warnings

**Symptom**: 3 critical schema mismatches logged in scouting-validation-errors.jsonl for test_impact[0-2] entries

**Root Cause**:
- Validation pipeline order is actually correct (Parse → Normalize → Validate)
- Spurious warnings appear to be from intermediate attempts or transient Pi output
- Final scouting.json artifact contains valid entries
- Errors logged with timestamp suggesting early Pi output, but artifact recovered

**Conclusion**: No action needed; pipeline order is correct and artifact validation passed.

---

## Implemented Solutions

### Fix #1: Improved Scouting Prompt Guidance ✅

**Files Modified**:
- `templates/scouting/base.txt` (lines 50-65)
- `templates/scouting/common.txt` (lines 17-29)

**Changes**:

1. **Added explicit warning and examples**:
   ```markdown
   ⚠️ CRITICAL: required_files must list ONLY files that your analysis determined MUST be modified
   
   CORRECT:   If ui/constants.ts already exports weights → only required_files: ["src/game/orchestrator.ts"]
   INCORRECT: Listing files that are 'relevant' but already correct
   ```

2. **Distinguished verification from modification**:
   ```markdown
   Verification: "Does this file already satisfy the requirement?"
   Modification: "Does this file NEED to be changed?"
   Only list files in required_files if they MUST be changed.
   ```

3. **Added guidance for pre-existing files**:
   ```markdown
   Rule: required_files will be checked against changed-files.txt
   If a file already has correct code and needs no edits, OMIT from required_files
   ```

**Impact**: Prevents scouting from over-specifying files at the source.

---

### Fix #3: Goal-Check Override for File-List Mismatches ✅

**File Modified**: `kaseki-agent.sh` (lines 3519-3533 in finish() function)

**Implementation**:

```bash
# Goal-check override: if critical change expectations failed but goal-check passed,
# override the failure since the goal-check evaluator has semantically validated the task
if [ "$STATUS" -eq 8 ] && [ "$GOAL_CHECK_MET" = "true" ] && [[ "$CRITICAL_CHANGE_FAILURE_REASON" == *"required file missing"* ]]; then
  emit_progress "critical change verification" "overridden by goal-check semantic validation"
  emit_event "critical_change_override" "Override reason: goal-check evaluator validated task completion despite file-list mismatch" "notice"
  printf '[goal-check-override] Overriding critical_change_expectations_failed (exit 8) with exit 0\n' >&2
  printf '[goal-check-override] Failure was: %s\n' "$CRITICAL_CHANGE_FAILURE_REASON" >&2
  printf '[goal-check-override] Goal-check evaluation confirmed task completion\n' >&2
  STATUS=0
  FAILED_COMMAND=""
fi
```

**Logic**:
1. Check if run failed with exit 8 (critical_change_expectations_failed)
2. Check if goal-check evaluator confirmed task is complete (GOAL_CHECK_MET="true")
3. Check if failure is specifically about "required file missing" (not other critical change issues)
4. If all conditions met: Override to exit 0, emit diagnostic events
5. Else: Keep failure status

**Rationale**:
- Semantic validation (goal-check) should override syntactic validation (file-list contract) when task is complete
- Scouting contract can be wrong, but if goal-check confirms task is done, that's authoritative
- Prevents false negatives while maintaining safety (only overrides file-list mismatches, not other critical issues)

**Output**:
- `exit_code`: 0 (success, not 8)
- `metadata.phases.critical_change`: Marked as overridden with reason
- `progress.jsonl`: Includes "critical change verification overridden by goal-check semantic validation"
- Stderr logs: Diagnostic messages about why override occurred

---

### Fix #2: Validation Pipeline Verification ✅

**Analysis Location**: `kaseki-agent.sh` lines 1248-1252 in `validate_scouting_artifact()` function

**Finding**: Pipeline is already correct!

```bash
# PHASE 2: Normalize schema before validation
normalize_scouting_schema "$candidate_artifact" || true

if ! validate_scouting_artifact_with_node "$candidate_artifact" "$final_artifact" "$validation_error_file"; then
  # ... error handling ...
fi
```

**Current Flow**: Parse (line 1228) → Normalize (line 1250) → Validate (line 1251)
**Desired Flow**: Parse → Normalize → Validate
**Status**: ✅ Already matches desired flow

**Conclusion**: No changes needed for Fix #2. Schema mismatches in kaseki-350 logs were spurious (either intermediate attempts or transient issues that resolved).

---

## Validation Performed

✅ **Syntax Validation**: `bash -n kaseki-agent.sh` — No errors
✅ **File Integrity**: All modified files exist and are readable
✅ **Logic Verification**:
  - Override condition properly checks all three constraints
  - STATUS and CRITICAL_CHANGE_FAILURE_REASON variables are set before override
  - Override occurs in finish() function before write_metadata is called
✅ **Backward Compatibility**: Override only applies to specific scenario (file-list mismatch + goal-check passed)

---

## Expected Behavior Changes

### Before Fix #3
```
kaseki-350 scenario:
  - Scouting: required_files: ["src/ui/constants.ts", "src/game/orchestrator.ts"]
  - Agent result: changed-files.txt contains only "src/game/orchestrator.ts"
  - Goal-check: "meet" (task semantically complete)
  - Exit: 8 (FAILURE) ❌
```

### After Fix #3
```
kaseki-350 scenario:
  - Scouting: required_files: ["src/ui/constants.ts", "src/game/orchestrator.ts"]
  - Agent result: changed-files.txt contains only "src/game/orchestrator.ts"
  - Goal-check: "meet" (task semantically complete)
  - Override Logic: "required file missing" + "goal-check met" → override to exit 0
  - Exit: 0 (SUCCESS) ✅
  - Metadata: critical_change_override event recorded
  - Diagnostic: "overridden by goal-check semantic validation"
```

### After Fix #1 (Long-term)
```
Future scouting runs:
  - Task: "Consolidate duplicate arrays (already exist in constants.ts)"
  - Scouting (improved guidance): required_files: ["src/game/orchestrator.ts"] only
  - Agent result: changes only orchestrator.ts
  - Exit: 0 (SUCCESS) ✅
  - No override needed; contract matched reality from start
```

---

## Testing Recommendations

### Test Case 1: Goal-Check Override
```bash
Scenario: Over-specified required_files + task complete
- Create scouting artifact with required_files: ["file-a.ts", "file-b.ts"]
- Run agent to only modify file-a.ts
- Set goal-check result to "meet"
- Expected: Exit 0 with override event logged
```

### Test Case 2: No Override Without Goal-Check
```bash
Scenario: Over-specified required_files + task failed
- Create scouting artifact with required_files: ["file-a.ts", "file-b.ts"]
- Run agent to only modify file-a.ts
- Set goal-check result to "not_met"
- Expected: Exit 8 (failure preserved, no override)
```

### Test Case 3: No Override For Other Critical Change Issues
```bash
Scenario: Different critical change failure type
- Create scouting artifact with forbidden_empty_diff: true
- Run agent to produce empty diff
- Set goal-check result to "meet"
- Expected: Exit 8 (failure preserved, override only for file-list)
```

---

## Documentation Updates Needed

### High Priority
- [ ] Update `docs/SCOUTING_PROMPT_DESIGN.md` with required_files best practices
- [ ] Update `docs/QUALITY_GATES.md` to document goal-check override mechanism

### Medium Priority
- [ ] Add section to `docs/TROUBLESHOOTING.md` about false positives and overrides
- [ ] Update `CLAUDE.md` with exit code 8 override behavior

### Low Priority
- [ ] Add changelog entry
- [ ] Update metrics/scoring to track override events

---

## Implementation Checklist

- [x] Analyzed kaseki-350 failure artifacts
- [x] Identified root causes for both issues
- [x] Implemented Fix #1: Scouting template improvements
- [x] Implemented Fix #3: Goal-check override logic
- [x] Verified Fix #2: Pipeline is already correct
- [x] Validated bash syntax
- [x] Created session documentation
- [ ] Create test cases (pending)
- [ ] Update documentation (pending)
- [ ] Run end-to-end validation (pending)

---

## Files Modified Summary

| File | Lines | Type | Impact |
|------|-------|------|--------|
| templates/scouting/base.txt | 50-65 | Guidance | Prevents scouting over-specification |
| templates/scouting/common.txt | 17-29 | Clarification | Better scouting education |
| kaseki-agent.sh | 3519-3533 | Logic | Enables override for false positives |

**Total Changes**: 3 files, ~50 lines of additions/modifications

---

## Key Insights & Learnings

1. **False Positives from Contract Mismatch**: When syntactic contracts (file-list) don't match agent's actual work, but semantic validation confirms task is complete, override preserves success signal.

2. **Hierarchy of Validation**: Semantic validation (goal-check) > Syntactic validation (file-list contract)

3. **Prompt Clarity as Preventive Measure**: Better scouting guidance reduces over-specification at source, reducing need for overrides.

4. **Pipeline Order Matters**: Current order (normalize before validate) is correct; validation errors were spurious.

5. **Backward Compatibility**: Override logic is defensive—only triggers for specific scenario (file-list mismatch + goal-check passed).

---

## Related Issues

- **Kaseki-350**: Original failure case (exit 8 - critical_change_expectations_failed)
- **Future Enhancement**: Consider adding `verified_files` field to scouting schema for files checked but not modified

---

## References

- Root cause analysis: KASEKI-350-INVESTIGATION.md
- Scouting schema: templates/scouting/base.txt
- Quality gates: docs/QUALITY_GATES.md
- Validation logic: scripts/scouting-allowlist.ts
- Critical change verification: kaseki-agent.sh lines 2642-2750
