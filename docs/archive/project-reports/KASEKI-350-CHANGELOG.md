# Kaseki-350 Implementation Changelog

## Changes Applied: September 2026

### Change 1: Scouting Prompt Template - Base Guidance

**File**: `templates/scouting/base.txt`  
**Lines**: 50-65 (critical_change_expectations section)  
**Type**: Documentation & Guidance Improvement

**Before**:
```
critical_change_expectations: {
  required_files: ["list of files that will definitely need changes"],
  required_search_strings: ["patterns that must appear in the diff"],
  forbidden_empty_diff: false
}
```

**After**:
```
critical_change_expectations: {
  required_files: ["list of files that will definitely need changes"],
  required_search_strings: ["patterns that must appear in the diff"],
  forbidden_empty_diff: false
}

⚠️ CRITICAL GUIDANCE for required_files:
- must list ONLY files that your analysis determined MUST be modified
- Omit file if: it already has correct code and needs no edits
- Do NOT include files that are "relevant" but don't need changes
- Contract: All files in required_files MUST appear in changed-files.txt

CORRECT EXAMPLE: If ui/constants.ts already exports weights with correct values
→ only required_files: ["src/game/orchestrator.ts"]

INCORRECT EXAMPLE: Listing files that are "relevant" but already correct
```

**Rationale**: Prevents scouting from over-specifying files that don't need changes.

---

### Change 2: Scouting Prompt Template - Common Guidelines

**File**: `templates/scouting/common.txt`  
**Lines**: 17-29 (critical_change_expectations guideline section)  
**Type**: Clarification & Examples

**Before**:
```
## critical_change_expectations guidelines
Specifies the contract that changed-files.txt must satisfy:
- required_files: Files that must be in the diff
- required_search_strings: Patterns that must appear in the diff
- forbidden_empty_diff: If true, diff must not be empty
```

**After**:
```
## critical_change_expectations guidelines
Specifies the contract that changed-files.txt must satisfy:
- required_files: Files that MUST be modified (will be checked against changed-files.txt)
- required_search_strings: Patterns that must appear in the diff
- forbidden_empty_diff: If true, diff must not be empty

DISTINCTION - Verification vs. Modification:
- Verification: "Does this file already satisfy the requirement?" (don't list in required_files)
- Modification: "Does this file NEED to be changed?" (list only these in required_files)

Common Pattern:
- If target file already exists and has correct values → NO change needed
- Only list in required_files if the file MUST be modified
- Incorrect pattern: Listing files that are 'relevant' but already correct
```

**Rationale**: Better teaches distinction between checking files and modifying them.

---

### Change 3: Goal-Check Override Logic

**File**: `kaseki-agent.sh`  
**Location**: finish() function, lines 3519-3533  
**Type**: Runtime Logic - False Positive Prevention

**Before**:
```bash
  # Phase 3B, 3C, 3D: Consolidate artifacts before finalizing
  maybe_call_finish_helper write_failure_json "$STATUS"
  maybe_call_finish_helper write_repo_memory_summary
  finalize_artifacts_and_publish_status "${KASEKI_RESULTS_DIR}" write_metadata "$STATUS" "${VALIDATION_TIMINGS_FILE}" "${PRE_VALIDATION_TIMINGS_FILE}"
  maybe_call_finish_helper remove_low_value_artifacts
  if [ "$KASEKI_REPO_SESSION_ACTIVE" = "1" ] && [ "$(cat "$KASEKI_REPO_SESSION_MARKER" 2>/dev/null || true)" = "${BASHPID:-$$}" ]; then
    rm -f "$KASEKI_REPO_SESSION_MARKER"
  fi
  exit "$STATUS"
```

**After**:
```bash
  # Phase 3B, 3C, 3D: Consolidate artifacts before finalizing
  maybe_call_finish_helper write_failure_json "$STATUS"
  maybe_call_finish_helper write_repo_memory_summary
  
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
  
  finalize_artifacts_and_publish_status "${KASEKI_RESULTS_DIR}" write_metadata "$STATUS" "${VALIDATION_TIMINGS_FILE}" "${PRE_VALIDATION_TIMINGS_FILE}"
  maybe_call_finish_helper remove_low_value_artifacts
  if [ "$KASEKI_REPO_SESSION_ACTIVE" = "1" ] && [ "$(cat "$KASEKI_REPO_SESSION_MARKER" 2>/dev/null || true)" = "${BASHPID:-$$}" ]; then
    rm -f "$KASEKI_REPO_SESSION_MARKER"
  fi
  exit "$STATUS"
```

**Logic Explanation**:
```
IF:
  - Run failed with exit 8 (critical_change_expectations_failed)
  - AND goal-check evaluator passed (GOAL_CHECK_MET="true")
  - AND failure was specifically "required file missing"
THEN:
  - Emit diagnostic events (progress + error event)
  - Log reason to stderr for troubleshooting
  - Override STATUS to 0 (success)
  - Clear FAILED_COMMAND to reflect success
ELSE:
  - Keep original failure status
  - Continue to finalize with actual exit code
```

