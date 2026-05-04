import { WebhookEventType, WebhookPayload } from '../kaseki-api-types';

/**
 * Factory functions for creating webhook event payloads.
 * Consolidates webhook event creation logic across job-scheduler.ts.
 */

/**
 * Create a JOB_SUBMITTED event payload.
 */
export function createJobSubmittedEvent(jobId: string): WebhookPayload {
  return {
    eventType: WebhookEventType.JOB_SUBMITTED,
    jobId,
    timestamp: new Date().toISOString(),
    data: {
      status: 'queued',
    },
  };
}

/**
 * Create a JOB_STARTED event payload.
 */
export function createJobStartedEvent(jobId: string): WebhookPayload {
  return {
    eventType: WebhookEventType.JOB_STARTED,
    jobId,
    timestamp: new Date().toISOString(),
    data: {
      status: 'running',
    },
  };
}

/**
 * Create a JOB_COMPLETED event payload.
 */
export function createJobCompletedEvent(jobId: string, exitCode?: number | null): WebhookPayload {
  return {
    eventType: WebhookEventType.JOB_COMPLETED,
    jobId,
    timestamp: new Date().toISOString(),
    data: {
      status: 'completed',
      ...(exitCode !== null && exitCode !== undefined && { exitCode }),
    },
  };
}

/**
 * Create a JOB_CANCELLED event payload.
 */
export function createJobCancelledEvent(jobId: string, error?: string): WebhookPayload {
  return {
    eventType: WebhookEventType.JOB_CANCELLED,
    jobId,
    timestamp: new Date().toISOString(),
    data: {
      status: 'failed',
      failureClass: 'cancelled',
      ...(error && { error }),
    },
  };
}

/**
 * Create a JOB_FAILED event payload.
 */
export function createJobFailedEvent(
  jobId: string,
  failureClass?: string,
  error?: string,
  exitCode?: number
): WebhookPayload {
  return {
    eventType: WebhookEventType.JOB_FAILED,
    jobId,
    timestamp: new Date().toISOString(),
    data: {
      status: 'failed',
      ...(failureClass && { failureClass }),
      ...(error && { error }),
      ...(exitCode !== null && exitCode !== undefined && { exitCode }),
    },
  };
}
