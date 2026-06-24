/**
 * Unit tests for pi-event-sanitizer
 * Tests validation and sanitization of Pi events
 */

import { validatePiEvent, sanitizePiEvent } from '../../src/utils/pi-event-sanitizer.js';

describe('pi-event-sanitizer', () => {
  describe('validatePiEvent', () => {
    it('should validate correct start event', () => {
      const event = {
        type: 'start',
        partial: {
          role: 'assistant',
          content: [],
        },
      };

      const result = validatePiEvent(event);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate correct done event with message', () => {
      const event = {
        type: 'done',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'response' }],
        },
      };

      const result = validatePiEvent(event);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect event with missing type', () => {
      const event = {
        partial: { role: 'assistant' },
      };

      const result = validatePiEvent(event);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('type'))).toBe(true);
    });

    it('should detect callable message.result', () => {
      const event = {
        type: 'done',
        message: {
          role: 'assistant',
          result: () => 'callable', // PROBLEM
        },
      };

      const result = validatePiEvent(event);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('message.result is a function'))).toBe(true);
    });

    it('should detect callable partial.result', () => {
      const event = {
        type: 'start',
        partial: {
          role: 'assistant',
          result: () => {}, // PROBLEM
        },
      };

      const result = validatePiEvent(event);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('partial.result is a function'))).toBe(true);
    });

    it('should detect callable result in message.content parts', () => {
      const event = {
        type: 'done',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_call', result: () => {} }, // PROBLEM in content part
          ],
        },
      };

      const result = validatePiEvent(event);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('content'))).toBe(true);
    });

    it('should allow plain object result (not callable)', () => {
      const event = {
        type: 'done',
        message: {
          role: 'assistant',
          result: { status: 'ok' }, // OK: plain object
        },
      };

      const result = validatePiEvent(event);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return sanitized event in validation result when invalid', () => {
      const event = {
        type: 'done',
        message: {
          role: 'assistant',
          result: () => 'callable',
        },
      };

      const result = validatePiEvent(event);
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBeDefined();
      expect(result.sanitized.message.result).toBeUndefined();
    });
  });

  describe('sanitizePiEvent', () => {
    it('should remove callable message.result', () => {
      const event = {
        type: 'done',
        message: {
          role: 'assistant',
          content: [],
          result: () => 'callable',
        },
      };

      const sanitized = sanitizePiEvent(event);
      expect(sanitized.message.result).toBeUndefined();
      expect(sanitized.message.role).toBe('assistant');
    });

    it('should remove callable partial.result', () => {
      const event = {
        type: 'start',
        partial: {
          role: 'assistant',
          result: () => {},
        },
      };

      const sanitized = sanitizePiEvent(event);
      expect(sanitized.partial.result).toBeUndefined();
      expect(sanitized.partial.role).toBe('assistant');
    });

    it('should remove callable result from content parts', () => {
      const event = {
        type: 'done',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'hello', result: () => {} },
            { type: 'tool', result: () => 'another' },
          ],
        },
      };

      const sanitized = sanitizePiEvent(event);
      expect(sanitized.message.content[0].result).toBeUndefined();
      expect(sanitized.message.content[1].result).toBeUndefined();
      expect(sanitized.message.content[0].text).toBe('hello');
    });

    it('should preserve non-callable fields', () => {
      const event = {
        type: 'done',
        message: {
          role: 'assistant',
          model: 'gpt-4',
          api: 'openai',
          provider: 'openrouter',
        },
      };

      const sanitized = sanitizePiEvent(event);
      expect(sanitized.message.role).toBe('assistant');
      expect(sanitized.message.model).toBe('gpt-4');
      expect(sanitized.message.api).toBe('openai');
      expect(sanitized.message.provider).toBe('openrouter');
    });

    it('should handle null message gracefully', () => {
      const event = {
        type: 'done',
        message: null,
      };

      expect(() => sanitizePiEvent(event)).not.toThrow();
      const sanitized = sanitizePiEvent(event);
      expect(sanitized.message).toBeNull();
    });

    it('should handle error object with callable result', () => {
      const event = {
        type: 'error',
        error: {
          message: 'Something failed',
          result: () => {},
        },
      };

      const sanitized = sanitizePiEvent(event);
      expect(sanitized.error.result).toBeUndefined();
      expect(sanitized.error.message).toBe('Something failed');
    });

    it('should preserve usage metrics', () => {
      const event = {
        type: 'done',
        message: {
          role: 'assistant',
          content: [],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        },
      };

      const sanitized = sanitizePiEvent(event);
      expect(sanitized.message.usage.input_tokens).toBe(100);
      expect(sanitized.message.usage.output_tokens).toBe(50);
    });
  });
});
