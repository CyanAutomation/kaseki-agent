/**
 * Empty Assistant Turn Tests (TDD)
 *
 * Tests for detecting and handling the case where a provider returns:
 * - HTTP 200 (success)
 * - Output tokens > 0 (claims to have generated tokens)
 * - Assistant content: null/undefined/empty (no actual message)
 *
 * This is the kaseki-170 failure scenario where gateway's openai-responses
 * adapter returns malformed responses.
 */

import { describe, it, expect } from '@jest/globals';

// ============================================================================
// TEST DATA BUILDERS
// ============================================================================

/**
 * Build a valid Pi event with assistant message
 */
function buildValidAssistantEvent(overrides?: Partial<any>): any {
  const messageOverrides = overrides?.message || {};
  const otherOverrides = overrides ? { ...overrides } : {};
  delete otherOverrides.message;

  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      content: 'This is valid assistant content',
      provider: 'gateway',
      api: 'openai-responses',
      model: 'auto',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      },
      response_id: 'resp_valid123',
      ...messageOverrides,
    },
    ...otherOverrides,
  };
}

/**
 * Build a Pi event with EMPTY assistant content (the bug)
 * This mimics kaseki-170 failure: HTTP 200 but no content
 */
function buildEmptyAssistantEvent(overrides?: Partial<any>): any {
  const messageOverrides = overrides?.message || {};
  const otherOverrides = overrides ? { ...overrides } : {};
  delete otherOverrides.message;  // Remove message from top-level to avoid double-merge

  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      content: null,  // ← THE BUG: content is null despite output_tokens
      provider: 'gateway',
      api: 'openai-responses',
      model: 'auto',
      usage: {
        input_tokens: 9019,
        output_tokens: 146,  // ← Claims to have generated 146 tokens!
        total_tokens: 9165,
      },
      response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',  // kaseki-170 response ID
      ...messageOverrides,
    },
    ...otherOverrides,
  };
}

/**
 * Build a Pi event with empty string content (edge case)
 */
function buildEmptyStringAssistantEvent(overrides?: Partial<any>): any {
  const messageOverrides = overrides?.message || {};
  const otherOverrides = overrides ? { ...overrides } : {};
  delete otherOverrides.message;

  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      content: '',  // ← Empty string instead of null
      provider: 'gateway',
      api: 'openai-responses',
      model: 'auto',
      usage: {
        input_tokens: 100,
        output_tokens: 42,
        total_tokens: 142,
      },
      response_id: 'resp_empty_string',
      ...messageOverrides,
    },
    ...otherOverrides,
  };
}

/**
 * Build a valid event with tool calls (not empty even without text)
 */
function buildToolCallEvent(overrides?: Partial<any>): any {
  const messageOverrides = overrides?.message || {};
  const otherOverrides = overrides ? { ...overrides } : {};
  delete otherOverrides.message;

  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      content: null,  // No text content
      tool_calls: [
        {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'analyze_code',
            arguments: '{"file": "src/index.ts"}',
          },
        },
      ],
      provider: 'gateway',
      api: 'openai-responses',
      model: 'auto',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      },
      response_id: 'resp_tool_call',
      ...messageOverrides,
    },
    ...otherOverrides,
  };
}

// ============================================================================
// DETECTION FUNCTION (Implementation to be added)
// ============================================================================

/**
 * Detects if an event represents an empty assistant turn from provider
 *
 * Returns: Diagnostic info if empty, null otherwise
 */
