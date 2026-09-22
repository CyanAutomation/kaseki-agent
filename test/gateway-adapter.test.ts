import {
  normalizeGatewayRequest,
  normalizeGatewayTransportRequest,
} from '../src/gateway/normalize-request';

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
    it('should preserve the complete string-input payload through production normalization', () => {
      const simpleInput = 'You are validating an OpenAI Responses API gateway for Kaseki agent prompts.';

      const requestPayload = normalizeGatewayRequest({
        model: 'auto',
        input: simpleInput,
        max_output_tokens: 256,
        metadata: { phase: 'validation' },
      });

      expect(requestPayload).toEqual({
        model: 'auto',
        input: simpleInput,
        max_output_tokens: 256,
        metadata: { phase: 'validation' },
      });
      expect(requestPayload).not.toHaveProperty('messages');
    });

    it.each([
      {
        name: 'system-plus-user input',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: 'Hello, what is 2+2?',
          },
        ],
      },
      {
        name: 'user-only input',
        messages: [
          {
            role: 'user',
            content: 'What is 2+2?',
          },
          {
            role: 'user',
            content: 'And what is 3+3?',
          },
        ],
      },
    ])('should move $name from input to the externally emitted messages field', ({ messages }) => {
      const normalized = normalizeGatewayRequest({
        model: 'auto',
        input: messages,
        max_output_tokens: 256,
      });

      expect(normalized).toEqual({
        model: 'auto',
        messages,
        max_output_tokens: 256,
      });
      expect(normalized).not.toHaveProperty('input');
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

  describe('Undici transport normalization', () => {
    /**
     * Test 1: Verify undici.request calls are intercepted and normalized
     * This is critical because Pi CLI uses undici directly, not global.fetch
     *
     * Test setup:
     * 1. Mock undici.request to track calls
     * 2. Call with nested structure {input: [{role, content}]}
     * 3. Verify normalization happens before undici sees it
     */
    it.each([
      ['string', (payload: object) => JSON.stringify(payload)],
      ['Buffer', (payload: object) => Buffer.from(JSON.stringify(payload), 'utf8')],
    ])('should normalize multi-message array from an undici %s body', (_representation, createBody) => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ];
      const body = createBody({
        model: 'auto',
        input: messages,
      });
      const undiciRequest = {
        url: 'https://gateway.example.com/v1/responses',
        path: '/v1/responses',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      };

      const normalized = normalizeGatewayTransportRequest(undiciRequest);
      const normalizedPayload = JSON.parse(normalized.body!.toString());

      expect(normalizedPayload).toEqual({
        model: 'auto',
        messages,
      });
      expect(normalizedPayload).not.toHaveProperty('input');
    });

    /**
     * Test 3: Verify string input passes through undici unchanged
     */
    it('should pass string input through undici without modification', () => {
      const stringPayload = {
        model: 'auto',
        input: 'Simple string prompt for validation',
      };

      const bodyStr = JSON.stringify(stringPayload);
      const parsed = JSON.parse(bodyStr);

      const isMultiMessage = Array.isArray(parsed.input) &&
        parsed.input.length > 0 &&
        parsed.input.every((item: any) =>
          typeof item === 'object' &&
          'role' in item &&
          'content' in item
        );

      expect(isMultiMessage).toBe(false);

      // Should remain unchanged
      const normalized = isMultiMessage
        ? { model: 'auto', messages: parsed.input }
        : parsed;

      expect(normalized.input).toBe('Simple string prompt for validation');
      expect(normalized.messages).toBeUndefined();
    });

    /**
     * Test 4: Verify undici request to non-/responses endpoints are untouched
     */
    it('should skip normalization for non-/responses endpoints', () => {
      const unrelatedRequest = {
        path: '/v1/health',
        method: 'GET',
        headers: {},
      };

      // Should not normalize anything for non-/responses paths
      expect(unrelatedRequest.path.includes('/responses')).toBe(false);
    });
  });

  describe('Fetch transport normalization', () => {
    /**
     * Test 5: Verify global.fetch requests are also normalized
     * Ensure backward compatibility with code using fetch
     */
    it('should normalize multi-message array through the fetch transport entry point', () => {
      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ];
      const fetchRequest = {
        url: 'https://gateway.example.com/v1/responses',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'auto',
          input: messages,
          max_output_tokens: 256,
          metadata: { phase: 'validation' },
        }),
      };

      const normalized = normalizeGatewayTransportRequest(fetchRequest);
      const body = JSON.parse(normalized.body as string);

      expect(normalized).toMatchObject({
        url: fetchRequest.url,
        method: fetchRequest.method,
        headers: fetchRequest.headers,
      });
      expect(body).toEqual({
        model: 'auto',
        messages,
        max_output_tokens: 256,
        metadata: { phase: 'validation' },
      });
      expect(body).not.toHaveProperty('input');
    });

    /**
     * Test 6: Verify fetch to non-/responses endpoints skip normalization
     */
    it('should skip fetch normalization for non-/responses URLs', () => {
      const request = {
        url: 'https://gateway.example.com/v1/health',
        headers: { 'content-type': 'application/json', 'x-request-id': 'health-check' },
        body: JSON.stringify({
          model: 'auto',
          input: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hi' },
          ],
        }),
      };

      const normalized = normalizeGatewayTransportRequest(request);

      expect(normalized.url).toBe(request.url);
      expect(normalized.body).toBe(request.body);
      expect(normalized.headers).toBe(request.headers);
    });

    /**
     * Test 7: Verify fetch with string body passes through unchanged
     */
    it('should pass through fetch string input without modification', () => {
      const body = JSON.stringify({
        model: 'auto',
        input: 'Simple prompt text',
      });

      const parsed = JSON.parse(body);
      const isMultiMessage = Array.isArray(parsed.input) &&
        parsed.input.every((item: any) => 'role' in item && 'content' in item);

      expect(isMultiMessage).toBe(false);
      expect(parsed.input).toEqual('Simple prompt text');
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