**Conditions Checked**:
1. `STATUS -eq 8` — Critical change expectations failed (specific exit code)
2. `GOAL_CHECK_MET = "true"` — Task semantically validated as complete
3. `CRITICAL_CHANGE_FAILURE_REASON` contains "required file missing" — Failure type is file-list mismatch only

**Rationale**: 
- Semantic validation (goal-check) is authoritative when syntactic contract (file-list) is wrong
- Prevents false negatives when scouting over-specifies files
- Maintains safety by only overriding file-list mismatches, not other critical change issues
- Provides diagnostic logging for understanding why override occurred

**Output Effects**:
- Exit code: 8 → 0
- Metadata: Records override event in metadata.json phases
- Logs: `progress.jsonl` includes override message
- Stderr: Diagnostic messages explain the override
- Events: critical_change_override event emitted with reason

---

## Verification

### Syntax Validation ✅
```bash
$ bash -n kaseki-agent.sh
(no output = syntax OK)
```

### File Existence ✅
- templates/scouting/base.txt — EXISTS, READABLE
- templates/scouting/common.txt — EXISTS, READABLE
- kaseki-agent.sh — EXISTS, READABLE, EXECUTABLE

### Logic Verification ✅
- Override condition checks all three constraints before executing
- STATUS and CRITICAL_CHANGE_FAILURE_REASON variables are set before override
- Override occurs before write_metadata, so metadata reflects final status
- emit_progress and emit_event functions are available at this point in script

---

## Impact Analysis

### No Breaking Changes
- Override only applies to very specific scenario (exit 8 + goal-check met + file-list mismatch)
- Default behavior unchanged for all other exit codes
- Default behavior unchanged when goal-check fails
- Default behavior unchanged for other critical change failures

### Backward Compatibility
- Existing runs without goal-check: Exit 8 preserved (status unchanged)
- Existing runs with goal-check: Override enables success when task is semantically complete

### New Behavioral Paths
```
Old Path:
  exit 8 → failure (always)

New Path:
  exit 8 + goal-check met + file-list mismatch → override to exit 0
  exit 8 + goal-check not met → failure (unchanged)
  exit 8 + other critical change failure → failure (unchanged)
```

---

## Related Files Not Modified

The following files were analyzed but not modified:

1. **kaseki-agent.sh** (lines 1248-1252) — Validation pipeline
   - Finding: Already correct (normalize before validate)
   - Action: No changes needed

2. **scripts/scouting-allowlist.ts** — Validation schema
   - Finding: Schema matches actual artifact
   - Action: No changes needed

3. **docs/** — Documentation
   - Action: Pending updates (see KASEKI-350-FIX-SUMMARY.md)

---

## Testing Recommendations

### Scenario 1: Override Applied
```bash
# Setup kaseki-350 scenario
TASK="Consolidate duplicate arrays DRY refactoring"
SCOUTING="required_files: [src/ui/constants.ts, src/game/orchestrator.ts]"
AGENT_RESULT="changed-files: src/game/orchestrator.ts only"
GOAL_CHECK="meet"

# Expected: exit 0 with override diagnostic
```

### Scenario 2: Override NOT Applied (Goal-Check Failed)
```bash
# Same setup but
GOAL_CHECK="not_met"

# Expected: exit 8 (failure preserved)
```

### Scenario 3: Override NOT Applied (Different Failure)
```bash
# Setup empty diff scenario
SCOUTING="forbidden_empty_diff: true"
AGENT_RESULT="empty diff"
GOAL_CHECK="meet"

# Expected: exit 8 (other critical change failures not overridden)
```

---

## Deployment Notes

1. **Rollout**: Can be deployed immediately with no breaking changes
2. **Rollback**: Revert kaseki-agent.sh lines 3519-3533 to restore old behavior
3. **Monitoring**: Watch for critical_change_override events in metadata to understand override frequency
4. **Tuning**: If overrides become too frequent, improve scouting prompts further (Fix #1)

---

## Summary of Changes

| Component | File | Lines | Type | Status |
|-----------|------|-------|------|--------|
| Scouting Guidance | templates/scouting/base.txt | 50-65 | Docs | ✅ Implemented |
| Scouting Clarification | templates/scouting/common.txt | 17-29 | Docs | ✅ Implemented |
| Override Logic | kaseki-agent.sh | 3519-3533 | Code | ✅ Implemented |

**Total Lines Changed**: ~50  
**Files Modified**: 3  
**Syntax Status**: ✅ Valid  
**Tests Needed**: ✅ Recommended  
**Documentation Updates**: ✅ Pending  

