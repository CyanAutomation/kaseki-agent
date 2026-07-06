# Kaseki-198 Root Cause Fixes - Implementation Summary

**Date**: 2026-07-06  
**Status**: ✅ All 5 phases implemented  
**Tested**: Syntax validation passed

## Changes Made

### Phase 1: Docker Image Build Fix ✅
**File**: [Dockerfile](Dockerfile)

**Issue**: Missing `github-app-token-runtime.js` installation preventing GitHub App token generation

**Changes**:
- Line 151: Added copy of `dist/github-app-token-runtime.js` to `/app/lib/`
- Line 189: Added install command to place file in `/usr/local/bin/github-app-token-runtime.js`

**Result**: Node.js ES module imports in `github-app-token.js` will now find the `github-app-token-runtime.js` dependency

**Verification**:
```bash
docker build -t kaseki-test:local .
docker run --rm kaseki-test:local ls -la /usr/local/bin/github-app-token-runtime.js
# Should show: -rwxr-xr-x ... github-app-token-runtime.js
```

---

### Phase 2: Dependency Cache Integrity Fix ✅
**File**: [kaseki-agent.sh](kaseki-agent.sh)

**Issue**: TypeScript compiler (`tsc`) missing at runtime despite successful pre-validation build

**Changes**:
- Added `validate_critical_executables_for_scouting()` function (line 8980)
- Checks for: `tsc`, `eslint`, `npm`, `node`
- Validates before scouting phase starts (line 9010)
- Provides diagnostic output if any tools are missing
- Exits with code 2 (blocking error) if validation fails

**Result**: Early detection of missing dependencies with actionable error messages

**Verification**:
```bash
# In container, after dependency install
test -x node_modules/.bin/tsc && echo "✓ tsc is executable"
npm list typescript
# Should show typescript installed with bin/tsc available
```

---

### Phase 3: Executable Integrity Checks ✅
**File**: [kaseki-agent.sh](kaseki-agent.sh)

**Issue**: No pre-execution validation that critical tools are available

**Changes**:
- Integrated with Phase 2: `validate_critical_executables_for_scouting()` runs before scouting
- Checks PATH for all required executables
- Provides diagnostic output including:
  - `npm list typescript` output
  - `node_modules/.bin/` directory contents
  - Cache source and restore method

**Result**: Fail-fast behavior with comprehensive diagnostics

**Verification**:
```bash
# Look for this in logs before scouting:
# ✓ Critical executables validation passed (tsc, eslint, npm, node available)
```

---

### Phase 4: Scouting Output Schema Validation ✅
**File**: [kaseki-agent.sh](kaseki-agent.sh)

**Issue**: Invalid scouting output (arrays as strings) passed to goal-setting, causing 422 errors downstream

**Changes**:
- Added `validate_scouting_output_schema()` function (line 1113)
- Validates after scouting artifact is generated
- Checks:
  - `observations` is array (not string)
  - `plan` is array (not string)
  - `validation` is array (not string)
  - `relevant_files[*]` are objects with `{path, reason}` (not strings)
- Logs detailed schema mismatch errors to `scouting-validation-errors.jsonl`
- Integrated into `validate_scouting_artifact()` (line 1098)

**Result**: Schema violations caught before reaching goal-setting phase

**Verification**:
```bash
# If schema is invalid, should see:
# ERROR: Scouting output schema validation failed with N type mismatches
# And entries in scouting-validation-errors.jsonl like:
# {"reason_code":"schema_mismatch","field":"observations","expected":"array","actual":"string"}
```

---

### Phase 5: Enhanced 422 Error Diagnostics ✅
**Files**: [scripts/lib/provider-retry.sh](scripts/lib/provider-retry.sh)

**Issue**: 422 errors appeared without context about upstream artifact corruption

**Changes**:
- Added `capture_422_diagnostics()` function (line 155)
- Detects "422" in provider error messages
- Logs diagnostic context:
  - Points to scouting/goal-setting validation error logs
  - Mentions goal-setting-stderr.log for upstream issues
  - References goal-setting artifact for inspection
- Creates structured diagnostic event in `provider-diagnostics.jsonl`
- Integrated into error capture flow (line 595)

**Result**: 422 errors now include diagnostic guidance pointing to root cause

**Verification**:
```bash
# When 422 error occurs, should see:
# [DIAGNOSTIC] 422 Unprocessable Entity from provider gateway
# [DIAGNOSTIC] This usually indicates malformed or corrupted upstream artifact data.
# [DIAGNOSTIC] Check these validation logs:
# [DIAGNOSTIC]   - scouting-validation-errors.jsonl
# [DIAGNOSTIC]   - goal-setting-validation-errors.jsonl
# [DIAGNOSTIC]   - goal-setting-stderr.log
```

