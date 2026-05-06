import { normalizeProgressEvent, toStructuredProgress } from './progress-normalizer';

describe('progress-normalizer', () => {
  describe('normalizeProgressEvent', () => {
    it('should preserve existing message and updatedAt', () => {
      const event = {
        stage: 'building',
        message: 'Building the project',
        updatedAt: '2026-05-05T10:00:00Z',
      };
      const result = normalizeProgressEvent(event);
      expect(result).toEqual(event);
    });

    it('should use detail as message when message is missing but detail is provided', () => {
      const event = {
        stage: 'building',
        detail: 'Compiling TypeScript',
      };
      const result = normalizeProgressEvent(event);
      expect(result.message).toBe('Compiling TypeScript');
      expect(result.stage).toBe('building');
    });

    it('should use stage as message when both message and detail are missing', () => {
      const event = {
        stage: 'testing',
      };
      const result = normalizeProgressEvent(event);
      expect(result.message).toBe('testing');
    });

    it('should not override message if it already exists', () => {
      const event = {
        stage: 'testing',
        message: 'Running tests',
        detail: 'This should be ignored',
      };
      const result = normalizeProgressEvent(event);
      expect(result.message).toBe('Running tests');
    });

    it('should use timestamp as updatedAt when updatedAt is missing', () => {
      const event = {
        stage: 'running',
        message: 'Agent running',
        timestamp: '2026-05-05T10:30:00Z',
      };
      const result = normalizeProgressEvent(event);
      expect(result.updatedAt).toBe('2026-05-05T10:30:00Z');
    });

    it('should not override updatedAt if it already exists', () => {
      const event = {
        stage: 'running',
        updatedAt: '2026-05-05T10:30:00Z',
        timestamp: '2026-05-05T10:00:00Z',
      };
      const result = normalizeProgressEvent(event);
      expect(result.updatedAt).toBe('2026-05-05T10:30:00Z');
    });

    it('should handle non-string stage (should not set message)', () => {
      const event = {
        stage: 123,
        detail: 'Some detail',
      };
      const result = normalizeProgressEvent(event);
      expect(result.message).toBeUndefined();
    });

    it('should ignore non-string message and non-string detail', () => {
      const event = {
        stage: 'running',
        message: null,
        detail: undefined,
      };
      const result = normalizeProgressEvent(event);
      expect(result.message).toBe('running');
    });

    it('should ignore non-string timestamp', () => {
      const event = {
        stage: 'running',
        timestamp: 12345,
      };
      const result = normalizeProgressEvent(event);
      expect(result.updatedAt).toBeUndefined();
    });

    it('should preserve additional properties', () => {
      const event = {
        stage: 'building',
        message: 'Compiling',
        updatedAt: '2026-05-05T10:00:00Z',
        customField: 'custom value',
        progress: 50,
      };
      const result = normalizeProgressEvent(event);
      expect(result.customField).toBe('custom value');
      expect(result.progress).toBe(50);
    });

    it('should handle empty event object', () => {
      const event = {};
      const result = normalizeProgressEvent(event);
      expect(result).toEqual({});
    });
  });

  describe('toStructuredProgress', () => {
    it('should create valid StructuredProgress with all fields', () => {
      const event = {
        stage: 'building',
        message: 'Compiling',
        percentComplete: 50,
        updatedAt: '2026-05-05T10:00:00Z',
      };
      const result = toStructuredProgress(event);
      expect(result).toEqual({
        stage: 'building',
        message: 'Compiling',
        percentComplete: 50,
        updatedAt: '2026-05-05T10:00:00Z',
      });
    });

    it('should use fallbackStage when stage is missing', () => {
      const event = { message: 'Processing' };
      const result = toStructuredProgress(event);
      expect(result?.stage).toBe('running');
      expect(result?.message).toBe('Processing');
    });

    it('should use custom fallbackStage parameter', () => {
      const event = { message: 'Processing' };
      const result = toStructuredProgress(event, 'custom-stage');
      expect(result?.stage).toBe('custom-stage');
    });

    it('should use fallbackStage when stage is not a string', () => {
      const event = {
        stage: 123,
        message: 'Processing',
      };
      const result = toStructuredProgress(event);
      expect(result?.stage).toBe('running');
    });

    it('should trim whitespace from stage', () => {
      const event = {
        stage: '  building  ',
        message: 'Compiling',
      };
      const result = toStructuredProgress(event);
      expect(result?.stage).toBe('building');
    });

    it('should return null when stage (and fallback) is empty after trim', () => {
      const event = {
        stage: '   ',
      };
      const result = toStructuredProgress(event);
      expect(result).toBeNull();
    });

    it('should return null when fallbackStage is empty', () => {
      const event = { message: 'Processing' };
      const result = toStructuredProgress(event, '');
      expect(result).toBeNull();
    });

    it('should prioritize message over detail', () => {
      const event = {
        stage: 'building',
        message: 'Using this message',
        detail: 'Not this one',
      };
      const result = toStructuredProgress(event);
      expect(result?.message).toBe('Using this message');
    });

    it('should use detail when message is missing', () => {
      const event = {
        stage: 'building',
        detail: 'Using this detail',
      };
      const result = toStructuredProgress(event);
      expect(result?.message).toBe('Using this detail');
    });

    it('should use stage as message fallback', () => {
      const event = {
        stage: 'building',
      };
      const result = toStructuredProgress(event);
      expect(result?.message).toBe('building');
    });

    it('should ignore non-string message', () => {
      const event = {
        stage: 'building',
        message: 123,
        detail: 'Detail message',
      };
      const result = toStructuredProgress(event);
      expect(result?.message).toBe('Detail message');
    });

    it('should ignore non-string detail', () => {
      const event = {
        stage: 'building',
        message: 'Main message',
        detail: null,
      };
      const result = toStructuredProgress(event);
      expect(result?.message).toBe('Main message');
    });

    it('should prioritize percentComplete over percent', () => {
      const event = {
        stage: 'running',
        percentComplete: 75,
        percent: 50,
      };
      const result = toStructuredProgress(event);
      expect(result?.percentComplete).toBe(75);
    });

    it('should use percent when percentComplete is missing', () => {
      const event = {
        stage: 'running',
        percent: 60,
      };
      const result = toStructuredProgress(event);
      expect(result?.percentComplete).toBe(60);
    });

    it('should ignore non-number percentComplete', () => {
      const event = {
        stage: 'running',
        percentComplete: '75',
        percent: 50,
      };
      const result = toStructuredProgress(event);
      expect(result?.percentComplete).toBe(50);
    });

    it('should ignore non-number percent', () => {
      const event = {
        stage: 'running',
        percent: '60',
      };
      const result = toStructuredProgress(event);
      expect(result?.percentComplete).toBeUndefined();
    });

    it('should prioritize updatedAt over timestamp', () => {
      const event = {
        stage: 'running',
        updatedAt: '2026-05-05T10:30:00Z',
        timestamp: '2026-05-05T10:00:00Z',
      };
      const result = toStructuredProgress(event);
      expect(result?.updatedAt).toBe('2026-05-05T10:30:00Z');
    });

    it('should use timestamp when updatedAt is missing', () => {
      const event = {
        stage: 'running',
        timestamp: '2026-05-05T10:00:00Z',
      };
      const result = toStructuredProgress(event);
      expect(result?.updatedAt).toBe('2026-05-05T10:00:00Z');
    });

    it('should ignore non-string updatedAt', () => {
      const event = {
        stage: 'running',
        updatedAt: 12345,
        timestamp: '2026-05-05T10:00:00Z',
      };
      const result = toStructuredProgress(event);
      expect(result?.updatedAt).toBe('2026-05-05T10:00:00Z');
    });

    it('should ignore non-string timestamp', () => {
      const event = {
        stage: 'running',
        timestamp: 12345,
      };
      const result = toStructuredProgress(event);
      expect(result?.updatedAt).toBeUndefined();
    });

    it('should handle undefined percentComplete and timestamp', () => {
      const event = {
        stage: 'running',
        message: 'In progress',
      };
      const result = toStructuredProgress(event);
      expect(result).toEqual({
        stage: 'running',
        message: 'In progress',
        percentComplete: undefined,
        updatedAt: undefined,
      });
    });

    it('should handle percentComplete of 0', () => {
      const event = {
        stage: 'running',
        percentComplete: 0,
      };
      const result = toStructuredProgress(event);
      expect(result?.percentComplete).toBe(0);
    });

    it('should handle percentComplete of 100', () => {
      const event = {
        stage: 'completed',
        percentComplete: 100,
      };
      const result = toStructuredProgress(event);
      expect(result?.percentComplete).toBe(100);
    });

    it('should return null when stage is empty string (no fallback even with fallback parameter)', () => {
      const event = {
        stage: '',
      };
      const result = toStructuredProgress(event, 'fallback-stage');
      expect(result).toBeNull();
    });

  });

  describe('integration: normalizeProgressEvent → toStructuredProgress', () => {
    it('should work together with field remapping without mutating the source event', () => {
      const event = {
        stage: 'testing',
        detail: 'Running unit tests',
        percent: 75,
        timestamp: '2026-05-05T10:00:00Z',
        runId: 'run-123',
      };

      const normalized = normalizeProgressEvent(event);
      const structured = toStructuredProgress(normalized);

      expect(normalized).toEqual({
        stage: 'testing',
        detail: 'Running unit tests',
        percent: 75,
        timestamp: '2026-05-05T10:00:00Z',
        runId: 'run-123',
        message: 'Running unit tests',
        updatedAt: '2026-05-05T10:00:00Z',
      });
      const originalEvent = { ...event };
      expect(event).toEqual(originalEvent);
      expect(event).not.toHaveProperty('message');
      expect(event).not.toHaveProperty('updatedAt');
      expect(structured).toEqual({
        stage: 'testing',
        message: 'Running unit tests',
        percentComplete: 75,
        updatedAt: '2026-05-05T10:00:00Z',
      });
    });

    it('should preserve client-visible fields from a progress.jsonl event', () => {
      const line = JSON.stringify({
        timestamp: '2026-05-05T10:00:00.000Z',
        updatedAt: '2026-05-05T10:00:00.000Z',
        stage: 'pi coding agent',
        message: 'working; events=5, tool starts=2, tool ends=1',
        percentComplete: 45,
        counts: { assistant_message: 2, tool_start: 2, tool_end: 1 },
        toolStartCount: 2,
        toolEndCount: 1,
        messageUpdateCount: 2,
        reason: 'events',
      });

      const normalized = normalizeProgressEvent(JSON.parse(line));
      const structured = toStructuredProgress(normalized);

      expect(structured).toEqual({
        stage: 'pi coding agent',
        message: 'working; events=5, tool starts=2, tool ends=1',
        percentComplete: 45,
        updatedAt: '2026-05-05T10:00:00.000Z',
      });
    });

    it('should handle missing fields gracefully in pipeline', () => {
      const event = {
        stage: 'running',
      };
      const normalized = normalizeProgressEvent(event);
      const structured = toStructuredProgress(normalized);
      expect(structured?.stage).toBe('running');
      expect(structured?.message).toBe('running');
      expect(structured?.percentComplete).toBeUndefined();
      expect(structured?.updatedAt).toBeUndefined();
    });
  });
});
