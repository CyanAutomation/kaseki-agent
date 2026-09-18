# Quick Reference: Test Environment Isolation

## When You Need This

✅ **Use environment isolation when:**

- Testing "default" or "neutral" configuration behavior
- Validating behavior when environment variables are **not** set
- Testing provider registration or initialization
- Verifying fallback behavior

❌ **Not needed when:**

- Testing with explicitly set environment variables
- Environment state is part of the test scenario
- Testing runtime behavior with known config

## The Simple Way

### For Synchronous Tests

```typescript
import { CLOUDFLARE_METADATA_ENV_VARS, withIsolatedEnvSync } from '../test/helpers/env-isolation.js';

it('tests neutral default behavior', () => {
  // Setup your test config
  process.env.LLM_GATEWAY_URL = 'https://gateway.example.com';
  process.env.LLM_GATEWAY_API_KEY = 'test-key';
  
  // Wrap code that needs isolation
  withIsolatedEnvSync(CLOUDFLARE_METADATA_ENV_VARS, () => {
    // These are automatically deleted:
    // - KASEKI_INSTANCE
    // - KASEKI_INFERENCE_PHASE
    // - KASEKI_INFERENCE_ATTEMPT
    // - KASEKI_INFERENCE_REQUEST_ID
    
    const result = functionUnderTest();
    expect(result).toMatchSnapshot();
  });
  // Variables automatically restored here
});
```

### For Async Tests

```typescript
import { CLOUDFLARE_METADATA_ENV_VARS, withIsolatedEnv } from '../test/helpers/env-isolation.js';

it('tests async neutral default behavior', async () => {
  await withIsolatedEnv(CLOUDFLARE_METADATA_ENV_VARS, async () => {
    const result = await asyncFunctionUnderTest();
    expect(result).toBe('expected-neutral-default');
  });
});
```

## Available Constants

```typescript
// CloudFlare Gateway Metadata (most common)
CLOUDFLARE_METADATA_ENV_VARS = [
  'KASEKI_INSTANCE',
  'KASEKI_INFERENCE_PHASE',
  'KASEKI_INFERENCE_ATTEMPT',
  'KASEKI_INFERENCE_REQUEST_ID',
]

// Gateway Configuration
GATEWAY_CONFIG_ENV_VARS = [
  'LLM_GATEWAY_URL',
  'LLM_GATEWAY_API_KEY',
  'LLM_GATEWAY_MODEL',
  'LLM_GATEWAY_MAX_OUTPUT_TOKENS',
  'KASEKI_GATEWAY_LOG_PAYLOADS',
]
```

## Common Mistakes

### ❌ DON'T: Delete only some variables

```typescript
// This will fail in worker containers!
delete process.env.KASEKI_INSTANCE;
// Oops - forgot KASEKI_INFERENCE_PHASE, etc.
```

### ❌ DON'T: Forget to restore

```typescript
delete process.env.KASEKI_INSTANCE;
// Test code...
// Oops - never restored, affects other tests
```

### ✅ DO: Use the helper

```typescript
withIsolatedEnvSync(CLOUDFLARE_METADATA_ENV_VARS, () => {
  // Test code - all variables cleaned up and restored automatically
});
```

## Custom Variable Groups

Need to isolate different variables?

```typescript
const MY_CUSTOM_VARS = ['VAR1', 'VAR2', 'VAR3'] as const;

withIsolatedEnvSync(MY_CUSTOM_VARS, () => {
  // These three variables deleted during test
});
```

## Verification

Run this to check your tests:

```bash
./scripts/check-test-env-isolation.sh
```

## More Information

- Full guide: [docs/TEST_ISOLATION_BEST_PRACTICES.md](TEST_ISOLATION_BEST_PRACTICES.md)
- Postmortem: [docs/TEST_ENVIRONMENT_POLLUTION_POSTMORTEM.md](TEST_ENVIRONMENT_POLLUTION_POSTMORTEM.md)
- Helper source: [test/helpers/env-isolation.ts](../test/helpers/env-isolation.ts)

## Real Example

See [tests/cloudflare-gateway-integration.test.ts](../tests/cloudflare-gateway-integration.test.ts) line 149+
