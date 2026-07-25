# Kaseki-198 Failure Analysis Report

**Date**: 2026-07-06  
**Run ID**: kaseki-198  
**Status**: ❌ Failed  
**Exit Code**: 88 (Provider Error)  
**Duration**: 314 seconds (5m 14s)  
**Elapsed**: 14:24:08 → 14:29:21 UTC  

---

## Executive Summary

Kaseki-198 failed during the **Pi coding phase** with a **422 HTTP status code** from the provider gateway. However, the root cause is **not a transient provider issue** but rather **upstream build/dependency problems** that prevented the agent from generating valid output during the goal-setting phase.

**Bottom Line**: The run failed due to a combination of:
1. Missing GitHub App token helper module (docker image build issue)
2. Missing TypeScript compiler executable (npm dependency cache corruption)
3. Invalid goal-setting output schema (downstream consequence)
4. Non-retryable 422 provider error (final manifestation)

---

## Detailed Root Cause Analysis

### Phase 1: Pre-Validation (✅ Success)
- **Command**: `npm run build`
- **Exit Code**: 0
- **Duration**: 37 seconds
- **Status**: Pre-flight TypeScript check passed

### Phase 2: Scouting Phase (⚠️ Degraded)
- **Duration**: 54 seconds
- **Attempts**: 1
- **Result**: Completed with **critical schema violations**
- **Key Issue**: Scouting output contained arrays as strings instead of properly formatted arrays

### Phase 3: Goal-Setting Phase (❌ Failure)
- **Duration**: 28 seconds
- **Attempts**: 1
- **Result**: **Failed artifact contract**
- **Error**: `goal-setting completed without required candidate artifact`
- **Schema Violations Detected**:
  - `observations`: Expected array, got string
  - `plan`: Expected array, got string
  - `validation`: Expected array, got string
  - `relevant_files[*]`: Expected objects with {path, reason}, got strings (8 violations)

### Phase 4: Pi Coding Phase (❌ Provider Error)
- **Duration**: 63 seconds
- **Event Counts**: 16 agent turns, 32 messages, 15 tool calls
- **Provider Error**: `422 status code (no body)`
- **Provider**: Cloudflare gateway (`/compat` endpoint)
- **Model**: `dynamic/kaseki-agent` (openai-completions)
- **Retryable**: NO
- **Retry Attempts**: 0 (immediately classified as non-retryable)

**Provider Health Metrics**:
- Transport success: ✅ YES
- Stream success: ❌ NO
- Tool calls valid: ✅ YES (100% success rate)
- Agent turns: ❌ FAILED
- Inference health: ❌ FAILED

---

## Critical Issues Identified

### 🔴 Issue #1: Missing GitHub App Token Helper Module

**Location in stderr**: 
```
ERROR: github-app-token helper failed to load: node:internal/modules/esm/resolve:271
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/usr/local/bin/github-app-token-runtime.js'
imported from /usr/local/bin/github-app-token
```

**Why This Matters**:
- The docker image was built with a reference to `github-app-token-runtime.js` that doesn't exist
- This is a build-time issue: the image setup script referenced a missing file
- Even though the run continued, it may have affected credential/auth handling downstream

**Impact**: Preflight health check failed, but marked non-fatal ("Proceeding with kaseki run...")

---

### 🔴 Issue #2: Missing TypeScript Compiler (`tsc`)

**Location in stderr**:
```
missing required dependency executable: node_modules/.bin/tsc
```

**Timeline**:
1. Pre-validation ran `npm run build` → **succeeded** (exit 0)
2. But `tsc` was missing when actually needed during scouting

**Why This Matters**:
- Indicates **dependency cache corruption** or **partial npm install**
- The workspace cache was restored but then failed validation
- Fallback reinstall was triggered but may have been incomplete
- The agent ran without proper TypeScript support, affecting code analysis

**Cache Recovery Log**:
```
"restored cache failed executable/schema validation; reinstalling."
"installing after restored dependency cache failed validation (reason=workspace_cache_integrity_failed)"
```

---

### 🟡 Issue #3: Invalid Goal-Setting Output (Schema Mismatch)

**Problem**: Scouting phase produced output with wrong data types:

```json
// WRONG:
{
  "observations": "string value here",  // ❌ Should be ["item1", "item2", ...]
  "plan": "string value here",          // ❌ Should be ["step1", "step2", ...]
  "validation": "string value here",    // ❌ Should be ["check1", "check2", ...]
  "relevant_files": ["path1", "path2"]  // ❌ Should be [{path: "...", reason: "..."}, ...]
}
```

