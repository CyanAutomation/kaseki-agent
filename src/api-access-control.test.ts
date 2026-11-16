import { ApiAccessController } from './api-access-control';

describe('API key request limits and usage', () => {
  test('limits request bursts per key and releases quota at the next window', () => {
    let now = 1_000;
    const access = new ApiAccessController({ requestsPerMinute: 2, now: () => now });

    expect(access.checkAndRecord('key-a', 'GET', '/runs', {})).toBeUndefined();
    expect(access.checkAndRecord('key-a', 'GET', '/runs', {})).toBeUndefined();
    expect(access.checkAndRecord('key-a', 'GET', '/runs', {})).toBe(59);
    now = 60_000;
    expect(access.checkAndRecord('key-a', 'GET', '/runs', {})).toBeUndefined();
  });

  test('tracks diagnostic probe counts separately from request counts', () => {
    const access = new ApiAccessController({ now: () => 123_000 });
    access.checkAndRecord('key-a', 'GET', '/gateway-test', { inference: 'true' });
    const usage = access.getUsage('key-a');
    expect(usage.requestCount).toBe(1);
    expect(usage.diagnosticProbeCount).toBe(1);
    expect(usage).not.toHaveProperty('githubIssueLookupCount');
    expect(usage.costUsd).toBeNull();
  });

  test('classifies mixed-case paths consistently for category limits', () => {
    const access = new ApiAccessController({
      diagnosticsPerHour: 1,
      webhookTestsPerHour: 1,
      now: () => 123_000,
    });

    expect(access.checkAndRecord('key-a', 'POST', '/WEBHOOKS/TEST', {})).toBeUndefined();
    expect(access.checkAndRecord('key-a', 'POST', '/webhooks/test', {})).toBeGreaterThan(0);
    expect(access.checkAndRecord('key-a', 'GET', '/GATEWAY-TEST', { inference: 'true' })).toBeUndefined();
    expect(access.checkAndRecord('key-a', 'GET', '/gateway-test', { inference: 'true' })).toBeGreaterThan(0);
    expect(access.getUsage('key-a')).toMatchObject({
      diagnosticProbeCount: 2,
      webhookTestCount: 2,
    });
  });

  test('rate limits manual retries of blocked Soyuz callbacks', () => {
    let now = 100_000;
    const access = new ApiAccessController({ diagnosticsPerHour: 1, now: () => now });
    const path = '/soyuz/callbacks/22222222-2222-4222-8222-222222222222/retry';

    expect(access.checkAndRecord('key-a', 'POST', path, {})).toBeUndefined();
    expect(access.checkAndRecord('key-a', 'POST', path, {})).toBeGreaterThan(0);
    expect(access.getUsage('key-a').diagnosticProbeCount).toBe(2);

    now += 3_600_000;
    expect(access.checkAndRecord('key-a', 'POST', path, {})).toBeUndefined();
  });
});
