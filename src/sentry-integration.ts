/**
 * Sentry Integration Module
 *
 * Initializes and configures Sentry for error tracking and monitoring
 * of the Kaseki API service.
 *
 * Environment Variables:
 * - SENTRY_DSN: Data Source Name for Sentry (required for integration)
 * - SENTRY_ENVIRONMENT: Environment (development, staging, production)
 * - SENTRY_RELEASE: Release version for tracking (auto-detected if not set)
 * - SENTRY_SAMPLE_RATE: Transaction sample rate (0.0 - 1.0)
 * - SENTRY_ENABLED: Explicitly enable/disable Sentry (default: auto-detect from DSN)
 *
 * Release Detection (in order of precedence):
 * 1. SENTRY_RELEASE environment variable
 * 2. Git describe output (e.g., v1.2.3, v1.2.3-5-g1a2b3c)
 * 3. Package.json version
 */

import { spawnSync } from 'child_process';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { createLogger } from './logger';

export interface SentryConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  sampleRate?: number;
  enabled?: boolean;
}

type SentrySdk = typeof import('@sentry/node');

let sentrySdk: SentrySdk | undefined;
let isInitialized = false;
let initializationPromise: Promise<void> | undefined;
const fallbackLogger = createLogger('error-tracking');

function serializeException(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function logExceptionFallback(
  error: unknown,
  context?: Record<string, unknown>,
  sentryError?: unknown,
): void {
  fallbackLogger.error('Exception captured without Sentry', {
    error: serializeException(error),
    ...(context ? { context } : {}),
    ...(sentryError !== undefined ? { sentryError: serializeException(sentryError) } : {}),
  });
}

/**
 * Get the release version for Sentry.
 * Uses this precedence:
 * 1. SENTRY_RELEASE environment variable
 * 2. Git describe (latest tag or commit hash)
 * 3. Package.json version
 *
 * @returns Release version string, or undefined if not available
 */
function detectReleaseVersion(): string | undefined {
  // 1. Check explicit environment variable
  if (process.env.SENTRY_RELEASE) {
    return process.env.SENTRY_RELEASE;
  }

  // 2. Try git describe to get latest tag/version
  try {
    const result = spawnSync('git', ['describe', '--tags', '--always'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 1000,
    });

    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
  } catch {
    // Git not available or command failed, fall through
  }

  // 3. Try git rev-parse HEAD (commit hash) as fallback
  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 1000,
    });

    if (result.status === 0 && result.stdout) {
      const hash = result.stdout.trim();
      return hash.substring(0, 8); // Use first 8 chars of commit hash
    }
  } catch {
    // Git not available, continue
  }

  // 4. Return undefined - Sentry will handle the missing release
  return undefined;
}

/**
 * Initialize Sentry with configuration from environment variables.
 * Can be called multiple times safely - only initializes once.
 *
 * @param customConfig - Optional custom configuration overrides
 * @returns A promise that resolves after the optional SDK has loaded and initialized
 */
export function initSentry(customConfig?: Partial<SentryConfig>): Promise<void> {
  if (isInitialized) {
    return Promise.resolve();
  }
  if (initializationPromise) {
    return initializationPromise;
  }

  const dsn = customConfig?.dsn || process.env.SENTRY_DSN;
  const enabled = customConfig?.enabled !== undefined
    ? customConfig.enabled
    : process.env.SENTRY_ENABLED === 'true' || process.env.SENTRY_ENABLED === '1' || !!dsn;

  if (!enabled) {
    return Promise.resolve();
  }

  if (!dsn) {
    fallbackLogger.warn(
      'Sentry is enabled but SENTRY_DSN is not set; structured logging will be used for errors.',
    );
    return Promise.resolve();
  }

  initializationPromise = (async () => {
    try {
      // The optional SDK is loaded only when error reporting is configured.
      const sdk = await import('@sentry/node');
      const releaseVersion = customConfig?.release || detectReleaseVersion();
      const config: import('@sentry/node').NodeOptions = {
        dsn,
        environment: customConfig?.environment || process.env.SENTRY_ENVIRONMENT || 'production',
        release: releaseVersion,
        tracesSampleRate: customConfig?.sampleRate ?? parseFloat(process.env.SENTRY_SAMPLE_RATE || '0.1'),
        integrations: [sdk.expressIntegration()],
        maxBreadcrumbs: 100,
        beforeSend: (event) => {
          if (process.env.JEST_WORKER_ID) {
            return null;
          }
          return event;
        },
      };

      sdk.init(config);
      sentrySdk = sdk;
      isInitialized = true;
    } catch (error) {
      sentrySdk = undefined;
      fallbackLogger.warn('Sentry SDK is unavailable; structured logging will be used for errors.', {
        error: serializeException(error),
      });
    }
  })();

  return initializationPromise;
}

/**
 * Get the Express error handler middleware.
 * Should be mounted after all other middleware and route handlers.
 */
export function sentryErrorHandler(): ErrorRequestHandler {
  if (isInitialized && sentrySdk) {
    // Sentry and @types/express expose incompatible Response typings for the same Express middleware signature.
    return sentrySdk.expressErrorHandler() as unknown as ErrorRequestHandler;
  }

  return (error, req, _res, next) => {
    logExceptionFallback(error, {
      request: {
        method: req.method,
        url: req.originalUrl,
      },
    });
    next(error);
  };
}

/**
 * Legacy function for request handler - no-op since express integration handles it.
 * Kept for compatibility with the API service integration.
 */
export function sentryRequestHandler(): (req: Request, res: Response, next: NextFunction) => void {
  return (_req, _res, next) => next();
}

/**
 * Capture an exception with additional context.
 * Useful for errors that don't propagate through Express middleware.
 *
 * @param error - The error to report
 * @param context - Additional context data
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!isInitialized || !sentrySdk) {
    logExceptionFallback(error, context);
    return;
  }

  try {
    sentrySdk.withScope((scope) => {
      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          scope.setContext(key, value as Record<string, unknown>);
        });
      }
      sentrySdk?.captureException(error);
    });
  } catch (sentryError) {
    logExceptionFallback(error, context, sentryError);
  }
}

/**
 * Flush pending events to Sentry.
 * Should be called during graceful shutdown to ensure all events are sent.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 2000)
 * @returns Promise that resolves when events are flushed or timeout occurs
 */
export async function flushSentry(timeoutMs: number = 2000): Promise<boolean> {
  if (!isInitialized) {
    return Promise.resolve(true);
  }

  return sentrySdk?.close(timeoutMs) ?? Promise.resolve(true);
}