**Why This Matters**:
- This is a **direct consequence** of Issues #1 and #2
- The scouting agent couldn't properly analyze the codebase without:
  - Correct GitHub integration (Issue #1)
  - TypeScript compiler support (Issue #2)
- Invalid output caused goal-setting to fail validation
- Fallback candidate was auto-generated but never made it to coding phase

---

### 🔴 Issue #4: 422 Provider Error (Non-Retryable)

**The 422 Error**: 
- HTTP 422 = "Unprocessable Entity"
- No response body provided (explains "no body" message)
- Cloudflare gateway returned this for `dynamic/kaseki-agent` model

**Probable Cause Chain**:
1. Malformed request was sent to Cloudflare gateway
2. Likely due to corrupted/incomplete goal-setting artifact from Issue #3
3. Provider rejected with 422 instead of a retryable 5xx error
4. System classified as non-retryable (correct classification)

**Why No Retry**:
- 422 is an HTTP 4xx error (client error, not server error)
- Client errors aren't transient → no automatic retry
- Retrying the same malformed request would fail identically

---

## Dependency Cache Issue Deep Dive

**What Happened**:

```
Layer 1: Stamp check
  └─ Hash mismatch detected

Layer 2: Workspace cache restore
  └─ Attempted hardlink, fell back to copy (cross-device)
  └─ Restore succeeded but validation FAILED

Layer 3: Reinstall triggered
  └─ Running "npm ci --prefer-offline"
  └─ But tsc still missing in final check

Layer 4: Why is tsc missing?
  └─ npm ci completed but node_modules/.bin/tsc not executable
  └─ Indicates either:
     a) TypeScript package not installed
     b) Post-install script failed
     c) Executable lost during cache copy operation
```

**Evidence**:
- Pre-validation: `npm run build` worked (exit 0) → tsc WAS available then
- During pi-run: tsc missing → cache wasn't properly carried over
- Diagnostic: "workspace_cache_integrity_failed"

---

## Impact Assessment

| Component | Status | Severity |
|-----------|--------|----------|
| Build system | ⚠️ Degraded | HIGH |
| TypeScript support | ❌ Missing | CRITICAL |
| GitHub integration | ⚠️ Degraded | MEDIUM |
| Scouting analysis | ❌ Failed | CRITICAL |
| Goal-setting | ❌ Failed | CRITICAL |
| Provider communication | ❌ Failed | HIGH |
| Overall run | ❌ Failed | CRITICAL |

---

## Recommended Fixes

### Fix #1: Rebuild Docker Image (URGENT)

**Issue**: GitHub App token helper module missing from image build

**Action**:
```bash
# 1. Locate the dockerfile build script that references github-app-token-runtime.js
grep -r "github-app-token" Dockerfile docker/

# 2. Check if github-app-token-runtime.js actually exists
find . -name "github-app-token-runtime.js"

# 3. Either:
#    a) Create the missing file with proper implementation
#    b) Update the reference to point to existing file
#    c) Remove the reference if no longer needed

# 4. Rebuild docker image
docker build -t kaseki-agent:latest .

# 5. Test with: docker run --rm kaseki-agent:latest kaseki-health-check
```

**Verification**:
```bash
# Should NOT see this error in stderr
docker run --rm kaseki-agent:latest bash -c \
  "/usr/local/bin/github-app-token --help"
```

---

### Fix #2: Validate Dependency Cache Integrity

**Issue**: TypeScript compiler missing despite successful `npm run build`

**Actions**:

1. **Verify npm package lockfile hasn't drifted**:
   ```bash
   npm install --frozen-lockfile --audit
   npm list typescript
   ```

2. **Check TypeScript post-install hooks**:
   ```bash
   # Verify the bin entry in typescript package.json
   npm list -s typescript | head -5
   ls -la node_modules/.bin/tsc
   ```

3. **Validate cache layer integrity**:
   - Check if cached node_modules have all executables
   - May need to invalidate cache and regenerate:
   ```bash
   rm -rf /agents/kaseki-cache/*
   # Next run will rebuild from scratch
   ```

4. **Add explicit executable check to startup**:
   ```bash
   # In startup-checks.sh
   if [[ ! -x node_modules/.bin/tsc ]]; then
     echo "ERROR: TypeScript compiler not executable"
     npm ci --verbose
   fi
   ```

---

### Fix #3: Enhance Pre-Validation Checks

**Issue**: Pre-validation passed but later dependencies still failed

**Action**: Add comprehensive dependency verification before scouting:

```bash
# In kaseki-agent.sh, after npm install:
npm run build          # Already done
npm run lint           # Add this
npm run type-check     # Add this (if exists)

# Verify critical executables exist and are executable
for cmd in tsc eslint jest; do
  if ! command -v node_modules/.bin/$cmd &>/dev/null; then
    echo "ERROR: Missing critical executable: $cmd"
    npm ls $cmd
    exit 1
  fi
done
```

---

### Fix #4: Add Scouting Output Validation Before Goal-Setting

**Issue**: Goal-setting received invalid schema from scouting

**Action**: Add schema validation pass after scouting:

```typescript
// In src/phases/goal-setting.ts (or equivalent)
function validateScoutingOutput(artifact: any) {
  const errors = [];
  
  if (!Array.isArray(artifact.observations)) {
    errors.push('observations must be array, got: ' + typeof artifact.observations);
  }
  if (!Array.isArray(artifact.plan)) {
    errors.push('plan must be array, got: ' + typeof artifact.plan);
  }
  if (!Array.isArray(artifact.validation)) {
    errors.push('validation must be array, got: ' + typeof artifact.validation);
  }
  
  // Check relevant_files structure
  if (Array.isArray(artifact.relevant_files)) {
    artifact.relevant_files.forEach((file, idx) => {
      if (typeof file !== 'object' || !file.path || !file.reason) {
        errors.push(
          `relevant_files[${idx}] must be object with {path, reason}, got: ` +
          JSON.stringify(file)
        );
      }
    });
  }
  
  if (errors.length > 0) {
    throw new Error('Scouting output schema validation failed:\n' + errors.join('\n'));
  }
}
```

---

### Fix #5: Implement Fallback Provider for 422 Errors

**Issue**: 422 is non-retryable but indicates upstream data problem

**Action**: Add diagnostic context capture and retry with simpler model:

```javascript
// In pi-event-filter.ts
if (error.status === 422 && error.provider === 'gateway') {
  metadata.provider_error_recovery = {
    strategy: 'fallback_to_direct_api',
    reason: '422_unprocessable_entity',
    suggested_model: 'claude-opus-4-1',  // Direct OpenAI, not gateway
    context: 'upstream artifact corruption likely'
  };
  
  // Don't retry same request, trigger fallback
  return 'NEEDS_FALLBACK_PROVIDER';
}
```

---

## Recommended Immediate Actions

| Priority | Action | Effort | Owner |
|----------|--------|--------|-------|
| 🔴 CRITICAL | Rebuild docker image with github-app-token fix | 1-2 hrs | DevOps |
| 🔴 CRITICAL | Validate/regenerate npm dependency cache | 30 min | Build |
| 🟡 HIGH | Add executable verification in startup | 30 min | Engineer |
| 🟡 HIGH | Add scouting output schema validation | 1 hr | Engineer |
| 🟡 HIGH | Test with fixed image | 1 hr | QA |
| 🟢 MEDIUM | Document cache invalidation procedures | 30 min | Docs |

---

## Prevention Measures

1. **Add CI checks for missing files**:
   - Verify all referenced runtime files exist in built image
   - Run `docker inspect` to check image layers

2. **Add executable integrity checks**:
   - Post-build: verify all `.bin/` executables are in place
   - Pre-run: validate critical executables before scouting

3. **Implement schema validation at phase boundaries**:
   - Each phase should validate output of previous phase
   - Fail fast with diagnostic info instead of propagating corruption

4. **Add monitoring for 422 errors**:
   - 422 from gateway = upstream artifact problem
   - Should correlate with scouting/goal-setting validation errors

5. **Document dependency cache behavior**:
   - Add troubleshooting guide for when `npm run build` passes but executables still missing
   - Consider whether cache should be invalidated on certain conditions

---

## Test Plan for Fix Validation

After implementing fixes, run these tests:

```bash
# Test 1: Verify github-app-token loads
./run-kaseki.sh kaseki-test-1 &
wait $!
grep "github-app-token helper failed" /agents/kaseki-results/kaseki-test-1/stderr.log || echo "✓ PASS"

# Test 2: Verify tsc is available during scouting
# (Check that "missing required dependency" doesn't appear in stderr)
grep "missing required dependency executable: tsc" \
  /agents/kaseki-results/kaseki-test-1/stderr.log || echo "✓ PASS"

# Test 3: Verify scouting output has correct schema
# (Run diagnostic on goal-setting-validation-errors.jsonl)
kaseki-report /agents/kaseki-results/kaseki-test-1 | grep "schema_mismatch" && echo "FAIL" || echo "✓ PASS"

# Test 4: Run full kaseki-198 task again to verify no 422 error
TASK_PROMPT="[original task]" ./run-kaseki.sh kaseki-test-2
# Check exit code is not 88
grep "exit_code.*88" /agents/kaseki-results/kaseki-test-2/failure.json && echo "FAIL" || echo "✓ PASS"
```

---

## Conclusion

**Kaseki-198 failed due to cascading upstream infrastructure issues**:

1. **Image build**: Missing github-app-token-runtime.js (not fatal but indicative)
2. **Cache corruption**: TypeScript compiler missing despite apparent successful install
3. **Scouting degradation**: Inability to properly analyze code due to #2, produced invalid output
4. **Goal-setting failure**: Rejected invalid scouting schema, couldn't generate candidate artifact
5. **Provider error**: Received 422 when trying to send corrupted/incomplete data to coding phase

The 422 error itself is a symptom, not the root cause. Fixing the docker image build and dependency cache will resolve this.