---

## Testing Strategy

### Unit Tests (Fast)
```bash
# 1. Syntax validation (already passed)
bash -n /workspaces/kaseki-agent/kaseki-agent.sh
bash -n /workspaces/kaseki-agent/scripts/lib/provider-retry.sh

# 2. Check function existence
grep "validate_scouting_output_schema\|validate_critical_executables" kaseki-agent.sh
grep "capture_422_diagnostics" scripts/lib/provider-retry.sh
```

### Integration Tests (Slow - requires Docker)
```bash
# 1. Build image with fixes
docker build -t kaseki-agent:test .

# 2. Verify github-app-token-runtime.js is installed
docker run --rm kaseki-agent:test ls -la /usr/local/bin/github-app-token-runtime.js

# 3. Test schema validation with intentionally malformed artifact
# Create test scouting artifact with string instead of array for "observations"
# Run kaseki-agent in test mode with this artifact
# Should see: "schema_mismatch" in validation-errors.jsonl

# 4. Test executable validation
# Run kaseki with missing node_modules
# Should fail with exit code 2 before scouting starts
```

### End-to-End Test (Re-run kaseki-198 task)
```bash
# Re-run the exact task that caused kaseki-198
REPO_URL=https://github.com/cyanautomation/kaseki-agent \
GIT_REF=main \
TASK_PROMPT="[original task from kaseki-198]" \
OPENROUTER_API_KEY=sk-or-... \
./run-kaseki.sh kaseki-test-final

# Verify:
# 1. Exit code is NOT 88 (success or different error code)
# 2. No "Cannot find module 'github-app-token-runtime.js'" in stderr
# 3. No "missing required dependency executable: tsc" in stderr
# 4. Scouting artifact has correct schema (arrays, not strings)
# 5. Goal-setting completes successfully
# 6. Pi coding phase produces valid diff
```

---

## Files Modified

| File | Lines | Purpose |
|------|-------|---------|
| [Dockerfile](Dockerfile) | 151, 189 | Install github-app-token-runtime.js to /usr/local/bin/ |
| [kaseki-agent.sh](kaseki-agent.sh) | 8980-9011 | Add critical executables validation before scouting |
| [kaseki-agent.sh](kaseki-agent.sh) | 1098-1102 | Integrate schema validation into scouting artifact check |
| [kaseki-agent.sh](kaseki-agent.sh) | 1113-1170 | Add validate_scouting_output_schema() function |
| [scripts/lib/provider-retry.sh](scripts/lib/provider-retry.sh) | 155-184 | Add capture_422_diagnostics() function |
| [scripts/lib/provider-retry.sh](scripts/lib/provider-retry.sh) | 595 | Call capture_422_diagnostics() when error captured |

---

## Root Cause Cascade Addressed

| Issue | Root Cause | Fix | Phase |
|-------|-----------|-----|-------|
| GitHub App token helper missing | File not installed in docker image | Copy and install github-app-token-runtime.js | 1 |
| TypeScript compiler missing at runtime | Dependency cache corruption, incomplete npm ci | Verify tsc executable before scouting | 2,3 |
| Scouting output has wrong types | TypeScript tooling unavailable | Validate schema after scouting | 4 |
| Goal-setting fails | Invalid upstream artifact | Schema validation before goal-setting | 4 |
| 422 provider error (non-retryable) | Corrupted goal-setting artifact | Add diagnostic context for 422 | 5 |

---

## Prevention Measures Implemented

1. **Early validation** - Critical executables checked before scouting starts
2. **Schema validation** - Output validated at phase boundaries to catch data corruption
3. **Fail-fast** - Invalid artifacts detected immediately with detailed diagnostics
4. **Enhanced error context** - 422 errors now point to upstream validation logs
5. **Build verification** - Docker image includes all required runtime files

---

## Next Steps

1. **Build new docker image** with these changes
2. **Run end-to-end test** with kaseki-198 task
3. **Monitor** subsequent runs for 422 errors or missing executable messages
4. **Archive** this implementation summary for future reference

---

## References

- Original failure analysis: [KASEKI-198-FAILURE-ANALYSIS.md](KASEKI-198-FAILURE-ANALYSIS.md)
- Remediation plan: Stored in session memory `/memories/session/plan.md`
- Exit code reference: [docs/EXIT_CODES.md](docs/EXIT_CODES.md)

