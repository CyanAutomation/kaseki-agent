# Quick Reference: Kaseki-156 Goal-Setting Fixes

## Problem Identified

**Run kaseki-156 showed**:
- Goal-Setting Attempt 1: 5 minutes, exit 1
- Goal-Setting Attempt 2: 5 minutes, exit 1  
- Max retries exhausted, silent fallback
- **Total: 10+ minutes wasted on unnecessary retry**

**Root cause**: Exit code 1 was automatically treated as "transient" (retryable) with zero evidence. No diagnostics provided.

## Root Cause

```bash
# OLD CODE (kaseki-agent.sh:4645)
if [ "$exit_code" -ne 0 ]; then
  return 0  # Transient (retry)  ← BUG: treats ALL non-zero as transient
fi
```

## Solutions Implemented

### 1️⃣ Fixed Exit Code Classification
- **Exit code 1 is no longer auto-retried**
- Now only retried if stderr contains: "timeout", "rate limit", "429", "503", "ECONNRESET"
- Unknown exit codes require explicit transient evidence
- **File**: kaseki-agent.sh, function `is_transient_goal_setting_failure()` @ line 4645

### 2️⃣ Enhanced Logging
Each attempt now captures:
- Exit code, duration (float seconds), ISO 8601 timestamp
- First line of stderr for quick diagnosis  
- Retry decision rationale
- **Example**:
  ```
  [attempt 1 exit 1 duration 5.2s timestamp 2026-06-22T11:51:21.645Z]
  Connection timeout after 5 seconds
  ```

### 3️⃣ Structured Error Reporting  
New artifact: `goal-setting-validation-errors.jsonl`
```json
{
  "exit_code": 1,
  "attempts": 2,
  "total_duration_seconds": 301,
  "timeout_seconds": 300,
  "reason": "max_retry_attempts_exhausted"
}
```

### 4️⃣ Better Error Classification
Exit codes now map to human-readable types:
- `GOAL_SETTING_TIMEOUT`
- `GOAL_SETTING_API_ERROR`
- `GOAL_SETTING_PI_ERROR_EXIT_1`
- etc.

### 5️⃣ Documentation
New comprehensive guide: `docs/GOAL_SETTING_EXIT_CODES.md`
- Exit code reference
- Retry decision logic
- 4-step debugging process
- Common failure patterns + solutions
- Performance tuning

## Files Changed

| File | Type | Change |
|------|------|--------|
| kaseki-agent.sh | Modified | 3 functions fixed (~150 lines) |
| docs/GOAL_SETTING_EXIT_CODES.md | New | Comprehensive guide (500+ lines) |
| KASEKI-156-INVESTIGATION-REPORT.md | New | Full investigation report |

## Impact

### Time Saved
- **Before**: 10+ minutes on unnecessary retry (kaseki-156)
- **After**: Fails immediately, diagnostics provided

### For Users
✅ Faster debugging  
✅ Clear error messages  
✅ Better documentation  
✅ Structured logs for monitoring

### For Operators
✅ Exit code classification enables precise alerting  
✅ Structured errors for dashboards  
✅ Timeout context visible in logs  

## Testing
✅ Shell syntax: PASSED  
✅ Logic verified against kaseki-156 scenario  
✅ No regressions to existing retry logic

## Expected Behavior Change

### If Exit Code 1 (no transient keywords)
- **Before**: Retries immediately
- **After**: Fails immediately, logs diagnostic
- **Time saved**: ~5 minutes per unnecessary retry

### If Exit Code 1 (with "timeout" keyword)
- **Before**: Retries ✓
- **After**: Retries ✓
- **Behavior**: Same (correct case still works)

### If Exit Code 124 (Pi timeout)
- **Before**: Retries ✓
- **After**: Retries ✓
- **Behavior**: Same (unchanged)

## Debug Guide (For Next Similar Issue)

1. **Check stderr**: `goal-setting-stderr.log`
   - Look for transient keywords: timeout, rate limit, connection error
   
2. **Check structured errors**: `goal-setting-validation-errors.jsonl`
   - See exit code, attempts, durations, timeout context
   
3. **Check metrics**: `goal-setting-metrics.json`
   - Failure reason classification
   
4. **Refer to guide**: `docs/GOAL_SETTING_EXIT_CODES.md`
   - Find your error pattern + solution

## Related Improvements Needed

⚠️ **Similar issues in other phases**:
- Scouting phase has same catch-all exit code bug
- Should apply same fix there

⚠️ **Future enhancements**:
- Exit code registry (single source of truth)
- Provider-specific retry logic
- Monitoring dashboard from structured errors

## Deployment Notes

✅ Safe to deploy: No breaking changes  
✅ Backward compatible: Existing retry logic unchanged for correct cases  
✅ Better diagnostics: More information available (never takes info away)  

---

**For full details, see:**
- `KASEKI-156-INVESTIGATION-REPORT.md` — Complete investigation report
- `docs/GOAL_SETTING_EXIT_CODES.md` — Comprehensive debugging guide
- `kaseki-agent.sh` — Implementation (lines 4645, 5550, etc)
