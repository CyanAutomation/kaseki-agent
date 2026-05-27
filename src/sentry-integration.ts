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

import * as Sentry from '@sentry/node';
import { expressIntegration } from '@sentry/node';
import { spawnSync } from 'child_process';
import { Request, Response, NextFunction } from 'express';

interface SentryConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  sampleRate?: number;
  enabled?: boolean;
}

let isInitialized = false;

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
 */
export function initSentry(customConfig?: Partial<SentryConfig>): void {
  if (isInitialized) {
    return;
  }

  const dsn = customConfig?.dsn || process.env.SENTRY_DSN;
  const enabled = customConfig?.enabled !== undefined
    ? customConfig.enabled
    : process.env.SENTRY_ENABLED === 'true' || process.env.SENTRY_ENABLED === '1' || !!dsn;

  if (!enabled) {
    return;
  }

  if (!dsn) {
    console.warn(
      '⚠️  Sentry is enabled but SENTRY_DSN is not set. Sentry will be disabled. ' +
      'Set SENTRY_DSN environment variable to enable error reporting.'
    );
    return;
  }

  // Detect release version dynamically
  const releaseVersion = customConfig?.release || detectReleaseVersion();

  const config: Sentry.NodeOptions = {
    dsn,
    environment: customConfig?.environment || process.env.SENTRY_ENVIRONMENT || 'production',
    release: releaseVersion,
    tracesSampleRate: customConfig?.sampleRate || parseFloat(process.env.SENTRY_SAMPLE_RATE || '0.1'),
    integrations: [
      expressIntegration(),
    ],
    // Capture breadcrumbs for debugging
    maxBreadcrumbs: 100,
    // Do not send errors if we're in test environment
    beforeSend: (event) => {
      if (process.env.JEST_WORKER_ID) {
        return null;
      }
      return event;
    },
  };

  Sentry.init(config);
  isInitialized = true;
}

/**
 * Get the Express error handler middleware.
 * Should be mounted after all other middleware and route handlers.
 */
export function sentryErrorHandler(): any {
  return Sentry.expressErrorHandler();
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
  if (!isInitialized) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value as Record<string, unknown>);
      });
    }
    Sentry.captureException(error);
  });
}

/**
 * Add a breadcrumb for debugging.
 * Breadcrumbs are automatically captured for HTTP requests and other events.
 *
 * @param message - Breadcrumb message
 * @param category - Breadcrumb category (e.g., 'auth', 'validation', 'database')
 * @param level - Severity level
 * @param data - Additional data
 */
export function addBreadcrumb(
  message: string,
  category: string,
  level: Sentry.SeverityLevel = 'info',
  data?: Record<string, unknown>
): void {
  if (!isInitialized) {
    return;
  }

  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
  });
}

/**
 * Set user context for error reporting.
 *
 * @param userId - Unique identifier for the user/client
 * @param email - User email (optional)
 * @param username - Username (optional)
 * @param ipAddress - IP address (optional)
 */
export function setUserContext(
  userId: string,
  { email, username, ipAddress }: { email?: string; username?: string; ipAddress?: string } = {}
): void {
  if (!isInitialized) {
    return;
  }

  Sentry.setUser({
    id: userId,
    email,
    username,
    ip_address: ipAddress,
  });
}

/**
 * Clear user context (e.g., on logout).
 */
export function clearUserContext(): void {
  if (!isInitialized) {
    return;
  }

  Sentry.setUser(null);
}

/**
 * Set tags for error context and filtering.
 * Tags are indexed and can be used for filtering in the Sentry dashboard.
 *
 * @param tags - Object with tag key-value pairs
 */
export function setTags(tags: Record<string, string>): void {
  if (!isInitialized) {
    return;
  }

  Object.entries(tags).forEach(([key, value]) => {
    Sentry.setTag(key, value);
  });
}

/**
 * Set extra context data.
 * Extra data is not indexed and should be used for large data objects.
 *
 * @param context - Object with context data
 */
export function setExtraContext(context: Record<string, unknown>): void {
  if (!isInitialized) {
    return;
  }

  Object.entries(context).forEach(([key, value]) => {
    Sentry.setExtra(key, value);
  });
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

  return Sentry.close(timeoutMs);
}

/**
 * Check if Sentry is initialized and enabled.
 */
export function isSentryEnabled(): boolean {
  return isInitialized;
}
