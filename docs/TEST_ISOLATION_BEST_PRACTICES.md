# Test Isolation Best Practices

## Environment Variable Cleanup

### Problem
Tests that verify "neutral default" behavior may fail when run inside kaseki worker containers where runtime environment variables persist across test runs.

### Solution
Always clean up **all** related environment variables in tests that validate default behavior.

### Example Pattern

**❌ Incomplete Cleanup (causes failures):**
```typescript
delete process.env.KASEKI_INSTANCE;
// Missing: KASEKI_INFERENCE_PHASE, KASEKI_INFERENCE_ATTEMPT, KASEKI_INFERENCE_REQUEST_ID
```

**✅ Complete Cleanup:**
```typescript
// Save original state
const originalEnv = {
  KASEKI_INSTANCE: process.env.KASEKI_INSTANCE,
  KASEKI_INFERENCE_PHASE: process.env.KASEKI_INFERENCE_PHASE,
  KASEKI_INFERENCE_ATTEMPT: process.env.KASEKI_INFERENCE_ATTEMPT,
  KASEKI_INFERENCE_REQUEST_ID: process.env.KASEKI_INFERENCE_REQUEST_ID,
};

// Delete all related variables
delete process.env.KASEKI_INSTANCE;
delete process.env.KASEKI_INFERENCE_PHASE;
delete process.env.KASEKI_INFERENCE_ATTEMPT;
delete process.env.KASEKI_INFERENCE_REQUEST_ID;

try {
  // Test code here
} finally {
  // Restore original state
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
```

## CloudFlare Gateway Metadata Variables

When testing CloudFlare gateway provider registration, always clean up these variables:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `KASEKI_INSTANCE` | Run instance ID | `kaseki-237` |
| `KASEKI_INFERENCE_PHASE` | Current execution phase | `goal-check`, `weaving`, `scouting` |
| `KASEKI_INFERENCE_ATTEMPT` | Retry attempt | `primary-1`, `retry-2` |
| `KASEKI_INFERENCE_REQUEST_ID` | Correlation UUID | `3c06b6c8-5f79-4f9d-87a4-3cedd19574ec` |

## Detection Strategy

### Grep Pattern for Incomplete Cleanup
Search for tests that delete only some CloudFlare metadata variables:

```bash
# Find potential incomplete cleanups
grep -r "delete process.env.KASEKI_INSTANCE" tests/ --include="*.test.ts" -A 5 | \
  grep -v "KASEKI_INFERENCE_PHASE" | \
  grep -v "KASEKI_INFERENCE_ATTEMPT" | \
  grep -v "KASEKI_INFERENCE_REQUEST_ID"
```

### Validation Command
Add to CI pipeline:
```bash
npm run test:isolation-check
```

## References

- Fixed Issue: kaseki-237, kaseki-238 (CloudFlare gateway integration test failure)
- Implementation: [tests/cloudflare-gateway-integration.test.ts](../tests/cloudflare-gateway-integration.test.ts)
- Gateway Provider: [src/.extensions.ts](../src/.extensions.ts)
