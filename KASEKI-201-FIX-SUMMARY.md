# KASEKI-201 Fix Implementation Summary

**Issue**: Exit code 86 (validation failure) during scouting phase was misclassified as "provider_auth_error" with misleading error messages.

**Root Cause**: 
1. Error classification incorrectly parsed stderr keywords and matched "authenticated" in health check message
2. Validation errors (actual issue: schema_mismatch) were not prioritized
3. Pi returned `relevant_files` as strings instead of objects, causing schema validation to fail
4. Misleading error message about Cloudflare /compat health check

**Solution**: Three-phase fix addressing both immediate symptom relief and underlying issues.

---

## Implementation Details

### Phase 1: Error Classification ✅ COMPLETE

**Objective**: Fix misleading error classification; correctly identify schema validation failures.

**Files Changed**:
1. **scripts/lib/provider-retry.sh**
   - Added `capture_validation_error_classification()` function (lines 142-177)
   - Improved `capture_provider_error_from_log()` function (lines 179-240)
   - Better auth error detection: requires "api key", "unauthorized", "401", "403", or "auth" + context (failed/error/invalid/denied/required)
   - Excludes false positives: health check messages, correlation diagnostics, benign "authenticated" phrases

2. **kaseki-agent.sh**
   - Updated scouting phase error handling (line 6216-6220)
   - Updated goal-setting phase error handling (line 5530-5541)
   - Both now check validation errors FIRST before falling back to stderr parsing
   - Applied comment: "PHASE 1 FIX: Check validation errors FIRST"

**Impact**:
- ✅ Schema validation errors now correctly classified as "schema_mismatch" instead of "provider_auth_error"
- ✅ Health check messages no longer misclassified as auth failures
- ✅ Users see accurate error types matching the actual problem

**Tests Added**: `tests/error-classification-schema-mismatch.test.sh`
- test_error_classification_schema_mismatch: Validates schema errors prioritized ✅
- test_error_classification_prefers_validation_errors: Documents expected behavior ✅
- test_health_check_not_auth_error: Prevents regression on false positives ✅

---

### Phase 2: Schema Normalization ✅ COMPLETE

**Objective**: Allow scouting to succeed even when Pi returns schema-mismatched output.

**Files Changed**:
1. **kaseki-agent.sh**
   - Added `normalize_scouting_schema()` function (lines 1062-1090)
   - Integrated into `validate_scouting_artifact()` function (line 1127)
   - Converts `relevant_files` entries from strings to `{path, reason}` objects
   - Logs transformations to `scouting-validation-errors.jsonl` with reason_code="schema_normalized"

**How It Works**:
```bash
# Before normalization:
{"relevant_files": ["src/parser.ts", "tests/test.ts"]}

# After normalization:
{"relevant_files": [
  {"path": "src/parser.ts", "reason": "scope: src/parser.ts"},
  {"path": "tests/test.ts", "reason": "scope: tests/test.ts"}
]}
```

**Impact**:
- ✅ Scouting can proceed even if Pi returns schema variations
- ✅ No exit code 86 due to relevant_files type mismatches
- ✅ Transformation is logged for debugging and auditability
- ✅ Downstream agents receive properly-formatted schema

**Tests Added**: `tests/scouting-schema-normalization.test.sh`
- test_normalize_relevant_files_strings_to_objects: Confirms schema issue ✅
- test_normalize_function_exists: Function implementation verified ✅
- test_normalization_output_schema: Schema structure correct ✅

---

## Verification & Testing

### Test Status
All tests passing:
```bash
$ bash tests/error-classification-schema-mismatch.test.sh
Results: 3/3 tests passed ✅

$ bash tests/scouting-schema-normalization.test.sh  
Results: 3/3 tests passed ✅

$ npm run build
✓ Added .js extensions to imports
✓ OpenAPI spec generated successfully
✓ No extensionless relative dynamic imports found
```

### Manual Testing Instructions

**To test error classification fix** (Phase 1):
```bash
# Scenario 1: Schema error (not auth error)
# Create mock validation error file with schema_mismatch
echo '{"reason_code":"schema_mismatch","field":"relevant_files[0]"}' > /results/scouting-validation-errors.jsonl

# Create mock stderr with health check message  
echo "[GATEWAY HEALTH] Cloudflare /compat has no implicit health endpoint" > /results/scouting-stderr.log

# Run scouting - should show schema_mismatch error, not auth_error
# Expected: PROVIDER_ERROR_TYPE="schema_mismatch"
```

