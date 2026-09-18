# Test Environment Pollution - Root Cause & Prevention Plan

## Executive Summary

**Issue:** kaseki-237 and kaseki-238 both failed due to test environment pollution in `tests/cloudflare-gateway-integration.test.ts`

**Root Cause:** Test deleted `KASEKI_INSTANCE` but left three other CloudFlare metadata environment variables intact (`KASEKI_INFERENCE_PHASE`, `KASEKI_INFERENCE_ATTEMPT`, `KASEKI_INFERENCE_REQUEST_ID`), causing test to fail when run inside kaseki worker containers

**Status:** ✅ Fixed and verified (all 3193 tests pass)

## Detailed Root Cause Analysis

### What Happened

1. **kaseki-237 and kaseki-238 execution context:**
   - Both runs executed inside Docker worker containers
   - Container environment included runtime metadata variables:
     - `KASEKI_INFERENCE_PHASE=goal-check`
     - `KASEKI_INFERENCE_ATTEMPT=primary-1`
     - `KASEKI_INFERENCE_REQUEST_ID=<actual-uuid>`

2. **Test assumption violation:**
   - Test `"registers the gateway provider contract expected by Pi CLI"` validates "neutral default" configuration
   - Only deleted `KASEKI_INSTANCE`, assuming other vars wouldn't be present
   - In worker containers, these variables persist across test runs

3. **Failure manifestation:**

   ```diff
   - Expected: "cf-aig-metadata": '{"phase":"unknown","attempt":"unknown","request_id":"unknown",...}'
   + Received: "cf-aig-metadata": '{"phase":"goal-check","attempt":"primary-1","request_id":"3c06b6c8-..."}'
   ```

### Why It Wasn't Caught Earlier

- Test passes in local dev environments (no metadata variables set)
- Test passes in CI (clean environment)
- Only fails when run inside active kaseki worker containers (production scenario)

## The Fix

### Immediate Fix (Applied)

**File:** `tests/cloudflare-gateway-integration.test.ts`

**Before:**

```typescript
delete process.env.KASEKI_INSTANCE;
// Missing: KASEKI_INFERENCE_PHASE, KASEKI_INFERENCE_ATTEMPT, KASEKI_INFERENCE_REQUEST_ID
```

**After:**

```typescript
withIsolatedEnvSync(CLOUDFLARE_METADATA_ENV_VARS, () => {
  // All four CloudFlare metadata variables automatically deleted
  const mockPi = { registerProvider: jest.fn() };
  registerGatewayProvider(mockPi as unknown as ExtensionAPI);
  expect(mockPi.registerProvider).toHaveBeenCalledWith(...);
});
// All variables automatically restored after test
```

## Prevention Plan

### 1. Test Helper Utility ✅ Implemented

**File:** `test/helpers/env-isolation.ts`

**Features:**

- `CLOUDFLARE_METADATA_ENV_VARS` - Centralized list of all metadata variables
- `withIsolatedEnvSync()` - Sync test isolation wrapper
- `withIsolatedEnv()` - Async test isolation wrapper
- Automatic snapshot, cleanup, and restoration

**Benefits:**

- Impossible to forget variables (array maintained in one place)
- Automatic restoration (no manual cleanup needed)
- Self-documenting (clear intent in test code)

### 2. Documentation ✅ Created

**File:** `docs/TEST_ISOLATION_BEST_PRACTICES.md`

**Contents:**

- Environment variable cleanup patterns (good vs. bad)
- CloudFlare metadata variable reference table
- Detection command examples
- Usage patterns and examples

### 3. CI Detection Script ✅ Created

**File:** `scripts/check-test-env-isolation.sh`

**Capabilities:**

- Detects tests that delete `KASEKI_INSTANCE` without full cleanup
- Exempts tests using `withIsolatedEnv` helpers
- Provides actionable remediation advice
- Exit code integration for CI pipelines

**Integration:**

```yaml
# .github/workflows/test.yml
- name: Check test environment isolation
  run: ./scripts/check-test-env-isolation.sh
```

### 4. Repository Memory ✅ Documented

**File:** `/memories/repo/test-environment-pollution-fix.md`

Captured for future reference when similar issues arise.

## Testing & Verification

### Test Results

**Specific test:**

```bash
npm test -- tests/cloudflare-gateway-integration.test.ts
# ✅ 6 tests passed
```

**Full suite:**

```bash
npm test
# ✅ 3193 tests passed, 1 skipped
# ✅ 0 failures
```

**CI detection script:**

```bash
./scripts/check-test-env-isolation.sh
# ✅ All tests properly clean up CloudFlare metadata environment variables
```

## Deployment Checklist

- [x] Fix applied to failing test
- [x] Helper utility created
- [x] Documentation written
- [x] Detection script created
- [x] All tests pass locally
- [x] Repository memory updated
- [ ] CI integration (optional - add to GitHub Actions workflow)

## Future Recommendations

### Short-term (Next Sprint)

1. **Add CI check:** Integrate `check-test-env-isolation.sh` into GitHub Actions workflow
2. **Audit existing tests:** Search for other tests that may have incomplete cleanup:

   ```bash
   grep -r "delete process.env" tests/ --include="*.test.ts" | grep -v "withIsolated"
   ```

### Medium-term (Next Quarter)

1. **ESLint rule:** Create custom rule to flag direct `delete process.env.KASEKI_*` without helper
2. **Test template:** Add example to `docs/CONTRIBUTING.md` showing proper isolation pattern
3. **Migration guide:** Document how to migrate existing tests to use helpers

### Long-term (Ongoing)

1. **Monitor pattern adoption:** Track usage of `withIsolatedEnv` helpers in code reviews
2. **Extend helpers:** Add support for other environment variable groups as needed
3. **Share learnings:** Document this pattern in internal engineering wiki

## Related Issues

- **kaseki-237:** First observed failure (July 26, 2026 06:51 UTC)
- **kaseki-238:** Second occurrence (July 26, 2026 09:19 UTC)
- **Pattern:** Both failed identically, confirming systematic issue

## References

- Test file: `tests/cloudflare-gateway-integration.test.ts`
- Gateway provider: `src/.extensions.ts` (lines 63-75)
- Helper utility: `test/helpers/env-isolation.ts`
- Documentation: `docs/TEST_ISOLATION_BEST_PRACTICES.md`
- Detection script: `scripts/check-test-env-isolation.sh`
- Repository memory: `/memories/repo/test-environment-pollution-fix.md`

---

**Last Updated:** 2026-07-26  
**Status:** Resolved ✅  
**Next Review:** After 10 successful production runs