function detectEmptyAssistantTurn(event: any): {
  detected: boolean;
  provider?: string;
  api?: string;
  model?: string;
  responseId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reason?: string;
} {
  const message = event?.message;
  if (!message || typeof message !== 'object' || message.role !== 'assistant') {
    return { detected: false };
  }

  const stopReason = typeof message.stopReason === 'string' ? message.stopReason.trim() : '';
  if (stopReason !== 'stop') {
    return { detected: false };
  }

  // Check if there are output tokens claimed
  const outputTokens = message.usage?.output_tokens ?? message.usage?.completion_tokens;
  if (!outputTokens || outputTokens <= 0) {
    return { detected: false };
  }

  // Check if content is empty or missing
  const hasContent = message.content && typeof message.content === 'string' && message.content.trim().length > 0;
  const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;

  if (hasContent || hasToolCalls) {
    return { detected: false };  // Has actual content, not empty
  }

  // This is an empty assistant turn with output tokens claimed!
  return {
    detected: true,
    provider: message.provider,
    api: message.api,
    model: message.model,
    responseId: message.response_id,
    inputTokens: message.usage?.input_tokens ?? message.usage?.prompt_tokens,
    outputTokens,
    totalTokens: message.usage?.total_tokens,
    reason: `Provider returned stop response with ${outputTokens} output tokens but no assistant text or tool calls`,
  };
}

// ============================================================================
// RESPONSE VALIDATION (To be implemented in gateway adapter)
// ============================================================================

/**
 * Validates that a provider response is well-formed
 * Should be called BEFORE returning response to Pi CLI
 */
