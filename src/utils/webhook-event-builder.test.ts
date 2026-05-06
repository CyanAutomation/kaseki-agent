import {
  createJobSubmittedEvent,
  createJobStartedEvent,
  createJobCompletedEvent,
  createJobCancelledEvent,
  createJobFailedEvent,
} from './webhook-event-builder';
import { WebhookEventType } from '../kaseki-api-types';

describe('webhook-event-builder', () => {
  describe('createJobSubmittedEvent', () => {
    it('should create a JOB_SUBMITTED event', () => {
      const event = createJobSubmittedEvent('job-123');

      expect(event.eventType).toBe(WebhookEventType.JOB_SUBMITTED);
      expect(event.jobId).toBe('job-123');
      expect(event.data.status).toBe('queued');
      expect(event.timestamp).toBeTruthy();
    });
  });

  describe('createJobStartedEvent', () => {
    it('should create a JOB_STARTED event', () => {
      const event = createJobStartedEvent('job-456');

      expect(event.eventType).toBe(WebhookEventType.JOB_STARTED);
      expect(event.jobId).toBe('job-456');
      expect(event.data.status).toBe('running');
    });
  });

  describe('createJobCompletedEvent', () => {
    it('should create a JOB_COMPLETED event without exit code', () => {
      const event = createJobCompletedEvent('job-789');

      expect(event.eventType).toBe(WebhookEventType.JOB_COMPLETED);
      expect(event.jobId).toBe('job-789');
      expect(event.data.status).toBe('completed');
      expect((event.data as any).exitCode).toBeUndefined();
    });

    it('should include exit code when provided', () => {
      const event = createJobCompletedEvent('job-789', 0);

      expect((event.data as any).exitCode).toBe(0);
    });

    it('should not include null exit code', () => {
      const event = createJobCompletedEvent('job-789', null);

      expect((event.data as any).exitCode).toBeUndefined();
    });
  });

  describe('createJobCancelledEvent', () => {
    it('should create a JOB_CANCELLED event', () => {
      const event = createJobCancelledEvent('job-111');

      expect(event.eventType).toBe(WebhookEventType.JOB_CANCELLED);
      expect(event.jobId).toBe('job-111');
      expect(event.data.status).toBe('failed');
      expect((event.data as any).failureClass).toBe('cancelled');
    });

    it('should include error message when provided', () => {
      const event = createJobCancelledEvent('job-111', 'User requested cancellation');

      expect((event.data as any).error).toBe('User requested cancellation');
    });

    it('should not include error when not provided', () => {
      const event = createJobCancelledEvent('job-111');

      expect((event.data as any).error).toBeUndefined();
    });
  });

  describe('createJobFailedEvent', () => {
    it('should create a JOB_FAILED event with all details', () => {
      const event = createJobFailedEvent('job-222', 'validation-error', 'Validation failed', 1);

      expect(event.eventType).toBe(WebhookEventType.JOB_FAILED);
      expect(event.jobId).toBe('job-222');
      expect(event.data.status).toBe('failed');
      expect((event.data as any).failureClass).toBe('validation-error');
      expect((event.data as any).error).toBe('Validation failed');
      expect((event.data as any).exitCode).toBe(1);
    });

    it('should create a JOB_FAILED event with minimal details', () => {
      const event = createJobFailedEvent('job-222');

      expect(event.eventType).toBe(WebhookEventType.JOB_FAILED);
      expect(event.data.status).toBe('failed');
      expect((event.data as any).failureClass).toBeUndefined();
      expect((event.data as any).error).toBeUndefined();
      expect((event.data as any).exitCode).toBeUndefined();
    });

    it('should not include null exit code', () => {
      const event = createJobFailedEvent('job-222', 'error', 'Failed', null as any);

      expect((event.data as any).exitCode).toBeUndefined();
    });

    it('should not include undefined failureClass', () => {
      const event = createJobFailedEvent('job-222', undefined, 'Error message');

      expect((event.data as any).failureClass).toBeUndefined();
      expect((event.data as any).error).toBe('Error message');
    });
  });

  describe('Event payload structure', () => {
    it('should have consistent timestamp format', () => {
      const expectedTimestamp = '2026-05-06T12:34:56.789Z';

      jest.useFakeTimers();
      jest.setSystemTime(new Date(expectedTimestamp));

      try {
        const events = [
          createJobSubmittedEvent('job-1'),
          createJobStartedEvent('job-2'),
          createJobCompletedEvent('job-3'),
          createJobCancelledEvent('job-4'),
          createJobFailedEvent('job-5'),
        ];

        for (const event of events) {
          // Webhook timestamps are UTC ISO 8601 strings with millisecond precision.
          expect(event.timestamp).toBe(expectedTimestamp);
          expect(event.timestamp).toMatch(
            /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/
          );
          expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
        }
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
