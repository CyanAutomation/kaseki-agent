/**
 * Unit Tests: Provider Response Validation Module
 *
 * Tests the response validation logic that prevents empty assistant turns
 * from being processed silently.
 */

import {
  validateProviderResponse,
  extractEmptyAssistantDiagnostics,
  isEmptyAssistantMessage,
  ProviderResponse,
} from './provider-response-validation';

describe('Provider Response Validation', () => {
  describe('validateProviderResponse()', () => {
    it('should validate a well-formed response', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: 'Valid response content',
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

    it('should reject response without message object', () => {
      const response = {
        usage: { output_tokens: 50 },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('message object');
    });

    it('should reject empty assistant turn (kaseki-170 bug)', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: null,
        },
        usage: {
          input_tokens: 9019,
          output_tokens: 146,
          total_tokens: 9165,
        },
        response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Output tokens');
      expect(result.errors[0]).toContain('no assistant');
      expect(result.errors[0]).toContain('resp_4e859d2bfb3a457cb34d1e485d0b2958');
    });

    it('should reject empty string content with output tokens', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: '   ',
        },
        usage: {
          output_tokens: 42,
        },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(false);
    });

    it('should accept response with tool calls but no text', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: { name: 'analyze', arguments: '{}' },
            },
          ],
        },
        usage: {
          output_tokens: 50,
        },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(true);
    });

    it('should not require content if output_tokens is 0', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: null,
        },
        usage: {
          output_tokens: 0,
        },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(true);
    });

    it('should warn about zero output tokens', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: 'Some content',
        },
        usage: {
          output_tokens: 0,
        },
      };

      const result = validateProviderResponse(response);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('zero output tokens');
    });

    it('should handle non-object input gracefully', () => {
      const result = validateProviderResponse(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not an object');
    });

    it('should handle string content correctly', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: 'Valid content here',
        },
        usage: {
          output_tokens: 100,
        },
      };

      const result = validateProviderResponse(response);
      expect(result.valid).toBe(true);
    });
  });

  describe('extractEmptyAssistantDiagnostics()', () => {
    it('should extract diagnostic info from empty response', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: null,
          provider: 'gateway',
          api: 'openai-responses',
          model: 'auto',
          response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',
        },
        usage: {
          input_tokens: 9019,
          output_tokens: 146,
          total_tokens: 9165,
        },
        response_id: 'resp_4e859d2bfb3a457cb34d1e485d0b2958',
      };

      const diagnostics = extractEmptyAssistantDiagnostics(response);

      expect(diagnostics.provider).toBe('gateway');
      expect(diagnostics.api).toBe('openai-responses');
      expect(diagnostics.model).toBe('auto');
      expect(diagnostics.responseId).toBe('resp_4e859d2bfb3a457cb34d1e485d0b2958');
      expect(diagnostics.inputTokens).toBe(9019);
      expect(diagnostics.outputTokens).toBe(146);
      expect(diagnostics.totalTokens).toBe(9165);
      expect(diagnostics.description).toContain('Empty assistant turn');
      expect(diagnostics.description).toContain('146');
    });
  });

  describe('isEmptyAssistantMessage()', () => {
    it('should return true for null content with output tokens', () => {
      const message = { role: 'assistant', content: null };
      expect(isEmptyAssistantMessage(message, 50)).toBe(true);
    });

    it('should return false for non-null content', () => {
      const message = { role: 'assistant', content: 'Some content' };
      expect(isEmptyAssistantMessage(message, 50)).toBe(false);
    });

    it('should return false for content with tool calls', () => {
      const message = {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_123', type: 'function' }],
      };
      expect(isEmptyAssistantMessage(message, 50)).toBe(false);
    });

    it('should return false for non-assistant roles', () => {
      const message = { role: 'user', content: null };
      expect(isEmptyAssistantMessage(message, 50)).toBe(false);  // Only checks assistant messages
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle gateway auto-routing errors', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: null,
          provider: 'gateway',
          api: 'openai-responses',
          model: 'auto',
        },
        usage: {
          output_tokens: 146,
        },
      };

      const validation = validateProviderResponse(response);
      const diagnostics = extractEmptyAssistantDiagnostics(response);

      expect(validation.valid).toBe(false);
      expect(diagnostics.provider).toBe('gateway');
      expect(diagnostics.model).toBe('auto');
    });

    it('should provide detailed error for debugging', () => {
      const response: ProviderResponse = {
        message: {
          role: 'assistant',
          content: null,
          provider: 'gateway',
          api: 'openai-responses',
          model: 'auto',
          response_id: 'resp_xyz',
        },
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          total_tokens: 1200,
        },
        response_id: 'resp_xyz',
      };

      const result = validateProviderResponse(response);
      const error = result.errors[0];

      expect(error).toContain('200');  // output tokens
      expect(error).toContain('resp_xyz');  // response ID for tracing
    });
  });
});
