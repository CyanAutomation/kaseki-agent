# Test Environment Isolation

Tests that assert default behavior must not inherit runtime values from the
shell, a worker container, or an earlier test. Save and restore every related
environment variable, including when the test throws.

## Use the shared helper

For Cloudflare gateway metadata, use
[`withIsolatedEnvSync`](../test/helpers/env-isolation.ts) and the shared
`CLOUDFLARE_METADATA_ENV_VARS` list:

```typescript
import {
  CLOUDFLARE_METADATA_ENV_VARS,
  withIsolatedEnvSync,
} from '../test/helpers/env-isolation.js';

it('uses neutral metadata defaults', () => {
  withIsolatedEnvSync(CLOUDFLARE_METADATA_ENV_VARS, () => {
    registerGatewayProvider(mockPi);
    expect(mockPi.registerProvider).toHaveBeenCalled();
  });
});
```

The helper snapshots those variables, deletes them for the callback, and
restores their original values in a `finally` block. The metadata group covers
`KASEKI_INSTANCE`, `KASEKI_INFERENCE_PHASE`, `KASEKI_INFERENCE_ATTEMPT`, and
`KASEKI_INFERENCE_REQUEST_ID`.

## When adding another environment group

- Add the related variable names to a shared constant in
  `test/helpers/env-isolation.ts`.
- Use the helper in tests that assert unset or default behavior.
- Keep variables that are part of a test scenario set outside the isolated
  callback only when they are not included in the cleanup group.
- Add a regression case that proves values are removed during the callback and
  restored afterward.

Avoid deleting one variable from a related group by hand. Partial cleanup can
make tests pass locally while failing in worker environments that set the
other runtime metadata.

The original pollution incident and its timeline are preserved in the
[postmortem](archive/TEST_ENVIRONMENT_POLLUTION_POSTMORTEM.md). The older
[quick reference](archive/QUICK_REF_TEST_ISOLATION.md) is retained as history;
the shared helper above is the current pattern.
