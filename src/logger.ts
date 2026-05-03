/**
 * Centralized logging utility with log level filtering.
 *
 * Emits structured JSON events to stdout, respecting LOG_LEVEL env var.
 * All timestamps are ISO 8601 format.
 *
 * Log levels: debug < info < warn < error
 * - DEBUG: All messages
 * - INFO: info, warn, error (default)
 * - WARN: warn, error
 * - ERROR: error only
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get the log level from environment variable with default.
 */
function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL || process.env.KASEKI_API_LOG_LEVEL || 'info';
  const normalized = envLevel.toLowerCase() as LogLevel;

  if (normalized in LOG_LEVEL_ORDER) {
    return normalized;
  }

  console.error(`Invalid LOG_LEVEL: ${envLevel}, defaulting to info`);
  return 'info';
}

/**
 * Logger instance for a component.
 */
export interface Logger {
  debug(message: string, detail?: Record<string, unknown>): void;
  info(message: string, detail?: Record<string, unknown>): void;
  warn(message: string, detail?: Record<string, unknown>): void;
  error(message: string, detail?: Record<string, unknown>): void;
}

/**
 * Create a logger for a component.
 */
export function createLogger(component: string): Logger {
  const currentLogLevel = getLogLevel();
  const currentLevelOrder = LOG_LEVEL_ORDER[currentLogLevel];

  function shouldLog(messageLevel: LogLevel): boolean {
    return LOG_LEVEL_ORDER[messageLevel] >= currentLevelOrder;
  }

  function emit(level: LogLevel, message: string, detail?: Record<string, unknown>): void {
    if (!shouldLog(level)) {
      return;
    }

    const event = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...(detail && Object.keys(detail).length > 0 && { detail }),
    };

    console.log(JSON.stringify(event));
  }

  return {
    debug: (message: string, detail?: Record<string, unknown>) => emit('debug', message, detail),
    info: (message: string, detail?: Record<string, unknown>) => emit('info', message, detail),
    warn: (message: string, detail?: Record<string, unknown>) => emit('warn', message, detail),
    error: (message: string, detail?: Record<string, unknown>) => emit('error', message, detail),
  };
}

/**
 * Create a logger that can also emit structured events (for progress.jsonl format).
 *
 * Events are JSON objects with timestamp, component, event_type, and optional detail.
 * This is used for structured operational events (job_submitted, stage_started, etc.).
 */
export interface EventLogger extends Logger {
  event(eventType: string, detail?: Record<string, unknown>): void;
}

/**
 * Create an event-capable logger.
 */
export function createEventLogger(component: string): EventLogger {
  const baseLogger = createLogger(component);

  function emitEvent(eventType: string, detail?: Record<string, unknown>): void {
    const event = {
      timestamp: new Date().toISOString(),
      component,
      event_type: eventType,
      ...(detail && Object.keys(detail).length > 0 && detail),
    };

    console.log(JSON.stringify(event));
  }

  return {
    ...baseLogger,
    event: (eventType: string, detail?: Record<string, unknown>) => emitEvent(eventType, detail),
  };
}
