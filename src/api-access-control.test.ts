import { ApiAccessController } from './api-access-control';

describe('API key access control', () => {
  test('applies configured scopes per key and grants read-only access by default', () => {
    const access = new ApiAccessController({
      apiKeys: ['monitor-key', 'legacy-key'],
      apiKeyScopes: { 'monitor-key': ['runs:read', 'metrics:read'] },
      now: () => 1_000,
    });

    expect(access.requiredScope('GET', '/runs')).toBe('runs:read');
    expect(access.hasScope('monitor-key', 'runs:read')).toBe(true);
    expect(access.hasScope('monitor-key', 'runs:write')).toBe(false);
    expect(access.hasScope('legacy-key', 'runs:read')).toBe(true);
    expect(access.hasScope('legacy-key', 'runs:write')).toBe(false);
    expect(access.hasScope('legacy-key', 'webhooks:write')).toBe(false);
  });

  test('limits request bursts per key and releases quota at the next window', () => {
    let now = 1_000;
    const access = new ApiAccessController({ apiKeys: ['key-a'], requestsPerMinute: 2, now: () => now });

    expect(access.checkAndRecord('key-a', 'GET', '/runs', {})).toBeUndefined();
    expect(access.checkAndRecord('key-a', 'GET', '/runs', {})).toBeUndefined();
    expect(access.checkAndRecord('key-a', 'GET', '/runs', {})).toBe(59);
    now = 60_000;
    expect(access.checkAndRecord('key-a', 'GET', '/runs', {})).toBeUndefined();
  });

  test('tracks diagnostic probe counts separately from request counts', () => {
    const access = new ApiAccessController({ apiKeys: ['key-a'], now: () => 123_000 });
    access.checkAndRecord('key-a', 'GET', '/gateway-test', { inference: 'true' });
    const usage = access.getUsage('key-a');
    expect(usage.requestCount).toBe(1);
    expect(usage.diagnosticProbeCount).toBe(1);
    expect(usage.costUsd).toBeNull();
  });

  test('classifies mixed-case paths with the same scopes and category limits as Express routes', () => {
    const access = new ApiAccessController({
      apiKeys: ['key-a'],
      diagnosticsPerHour: 1,
      webhookTestsPerHour: 1,
      now: () => 123_000,
    });

    expect(access.requiredScope('POST', '/WEBHOOKS/TEST')).toBe('webhooks:write');
    expect(access.requiredScope('GET', '/RESULTS/run-1/metadata.json')).toBe('artifacts:read');
    expect(access.requiredScope('GET', '/GATEWAY-TEST', { inference: 'true' })).toBe('diagnostics:run');
    expect(access.requiredScope('GET', '/METRICS')).toBe('metrics:read');
    expect(access.requiredScope('GET', '/USAGE')).toBe('usage:read');
    expect(access.requiredScope('POST', '/GITHUB-ISSUES')).toBe('github:read');

    expect(access.checkAndRecord('key-a', 'POST', '/WEBHOOKS/TEST', {})).toBeUndefined();
    expect(access.checkAndRecord('key-a', 'POST', '/webhooks/test', {})).toBeGreaterThan(0);
    expect(access.checkAndRecord('key-a', 'GET', '/GATEWAY-TEST', { inference: 'true' })).toBeUndefined();
    expect(access.checkAndRecord('key-a', 'GET', '/gateway-test', { inference: 'true' })).toBeGreaterThan(0);
    expect(access.getUsage('key-a')).toMatchObject({
      diagnosticProbeCount: 2,
      webhookTestCount: 2,
    });
  });
});
