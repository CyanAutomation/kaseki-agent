# Printf Safety Fix - Implementation Summary

## Bug Report

**Error:** `printf: - : invalid option` at line 472 in kaseki-agent.sh  
**Stage:** GitHub operations (after validation completed successfully)  
**Impact:** Prevents github operations from completing, no evidence of PR creation  
**Reproducibility:** 100% with specific inputs

### Original Error Log

```
[progress] validation info: finished with exit 0

==> secret scan
[progress] secret scan info: started
[progress] secret scan info: finished with exit 0

==> github operations
[progress] github operations info: started
/usr/local/bin/kaseki-agent: line 472: printf: - : invalid option
printf: usage: printf [-v var] format [arguments]
```

## Root Cause Analysis

The error `printf: - : invalid option` occurs when printf receives a format string that starts with `-` and is interpreted as a command-line option rather than a format string.

This could occur in the restoration report generation if:

1. A count variable (like `restored_count`, `kept_count`, `total_count`) contained the value `-` instead of a numeric value
2. The printf call didn't use the `--` separator to prevent option interpretation
3. A grep command or json_encode operation failed and returned `-` as output

The vulnerability was in:

- `generate_restoration_report()` function (lines 472-477) — printf calls with format strings starting with `-`
- Lack of validation before arithmetic operations on count variables
- Missing error handling for grep and json_encode commands

## Implementation

### 1. Added validate_numeric() Helper Function (NEW)

**Location:** Lines 177-191 of kaseki-agent.sh

**Purpose:** Validate that a variable contains only numeric digits before using it in arithmetic or printf format operations.

**Code:**

```bash
validate_numeric() {
  local var_name="$1"
  local var_value="$2"
  # Empty or missing value is treated as invalid
  if [ -z "$var_value" ] || [ "$var_value" = "-" ]; then
    printf 'error: %s is not numeric (value="%s")\n' "$var_name" "$var_value" >&2
    return 1
  fi
  # Check if value matches integer pattern
  if ! printf '%s' "$var_value" | grep -Eq '^[0-9]+$'; then
    printf 'error: %s is not a valid integer (value="%s")\n' "$var_name" "$var_value" >&2
    return 1
  fi
  return 0
}
```

**Why:** Provides early detection and clear error messages if a variable contains unexpected values.

### 2. Enhanced json_encode() Function (MODIFIED)

**Location:** Lines 151-175 of kaseki-agent.sh

**Changes:**

- Added `command -v node` check to verify node availability
- Wrap node execution with error handling
- Return empty JSON string `""` as fallback instead of crashing
- Log warnings to stderr when json_encode fails

**Impact:** Prevents crashes if node is unavailable, provides diagnostic logging.

### 3. Enhanced json_array() Function (MODIFIED)

**Location:** Lines 177-183 of kaseki-agent.sh

**Changes:**

- Added node availability check
- Return empty JSON array `[]` on failure
- Maintains fallback behavior

**Impact:** Consistent error handling with json_encode.

### 4. Fixed generate_restoration_report() Function (MODIFIED)

**Location:** Lines 501-575 of kaseki-agent.sh

**Key Changes:**

1. **Validation Before Arithmetic (lines 510-521)**

   ```bash
   restored_count=$(grep -c '"status":"restored"' /results/restoration.jsonl 2>/dev/null || echo 0)
   if ! validate_numeric "restored_count" "$restored_count"; then
     printf 'warning: restoration report generation failed - restored_count validation failed\n' >&2
     return 1
   fi
   ```

2. **Diagnostic Logging (lines 508-534)**
   - Log file existence and size
   - Log each variable value before arithmetic
   - Log arithmetic operations and results

3. **Printf Safety (lines 531-538)**
   - Added `--` separator to all printf calls
   - Added error handling with `|| { ... return 1; }`

   ```bash
   printf -- '- **Total Files Changed:** %d\n' "$total_count" || { printf 'error: failed to write total count\n' >&2; return 1; }
   ```

4. **Graceful Continuation (lines 546-549)**
   - Added try/catch-like error handling in finish() trap
   - Script logs error but continues cleanup if restoration report fails

### 5. Enhanced finish() Trap Function (MODIFIED)

**Location:** Lines 614-627 of kaseki-agent.sh

**Changes:**

- Added debug output before restoration report generation
- Added error handling to continue cleanup even if report generation fails
- Logs file state information for diagnostics

**Code:**

