jest.mock('@sentry/node', () => ({
  expressIntegration: jest.fn(() => ({ name: 'express' })),
  init: jest.fn(),
  expressErrorHandler: jest.fn(),
  withScope: jest.fn(),
  captureException: jest.fn(),
  close: jest.fn().mockResolvedValue(true),
}));

import * as Sentry from '@sentry/node';
import { initSentry } from './sentry-integration';

describe('initSentry', () => {
  it('respects disabled, incomplete, enabled, and already-initialized configurations', () => {
    const originalDsn = process.env.SENTRY_DSN;
    const originalEnabled = process.env.SENTRY_ENABLED;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const initialize = Sentry.init as jest.Mock;

    try {
      delete process.env.SENTRY_DSN;
      delete process.env.SENTRY_ENABLED;
      initSentry();
      expect(initialize).not.toHaveBeenCalled();

      process.env.SENTRY_ENABLED = 'true';
      initSentry();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SENTRY_DSN is not set'));
      expect(initialize).not.toHaveBeenCalled();

      initSentry({ dsn: 'https://public@example.ingest.sentry.io/1', release: 'test-release' });
      expect(initialize).toHaveBeenCalledTimes(1);
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
        dsn: 'https://public@example.ingest.sentry.io/1',
        release: 'test-release',
        environment: 'production',
        tracesSampleRate: 0.1,
      }));

      initSentry({ dsn: 'https://other@example.ingest.sentry.io/2', release: 'ignored' });
      expect(initialize).toHaveBeenCalledTimes(1);
    } finally {
      if (originalDsn === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = originalDsn;
      if (originalEnabled === undefined) delete process.env.SENTRY_ENABLED;
      else process.env.SENTRY_ENABLED = originalEnabled;
      warn.mockRestore();
    }
  });
});
