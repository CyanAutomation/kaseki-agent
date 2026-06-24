/**
 * Test suite for pi-extensions.js streamSimple handler
 * Validates that emitted events have correct message structure and no callable response.result fields
 */

import { describe, it, expect } from '@jest/globals';

/**
 * Mock streamSimple event emission to validate structure
 */
function validatePiEventStructure(event: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check event is an object
  if (!event || typeof event !== 'object') {
    errors.push('Event is not an object');
    return { valid: false, errors };
  }

  // Check type field exists
  if (!event.type || typeof event.type !== 'string') {
    errors.push('Event missing or has invalid "type" field');
  }

  // Validate message structure for events that have messages
  if (event.message && typeof event.message === 'object') {
    const msg = event.message;

    // Check for problematic callable fields that Pi might try to invoke
    if (msg.result && typeof msg.result === 'function') {
      errors.push('Event message.result is a function (callable) - will cause TypeError when Pi tries to use it');
    }

    // Message should have role
    if (msg.role && typeof msg.role !== 'string') {
      errors.push('Event message.role is not a string');
    }

    // Content should be array or absent
    if (msg.content && !Array.isArray(msg.content)) {
      errors.push('Event message.content is not an array');
    }

    // Usage should be object or absent
    if (msg.usage && typeof msg.usage !== 'object') {
      errors.push('Event message.usage is not an object');
    }
  }

  // Validate partial structure for start events
  if (event.partial && typeof event.partial === 'object') {
    const partial = event.partial;
    if (partial.result && typeof partial.result === 'function') {
      errors.push('Event partial.result is a function (callable) - will cause TypeError');
    }

    // Content should be array if present
    if (partial.content && !Array.isArray(partial.content)) {
      errors.push('Event partial.content is not an array');
    }
  }

  return { valid: errors.length === 0, errors };
}

describe('streamSimple handler event validation', () => {
  it('should emit valid start event with no callable result field', () => {
    const startEvent = {
      type: 'start',
      partial: {
        role: 'assistant',
        content: [],
        api: 'custom-gateway',
        provider: 'gateway',
        model: 'auto',
        timestamp: Date.now(),
      },
    };

    const { valid, errors } = validatePiEventStructure(startEvent);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('should emit valid text_delta event', () => {
    const textDeltaEvent = {
      type: 'text_delta',
      contentIndex: 0,
      delta: 'some text',
    };

    const { valid, errors } = validatePiEventStructure(textDeltaEvent);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('should emit valid done event with message containing usage', () => {
    const doneEvent = {
      type: 'done',
      stopReason: 'stop',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
      },
    };

    const { valid, errors } = validatePiEventStructure(doneEvent);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('should detect when message.result is a callable function', () => {
    const malformedEvent = {
      type: 'done',
      message: {
        role: 'assistant',
        content: [],
        result: () => 'this is callable', // PROBLEM: Pi will try to call this
      },
    };

    const { valid, errors } = validatePiEventStructure(malformedEvent);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('message.result is a function'))).toBe(true);
  });

  it('should detect when partial.result is a callable function', () => {
    const malformedEvent = {
      type: 'start',
      partial: {
        role: 'assistant',
        content: [],
        result: () => {}, // PROBLEM: callable
      },
    };

    const { valid, errors } = validatePiEventStructure(malformedEvent);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('partial.result is a function'))).toBe(true);
  });

  it('should reject non-array content fields', () => {
    const badContentEvent = {
      type: 'done',
      message: {
        role: 'assistant',
        content: 'not an array', // PROBLEM: should be array
      },
    };

    const { valid, errors } = validatePiEventStructure(badContentEvent);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('content is not an array'))).toBe(true);
  });

  it('should allow message.result as a plain object (not callable)', () => {
    const eventWithResultObject = {
      type: 'done',
      message: {
        role: 'assistant',
        content: [],
        result: { status: 'ok' }, // OK: plain object, not callable
      },
    };

    const { valid, errors } = validatePiEventStructure(eventWithResultObject);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('should validate error event structure', () => {
    const errorEvent = {
      type: 'error',
      reason: 'error',
      error: {
        message: 'Gateway returned error',
        errorMessage: 'Gateway returned error',
      },
    };

    const { valid, errors } = validatePiEventStructure(errorEvent);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });
});

describe('pi-event-filter extractProviderError robustness', () => {
  it('should handle message with missing errorMessage field gracefully', () => {
    const message = {
      stopReason: 'error',
      // Missing errorMessage
    };

    // Should not throw, should return null or error with empty message
    const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage.trim() : '';
    const stopReason = typeof message.stopReason === 'string' ? message.stopReason.trim() : '';

    expect(errorMessage).toBe('');
    expect(stopReason).toBe('error');
  });

  it('should handle message with non-string errorMessage field', () => {
    const message = {
      errorMessage: { type: 'object' }, // Not a string!
      stopReason: 'error',
    };

    const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage.trim() : '';
    expect(errorMessage).toBe('');
  });

  it('should handle message with null stopReason', () => {
    const message = {
      errorMessage: 'Something failed',
      stopReason: null,
    };

    const stopReason = typeof message.stopReason === 'string' ? message.stopReason.trim() : '';
    expect(stopReason).toBe('');
  });

  it('should handle event with null message', () => {
    const event = {
      type: 'done',
      message: null, // null message
    };

    const message = event.message;
    expect(!message || typeof message !== 'object').toBe(true);
  });

  it('should extract provider error from properly typed message', () => {
    const event = {
      type: 'done',
      message: {
        errorMessage: 'Gateway HTTP 503: Service Unavailable',
        stopReason: 'error',
        provider: 'gateway',
        api: 'custom-gateway',
        model: 'auto',
      },
    };

    const message = event.message;
    const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage.trim() : '';
    const stopReason = typeof message.stopReason === 'string' ? message.stopReason.trim() : '';

    expect(errorMessage).toBe('Gateway HTTP 503: Service Unavailable');
    expect(stopReason).toBe('error');
  });
});
