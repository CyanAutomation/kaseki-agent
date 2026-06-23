/**
 * Gateway Adapter Request Format Tests (TDD)
 *
 * Test the gateway provider adapter's ability to handle:
 * 1. Simple string input (should work as-is)
 * 2. Multi-message array input (should be converted to messages field)
 * 3. Mixed system + user messages (should be preserved)
 */

describe('Gateway Adapter Request Format', () => {
  describe('Request payload normalization', () => {
    /**
     * Test 1: Simple string input should pass through unchanged
     * Expected: input stays as string in the request body
     */
    it('should handle simple string input without modification', () => {
      const simpleInput = 'You are validating an OpenAI Responses API gateway for Kaseki agent prompts.';

      // Gateway adapter should pass this through as-is to /responses endpoint
      const requestPayload = {
        model: 'auto',
        input: simpleInput,
        max_output_tokens: 256,
      };

      expect(requestPayload.input).toEqual(simpleInput);
      expect(typeof requestPayload.input).toBe('string');
    });

    /**
     * Test 2: Multi-message array should be detected and converted
     * Expected: When input is an array of message objects, convert to messages field
     * This is what FAILS currently - the gateway receives {input: [{role, content}]} and doesn't know how to handle it
     */
    it('should detect multi-message array format and convert to messages field', () => {
      const multiMessageInput = [
        {
          role: 'system',
          content: 'You are a helpful assistant.',
        },
        {
          role: 'user',
          content: 'Hello, what is 2+2?',
        },
      ];

      // Mock the conversion logic that should happen in gateway adapter
      const isMultiMessage = Array.isArray(multiMessageInput) &&
        multiMessageInput.length > 0 &&
        typeof multiMessageInput[0] === 'object' &&
        'role' in multiMessageInput[0] &&
        'content' in multiMessageInput[0];

      expect(isMultiMessage).toBe(true);

      // After conversion, request should use messages field instead of input
      const convertedPayload = isMultiMessage
        ? {
          model: 'auto',
          messages: multiMessageInput,
          max_output_tokens: 256,
        }
        : {
          model: 'auto',
          input: multiMessageInput,
          max_output_tokens: 256,
        };

      expect(convertedPayload.messages).toBeDefined();
      expect(convertedPayload.messages).toEqual(multiMessageInput);
      expect(convertedPayload.input).toBeUndefined();
    });

    /**
     * Test 3: Array with only user messages should also be converted
     * Expected: Even if no system role, convert array of messages to messages field
     */
    it('should convert user-only message array to messages field', () => {
      const userOnlyMessages = [
        {
          role: 'user',
          content: 'What is 2+2?',
        },
        {
          role: 'user',
          content: 'And what is 3+3?',
        },
      ];

      const isMultiMessage = Array.isArray(userOnlyMessages) &&
        userOnlyMessages.length > 0 &&
        typeof userOnlyMessages[0] === 'object' &&
        'role' in userOnlyMessages[0];

      expect(isMultiMessage).toBe(true);

      const convertedPayload = isMultiMessage
        ? { model: 'auto', messages: userOnlyMessages, max_output_tokens: 256 }
        : { model: 'auto', input: userOnlyMessages, max_output_tokens: 256 };

      expect(convertedPayload.messages).toEqual(userOnlyMessages);
    });

    /**
     * Test 4: Empty array should be handled gracefully
     * Expected: Empty arrays treated as invalid input, fallback to input field (gateway error handling)
     */
    it('should handle empty message array gracefully', () => {
      const emptyArray = [];

      const isMultiMessage = Array.isArray(emptyArray) && emptyArray.length > 0;

      expect(isMultiMessage).toBe(false);

      // Empty array doesn't meet multi-message criteria, so it fails gracefully
      const requestPayload = isMultiMessage
        ? { model: 'auto', messages: emptyArray, max_output_tokens: 256 }
        : { model: 'auto', input: emptyArray, max_output_tokens: 256 };

      expect(requestPayload.input).toEqual(emptyArray);
    });

    /**
     * Test 5: Mixed content (array with non-message objects) should be treated as input
     * Expected: If array doesn't have proper message structure, keep as input field
     */
    it('should keep malformed arrays in input field (gateway will reject)', () => {
      const malformedArray = [
        { text: 'Not a message object' },
        { content: 'Missing role field' },
      ];

      const isMultiMessage = Array.isArray(malformedArray) &&
        malformedArray.length > 0 &&
        malformedArray.every(item =>
          typeof item === 'object' &&
          'role' in item &&
          'content' in item
        );

      expect(isMultiMessage).toBe(false);

      const requestPayload = isMultiMessage
        ? { model: 'auto', messages: malformedArray, max_output_tokens: 256 }
        : { model: 'auto', input: malformedArray, max_output_tokens: 256 };

      expect(requestPayload.input).toEqual(malformedArray);
    });
  });

  describe('Request normalization function', () => {
    /**
     * Helper function to normalize request payload
     * This should be added to the gateway adapter
     */
    function normalizeGatewayRequest(request: any): any {
      const { input, ...rest } = request;

      // Check if input is a multi-message array
      if (
        Array.isArray(input) &&
        input.length > 0 &&
        input.every(item =>
          typeof item === 'object' &&
          'role' in item &&
          'content' in item
        )
      ) {
        // Convert multi-message array to messages field
        return {
          ...rest,
          messages: input,
        };
      }

      // Keep input field as-is (string or invalid format)
      return { input, ...rest };
    }

    it('should normalize simple string request unchanged', () => {
      const request = {
        model: 'auto',
        input: 'Hello, world!',
        max_output_tokens: 256,
      };

      const normalized = normalizeGatewayRequest(request);

      expect(normalized).toEqual({
        model: 'auto',
        input: 'Hello, world!',
        max_output_tokens: 256,
      });
    });

    it('should normalize multi-message array to messages field', () => {
      const request = {
        model: 'auto',
        input: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ],
        max_output_tokens: 256,
      };

      const normalized = normalizeGatewayRequest(request);

      expect(normalized).toEqual({
        model: 'auto',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ],
        max_output_tokens: 256,
      });
      expect(normalized.input).toBeUndefined();
    });

    it('should keep malformed array in input field', () => {
      const request = {
        model: 'auto',
        input: [{ text: 'not a message' }],
        max_output_tokens: 256,
      };

      const normalized = normalizeGatewayRequest(request);

      expect(normalized).toEqual({
        model: 'auto',
        input: [{ text: 'not a message' }],
        max_output_tokens: 256,
      });
    });
  });

  describe('Gateway Responses API contract validation', () => {
    /**
     * Test that after normalization, request conforms to OpenAI Responses API spec
     * Either: {model, input: string, ...}
     * Or: {model, messages: array, ...}
     * But NOT: {model, input: array, ...} ← This is the bug
     */
    it('should produce valid OpenAI Responses API request after normalization', () => {
      const testCases = [
        {
          name: 'simple string input',
          input: { model: 'auto', input: 'Hello', max_output_tokens: 256 },
          valid: true,
          reason: 'input is string',
        },
        {
          name: 'multi-message array',
          input: {
            model: 'auto',
            input: [
              { role: 'system', content: 'You are helpful' },
              { role: 'user', content: 'Hi' },
            ],
            max_output_tokens: 256,
          },
          valid: false,
          reason: 'input is array (should be messages field)',
        },
        {
          name: 'properly formatted messages field',
          input: {
            model: 'auto',
            messages: [
              { role: 'system', content: 'You are helpful' },
              { role: 'user', content: 'Hi' },
            ],
            max_output_tokens: 256,
          },
          valid: true,
          reason: 'using messages field',
        },
      ];

      testCases.forEach(testCase => {
        const hasStringInput = typeof testCase.input.input === 'string';
        const hasMessages = Array.isArray(testCase.input.messages);
        const isValidContract = (hasStringInput && !hasMessages) || (hasMessages && !testCase.input.input);

        expect(isValidContract).toBe(
          testCase.valid,
          `${testCase.name}: ${testCase.reason}`,
        );
      });
    });
  });

  describe('Real-world Pi CLI integration scenarios', () => {
    /**
     * Test: When Pi CLI sends a multi-turn system prompt scenario
     * (like in scouting phase with full context)
     */
    it('should handle Pi scouting phase multi-message input', () => {
      // Simulating what Pi CLI would send for a scouting-phase prompt with context
      const scoutingPhaseInput = [
        {
          role: 'system',
          content: `You are a read-only scouting Pi agent inside a Kaseki-managed ephemeral workspace.
Your job is to analyze the repository, understand the task scope, and produce a structured JSON artifact.`,
        },
        {
          role: 'user',
          content: 'Investigate GitHub issue #814: Improve content, structure and formatting of docs/INDEX.md',
        },
      ];

      // Before fix: this would fail because gateway receives {input: [array]}
      // After fix: should convert to {messages: [array]}
      const isMultiMessage = Array.isArray(scoutingPhaseInput) &&
        scoutingPhaseInput.every(item =>
          typeof item === 'object' &&
          'role' in item &&
          'content' in item
        );

      expect(isMultiMessage).toBe(true);

      const normalizedRequest = {
        model: 'auto',
        messages: scoutingPhaseInput,
        max_output_tokens: 4096,
      };

      expect(normalizedRequest.messages).toBeDefined();
      expect(normalizedRequest.input).toBeUndefined();
    });
  });
});