function validateProviderResponse(response: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!response || typeof response !== 'object') {
    errors.push('Response is not an object');
    return { valid: false, errors };
  }

  const message = response.message;
  if (!message || typeof message !== 'object') {
    errors.push('Response does not contain message object');
    return { valid: false, errors };
  }

  // Check usage fields
  const usage = response.usage || {};
  const outputTokens = usage.output_tokens ?? usage.completion_tokens;

  // CRITICAL: If output tokens claimed, content must exist
  if (outputTokens && outputTokens > 0 && message.role === 'assistant') {
    const hasContent = message.content && typeof message.content === 'string' && message.content.trim().length > 0;
    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;

    if (!hasContent && !hasToolCalls) {
      errors.push(
        `Output tokens (${outputTokens}) claimed but no assistant content or tool calls present. ` +
        `This indicates a provider/adapter bug. Response ID: ${response.response_id}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Empty Assistant Turn Detection', () => {
  describe('detectEmptyAssistantTurn()', () => {
    it('should return detected=false for valid assistant messages with content', () => {
      const event = buildValidAssistantEvent();
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(false);
    });

    it('should detect empty assistant turn with null content and output tokens (kaseki-170)', () => {
      const event = buildEmptyAssistantEvent();
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(true);
      expect(result.outputTokens).toBe(146);
      expect(result.provider).toBe('gateway');
      expect(result.api).toBe('openai-responses');
      expect(result.responseId).toBe('resp_4e859d2bfb3a457cb34d1e485d0b2958');
      expect(result.reason).toContain('146 output tokens');
    });

    it('should detect empty assistant turn with empty string content', () => {
      const event = buildEmptyStringAssistantEvent();
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(true);
      expect(result.outputTokens).toBe(42);
    });

    it('should NOT detect as empty if there are tool calls (valid fallback)', () => {
      const event = buildToolCallEvent();
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(false);  // Has tool calls, so not empty
    });

    it('should NOT detect as empty if stopReason is not "stop"', () => {
      const event = buildEmptyAssistantEvent({
        message: { stopReason: 'length' },
      });
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(false);
    });

    it('should NOT detect as empty if output_tokens is 0 or missing', () => {
      const event = buildEmptyAssistantEvent({
        message: {
          usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 },
        },
      });
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(false);
    });

    it('should NOT detect as empty if message is not assistant role', () => {
      const event = buildEmptyAssistantEvent({
        message: { role: 'user' },
      });
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(false);
    });
  });

  describe('Response Validation', () => {
    it('should validate that response is well-formed', () => {
      const response = {
        message: {
          role: 'assistant',
          content: 'Valid response text',
        },
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
        },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject response with output tokens but no assistant content (kaseki-170 bug)', () => {
      const response = {
        message: {
          role: 'assistant',
          content: null,
        },
        usage: {
          input_tokens: 9019,
          output_tokens: 146,  // Claims output but no content!
          total_tokens: 9165,
        },
        response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Output tokens');  // Capitalized in error message
      expect(result.errors[0]).toContain('no assistant');
      expect(result.errors[0]).toContain('resp_4e859d2bfb3a457cb34d1e485d0b2958');
    });

    it('should reject response with output tokens but empty string content', () => {
      const response = {
        message: {
          role: 'assistant',
          content: '',  // Empty string
        },
        usage: {
          output_tokens: 42,
        },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(false);
    });

    it('should accept response with tool calls but no text content', () => {
      const response = {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'analyze',
                arguments: '{}',
              },
            },
          ],
        },
        usage: {
          output_tokens: 50,
        },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(true);  // Tool calls are valid even without text
    });

    it('should not require content if output_tokens is 0', () => {
      const response = {
        message: {
          role: 'assistant',
          content: null,
        },
        usage: {
          output_tokens: 0,
        },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(true);  // No tokens claimed, so no content required
    });

    it('should reject malformed response without message', () => {
      const response = {
        usage: { output_tokens: 50 },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('message object');
    });
  });

  describe('Diagnostic Information', () => {
    it('should extract detailed diagnostic info from empty assistant turn', () => {
      const event = buildEmptyAssistantEvent();
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(true);
      expect(result.provider).toBe('gateway');
      expect(result.api).toBe('openai-responses');
      expect(result.model).toBe('auto');
      expect(result.inputTokens).toBe(9019);
      expect(result.outputTokens).toBe(146);
      expect(result.totalTokens).toBe(9165);
      expect(result.responseId).toBe('resp_4e859d2bfb3a457cb34d1e485d0b2958');
    });

    it('should format diagnostic reason for logging', () => {
      const event = buildEmptyAssistantEvent();
      const result = detectEmptyAssistantTurn(event);

      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('146');
      expect(result.reason).toContain('output tokens');
    });
  });

  describe('Edge Cases', () => {
    it('should handle events without message property', () => {
      const event = { type: 'some_event' };
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(false);
    });

    it('should handle events with non-object message', () => {
      const event = { message: 'not an object' };
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(false);
    });

    it('should handle missing usage field', () => {
      const event = {
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: null,
          // No usage field
        },
      };
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(false);  // No output tokens to claim
    });

    it('should handle undefined stopReason', () => {
      const event = buildEmptyAssistantEvent({
        message: { stopReason: undefined },
      });
      const result = detectEmptyAssistantTurn(event);

      expect(result.detected).toBe(false);
    });

    it('should handle whitespace-only content as non-empty (has characters)', () => {
      // Whitespace-only content is technically "has content" even if it's just spaces
      // The detection looks for trim().length > 0, so whitespace is treated as empty
      const event = buildEmptyAssistantEvent({
        message: { content: '   \n\t  ' },
      });
      const result = detectEmptyAssistantTurn(event);

      // Whitespace-only is actually detected as empty since trim() removes it
      expect(result.detected).toBe(true);
    });
  });
});

describe('Provider Response Integration', () => {
  describe('Kaseki-170 Scenario', () => {
    it('should detect the exact kaseki-170 failure signature', () => {
      // Exact reproduction of kaseki-170 error
      const kaseki170Event = {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: null,
          provider: 'gateway',
          api: 'openai-responses',
          model: 'auto',
          response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',
          usage: {
            input_tokens: 9019,
            output_tokens: 146,
            total_tokens: 9165,
          },
        },
      };

      const detection = detectEmptyAssistantTurn(kaseki170Event);
      const validation = validateProviderResponse(kaseki170Event.message);

      expect(detection.detected).toBe(true);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should provide actionable diagnostics for debugging', () => {
      const event = buildEmptyAssistantEvent();
      const result = detectEmptyAssistantTurn(event);

      // These fields should be logged for gateway debugging
      expect(result.responseId).toBeDefined();
      expect(result.outputTokens).toBeDefined();
      expect(result.inputTokens).toBeDefined();

      // This should appear in error logs
      const message = result.reason || '';
      expect(message).toContain('146');
      expect(message).toContain('output tokens');
      expect(message).toContain('no assistant');
    });
  });
});