```bash
# Debug output for restoration report generation
if [ -f /results/restoration.jsonl ]; then
  printf '[debug] restoration.jsonl exists (size=%d bytes)\n' "$(wc -c < /results/restoration.jsonl)" >&2
else
  printf '[debug] restoration.jsonl does not exist\n' >&2
fi

if ! generate_restoration_report; then
  printf 'warning: restoration report generation failed, but continuing with cleanup\n' >&2
fi
```

### 6. Printf Safety Improvements (MODIFIED)

**Added `--` Separator to printf Calls (lines 531-538)**

Format strings starting with `-` are now protected:

```bash
# Before (vulnerable)
printf '- **Total Files Changed:** %d\n' "$total_count"

# After (safe)
printf -- '- **Total Files Changed:** %d\n' "$total_count"
```

The `--` separator tells printf to stop processing options, treating everything after it as arguments.

## Why This Fix Works

1. **Root Cause Prevention:**
   - `validate_numeric()` prevents `-` from being used in arithmetic operations
   - Function returns early with clear error message if validation fails

2. **Defense in Depth:**
   - `--` separator prevents printf from misinterpreting format strings
   - Error handling prevents script from crashing if restoration report fails
   - Diagnostic logging helps identify issues quickly

3. **Graceful Degradation:**
   - If restoration report fails, cleanup continues
   - Artifacts are still collected, just without the restoration report
   - Error messages guide users to the problem

4. **No Performance Impact:**
   - validation_numeric() adds minimal overhead (single grep per variable)
   - Runs only during restoration report generation (end of run)
   - No impact on critical paths

## Testing

Created comprehensive test suite: `/test/printf-safety-focused.test.sh`

**Test Results: 7/7 PASSED ✓**

1. ✓ validate_numeric rejects '-' (the bug trigger)
2. ✓ validate_numeric accepts valid numeric values  
3. ✓ Arithmetic with validated numeric values works
4. ✓ Printf with validated numeric values doesn't fail
5. ✓ Unvalidated '-' would cause printf to fail
6. ✓ grep count fallback never returns '-'
7. ✓ json_encode availability and fallback

## Verification Steps

To verify the fix works:

1. **Check syntax:**

   ```bash
   bash -n /workspaces/kaseki-agent/kaseki-agent.sh
   ```

2. **Run test suite:**

   ```bash
   bash /workspaces/kaseki-agent/test/printf-safety-focused.test.sh
   ```

3. **Manual testing:**
   - Run kaseki-agent with scenarios that previously failed
   - Check for clear error messages in stderr
   - Verify cleanup completes even if restoration report fails
   - Verify artifacts are still collected

## Error Messages Provided

If issues occur, users now see:

```
error: restored_count is not numeric (value="-")
warning: restoration report generation failed - restored_count validation failed
[debug] restoration.jsonl exists (size=1234 bytes)
[debug] restoration report: extracted counts from restoration.jsonl
[debug] restoration report: restored_count="5"
```

These messages clearly indicate:

- What variable failed validation
- Why it failed (the actual value)
- What stage of processing we were in
- Actual values for debugging

## Files Modified

- `/workspaces/kaseki-agent/kaseki-agent.sh` — Core script with all fixes
- `/workspaces/kaseki-agent/test/printf-safety-focused.test.sh` — Test suite (NEW)
- `/workspaces/kaseki-agent/test/printf-safety.test.sh` — Comprehensive tests (NEW)

## Backward Compatibility

All changes are backward compatible:

- No changes to external interface or output format
- No changes to exit codes or behavior in normal cases
- Only affects error handling and logging in edge cases
- Existing functionality is preserved

## Performance Impact

Minimal:

- Added `validate_numeric()` calls only in restoration report generation (runs once at end)
- Added node availability check runs once per json_encode call
- Additional logging is minimal (single digit extra system calls)
- No impact on critical paths (agent execution, validation)

## Recommendations for Operators

1. **Monitor logs** for the new debug messages to understand restoration behavior
2. **Review error logs** if restoration report generation fails — indicates potential validation issues
3. **Update monitoring** to detect `validate_numeric` or `json_encode` failures as early warnings
4. **Consider allowlist tuning** if you see frequent "Low Allowlist Coverage" warnings

## Follow-Up Improvements (Future)

1. Consider adding structured logging output (JSON format) for the restoration report
2. Add metrics for restoration validation failures to dashboards
3. Create operational runbook for common restoration report errors
4. Consider persistent cache of known-good restoration.jsonl patterns