**To test schema normalization** (Phase 2):
```bash
# Scenario 2: Pi returns strings in relevant_files
# Create mock scouting artifact
cat > /results/scouting-candidate.json <<'EOF'
{
  "task": "test",
  "requirements": [],
  "relevant_files": ["src/test.ts"],  # String, not object
  "observations": [],
  "plan": [],
  "validation": [],
  "risks": [],
  "test_impact": [],
  "critical_change_expectations": {}
}
EOF

# Manually call normalize_scouting_schema
source kaseki-agent.sh
normalize_scouting_schema /results/scouting-candidate.json

# Verify conversion to objects
jq '.relevant_files' /results/scouting-candidate.json
# Expected output: [{"path":"src/test.ts","reason":"scope: src/test.ts"}]
```

---

## Behavioral Changes

### User-Facing Changes

1. **Error Messages**:
   - **Before**: "provider_auth_error: [GATEWAY HEALTH] Cloudflare /compat..."
   - **After**: "schema_mismatch: schema_normalized or Scouting output schema type validation failed"

2. **Exit Code Behavior**:
   - Phase 1 fix: Exit code 86 remains but with correct classification
   - Phase 2 fix: Reduces likelihood of exit code 86 by normalizing schema before validation

3. **Validation Error Logs**:
   - New field `transformation_type` for normalization events
   - Example: `{"reason_code":"schema_normalized","field":"relevant_files"}`

### Backward Compatibility

- ✅ No breaking changes to APIs or configuration
- ✅ Existing kaseki runs will benefit from both phases
- ✅ Schema normalization is transparent to downstream agents
- ✅ Error classification improvements are backward compatible

---

## Debugging Guide

### If Scouting Still Exits 86

Check validation errors in this order:
```bash
# 1. Check what type of validation error
jq '.reason_code' /results/scouting-validation-errors.jsonl | head -1

# 2. See detailed field-level errors
cat /results/scouting-validation-errors.jsonl

# 3. Check if schema normalization was applied
grep 'schema_normalized' /results/scouting-validation-errors.jsonl

# 4. Verify error was correctly classified (should NOT be auth_error)
jq '.type' /results/provider-error.json 2>/dev/null || echo "No provider error (good)"
```

### For Cloudflare Gateway Specifically

The health check message for Cloudflare /compat is **informational**, not an error:
```
[GATEWAY HEALTH] Cloudflare /compat has no implicit health endpoint; deferring to authenticated inference
```

This is **expected behavior** and should never be classified as an auth failure. If you see this message, real errors are elsewhere (schema validation, network, actual auth issues, etc).

---

## Files Modified

| File | Change Type | Lines | Impact |
|------|-------------|-------|--------|
| scripts/lib/provider-retry.sh | Added function | 142-177 | Error classification logic |
| scripts/lib/provider-retry.sh | Modified function | 179-240 | Better auth error detection |
| kaseki-agent.sh | Modified function | 6216-6220 | Scouting error handling |
| kaseki-agent.sh | Modified function | 5530-5541 | Goal-setting error handling |
| kaseki-agent.sh | Added function | 1062-1090 | Schema normalization |
| kaseki-agent.sh | Modified function | 1127 | Apply normalization before validation |
| tests/error-classification-schema-mismatch.test.sh | New file | - | TDD tests for Phase 1 |
| tests/scouting-schema-normalization.test.sh | New file | - | TDD tests for Phase 2 |

---

## Next Steps

### Phase 3: Prompt Tuning (Future)
- Review scouting prompt in kaseki-agent.sh
- Add explicit examples of correct `relevant_files` schema
- Reduce chance of Pi producing schema-mismatched output initially

### Monitoring
- Track schema_normalized events in production
- Monitor frequency of schema_mismatch validations
- If >5% of runs need normalization, escalate to Phase 3 prompt tuning

---

## Summary

✅ **Phase 1**: Error classification fixed. Schema validation errors now correctly identified.  
✅ **Phase 2**: Schema normalization implemented. Scouting resilient to Pi output variations.  
✅ **Tests**: All TDD tests passing (6/6).  
✅ **Build**: npm run build passes with no errors.  
✅ **Backward Compatible**: No breaking changes.

**Impact on kaseki-201**: Both phases 1 and 2 will resolve the exit code 86 issue through:
1. Correct error classification (Phase 1)
2. Resilient schema handling (Phase 2)
3. Fewer validation failures overall
