import { describe, expect, it } from '@jest/globals';
import { loadSoyuzAdapterConfig } from './config';

describe('loadSoyuzAdapterConfig', () => {
  it('uses safe defaults when queue consumption and submissions are disabled', () => {
    expect(loadSoyuzAdapterConfig({})).toEqual({
      enabled: false,
      submissionEnabled: false,
      submissionApiToken: '',
      apiUrl: '',
      workerApiToken: '',
      accountId: '',
      queueId: '',
      queueApiToken: '',
      workerId: '',
      pollIntervalMs: 5_000,
      visibilityTimeoutMs: 120_000,
      requestTimeoutMs: 20_000,
      cancellationPollIntervalMs: 15_000,
      heartbeatIntervalMs: 60_000,
    });
  });

  it('loads submission-only settings, trims secrets, and normalizes the API URL', () => {
    const config = loadSoyuzAdapterConfig({
      SOYUZ_ENABLED: 'FALSE',
      SOYUZ_SUBMISSION_ENABLED: 'TRUE',
      SOYUZ_API_URL: ' https://soyuz.example.test/// ',
      SOYUZ_SUBMISSION_API_TOKEN: ' submission-token-123456 ',
      SOYUZ_WORKER_API_TOKEN: ' worker-token-123456 ',
    });

    expect(config).toMatchObject({
      enabled: false,
      submissionEnabled: true,
      submissionApiToken: 'submission-token-123456',
      apiUrl: 'https://soyuz.example.test',
      workerApiToken: 'worker-token-123456',
      accountId: '',
      queueId: '',
      queueApiToken: '',
      workerId: '',
    });
  });

  it('accepts localhost HTTP for development and requires queue credentials when enabled', () => {
    const config = loadSoyuzAdapterConfig({
      SOYUZ_ENABLED: 'true',
      SOYUZ_API_URL: 'http://localhost:8787/',
      SOYUZ_WORKER_API_TOKEN: 'worker-token-123456',
      CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      CLOUDFLARE_QUEUE_ID: 'queue-id',
      CLOUDFLARE_QUEUE_API_TOKEN: 'queue-token-123456',
      SOYUZ_WORKER_ID: 'host-1',
    });

    expect(config).toMatchObject({
      enabled: true,
      apiUrl: 'http://localhost:8787',
      accountId: '0123456789abcdef0123456789abcdef',
      queueId: 'queue-id',
      workerId: 'host-1',
    });
    expect(() => loadSoyuzAdapterConfig({
      SOYUZ_ENABLED: 'true',
      SOYUZ_API_URL: 'https://soyuz.example.test',
    })).toThrow('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID');
  });

  it('validates queue credentials before submission status-read credentials when both modes are enabled', () => {
    expect(() => loadSoyuzAdapterConfig({
      SOYUZ_ENABLED: 'true',
      SOYUZ_SUBMISSION_ENABLED: 'true',
      SOYUZ_API_URL: 'https://soyuz.example.test',
      SOYUZ_SUBMISSION_API_TOKEN: 'submission-token-123456',
    })).toThrow('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID');
  });

  it.each([
    [{ SOYUZ_ENABLED: 'yes' }, 'SOYUZ_ENABLED must be true or false'],
    [{ SOYUZ_SUBMISSION_ENABLED: 'yes' }, 'SOYUZ_SUBMISSION_ENABLED must be true or false'],
    [{ SOYUZ_SUBMISSION_ENABLED: 'true' }, 'SOYUZ_API_URL is required when Soyuz submissions or queue consumption are enabled'],
    [{ SOYUZ_SUBMISSION_ENABLED: 'true', SOYUZ_API_URL: 'http://soyuz.example.test' }, 'SOYUZ_API_URL must use HTTPS except for localhost development'],
    [{ SOYUZ_SUBMISSION_ENABLED: 'true', SOYUZ_API_URL: 'https://soyuz.example.test?token=x' }, 'SOYUZ_API_URL must not include a query string or fragment'],
    [{ SOYUZ_POLL_INTERVAL_MS: '1.5' }, 'SOYUZ_POLL_INTERVAL_MS must be an integer from 250 through 60000'],
    [{ SOYUZ_SUBMISSION_ENABLED: 'true', SOYUZ_API_URL: 'https://soyuz.example.test', SOYUZ_SUBMISSION_API_TOKEN: 'short', SOYUZ_WORKER_API_TOKEN: 'worker-token-123456' }, 'SOYUZ_SUBMISSION_API_TOKEN is required and must contain at least 16 characters when SOYUZ_SUBMISSION_ENABLED=true'],
    [{ SOYUZ_SUBMISSION_ENABLED: 'true', SOYUZ_API_URL: 'https://soyuz.example.test', SOYUZ_SUBMISSION_API_TOKEN: 'worker-token-123456', SOYUZ_WORKER_API_TOKEN: 'worker-token-123456' }, 'SOYUZ_SUBMISSION_API_TOKEN must be distinct from SOYUZ_WORKER_API_TOKEN'],
  ] as const)('rejects invalid settings %#', (env, message) => {
    expect(() => loadSoyuzAdapterConfig(env)).toThrow(message);
  });
});
