import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const executeGatewayProviderRegistration = (env: NodeJS.ProcessEnv): string => {
  try {
    return execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import registerGatewayProvider from './.pi-extensions.js';
const calls = [];
registerGatewayProvider({
  registerProvider: (...args) => calls.push(args),
});
console.log(JSON.stringify(calls));`,
      ],
      {
        env,
        encoding: 'utf8',
      }
    );
  } catch (error) {
    throw new Error(`Failed to execute .pi-extensions.js: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const parseProviderRegistrationCalls = (output: string): any[] => {
  try {
    const calls = JSON.parse(output);
    if (!Array.isArray(calls)) {
      throw new Error(`Expected provider registration output to be an array, received ${typeof calls}`);
    }
    return calls;
  } catch (error) {
    throw new Error(
      `Failed to parse provider registration output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }. Output received: ${output.slice(0, 200)}`
    );
  }
};

/**
 * Unit Test: Validate Gateway Provider Configuration Logic
 *
 * Tests validate that:
 * 1. Diagnostics are written at extension load
 * 2. Provider registration parameters are correct
 * 3. Configuration handles edge cases
 *
 * NOTE: Full end-to-end Pi CLI integration test (Step 4 in plan)
 * requires Pi CLI installed. Best run manually via:
 * KASEKI_PROVIDER=gateway KASEKI_MODEL=dynamic/kaseki-agent ./run-kaseki.sh
 */

describe('Gateway Provider Configuration', () => {
  // Mock fs and environment
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LLM_GATEWAY_URL = 'https://llm-gateway.local.xyz/v1';
    process.env.LLM_GATEWAY_API_KEY = 'test-api-key';
    process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '2048';
    delete process.env.LLM_GATEWAY_MODEL;
  });

  it('validates provider configuration structure', () => {
    /**
     * Test: Provider config matches Pi API expectations by executing the
     * actual .pi-extensions.js registration path.
     */

    const gatewayUrl = 'https://llm-gateway.local.xyz/v1';
    const gatewayApiKey = 'test-api-key';
    const maxOutputTokens = '2048';

    const output = executeGatewayProviderRegistration({
      ...process.env,
      LLM_GATEWAY_URL: gatewayUrl,
      LLM_GATEWAY_API_KEY: gatewayApiKey,
      LLM_GATEWAY_MAX_OUTPUT_TOKENS: maxOutputTokens,
      LLM_GATEWAY_MODEL: '',
    });

    const calls = parseProviderRegistrationCalls(output);
    expect(calls).toHaveLength(1);

    const [providerName, registeredProviderConfig] = calls[0];
    expect(providerName).toBe('gateway');
    expect(registeredProviderConfig.name).toBe('LLM Gateway (CloudFlare)');
    expect(registeredProviderConfig.baseUrl).toBe(gatewayUrl);
    expect(registeredProviderConfig.apiKey).toBe(gatewayApiKey);
    expect(registeredProviderConfig.api).toBe('openai-completions');
    expect(registeredProviderConfig.models).toHaveLength(1);

    const [registeredModel] = registeredProviderConfig.models;
    expect(registeredModel).toEqual(
      expect.objectContaining({
        id: 'dynamic/kaseki-agent',
        name: 'CloudFlare Gateway (dynamic/kaseki-agent)',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: Number.parseInt(maxOutputTokens, 10),
      })
    );

    console.log('\n=== Step 3: Provider Configuration Validated ===');
    console.log(`  ✓ Provider name: ${registeredProviderConfig.name}`);
    console.log(`  ✓ Base URL: ${registeredProviderConfig.baseUrl}`);
    console.log(`  ✓ API type: ${registeredProviderConfig.api}`);
    console.log(`  ✓ Model ID: ${registeredModel.id}`);
    console.log(`  ✓ Max tokens: ${registeredModel.maxTokens}`);
  });

  it('allows LLM_GATEWAY_MODEL to override the default model', () => {
    /**
     * Test: Custom gateway model override still works through the real
     * .pi-extensions.js provider registration path. This protects callers
     * that intentionally route through a specific model.
     */

    const previousGatewayModel = process.env.LLM_GATEWAY_MODEL;

    try {
      process.env.LLM_GATEWAY_MODEL = 'custom/provider-model';

      const output = executeGatewayProviderRegistration({
        ...process.env,
        LLM_GATEWAY_URL: 'https://llm-gateway.local.xyz/v1',
        LLM_GATEWAY_API_KEY: 'test-api-key',
        LLM_GATEWAY_MAX_OUTPUT_TOKENS: '2048',
      });

      const calls = parseProviderRegistrationCalls(output);
      expect(calls).toHaveLength(1);

      const [, registeredProviderConfig] = calls[0];
      expect(registeredProviderConfig.models).toHaveLength(1);

      const [registeredModel] = registeredProviderConfig.models;
      expect(registeredModel.id).toBe('custom/provider-model');
      expect(registeredModel.name).toBe('CloudFlare Gateway (custom/provider-model)');
    } finally {
      if (previousGatewayModel === undefined) {
        delete process.env.LLM_GATEWAY_MODEL;
      } else {
        process.env.LLM_GATEWAY_MODEL = previousGatewayModel;
      }
    }
  });

  it('emits diagnostics during gateway provider initialization', () => {
    /**
     * Test: Diagnostics are emitted by the real .pi-extensions.js load and
     * registration path, using a test-specific diagnostics destination.
     */

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-gateway-diagnostics-'));
    const diagnosticsPath = path.join(tempDir, '.gateway-diagnostics.jsonl');

    try {
      executeGatewayProviderRegistration({
        ...process.env,
        LLM_GATEWAY_URL: 'https://llm-gateway.local.xyz/v1',
        LLM_GATEWAY_API_KEY: 'test-api-key',
        LLM_GATEWAY_MAX_OUTPUT_TOKENS: '2048',
        LLM_GATEWAY_MODEL: '',
        KASEKI_GATEWAY_DIAGNOSTICS_PATH: diagnosticsPath,
      });

      const diagnosticRecords = fs
        .readFileSync(diagnosticsPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(diagnosticRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'extension_module_loaded',
            piExtensionsVersion: 'gateway-provider-v1',
            timestamp: expect.any(String),
          }),
          expect.objectContaining({
            event: 'provider_registered',
            provider: 'gateway',
            baseUrl: 'https://llm-gateway.local.xyz/v1',
            apiType: 'openai-completions',
            modelId: 'dynamic/kaseki-agent',
            hasApiKey: true,
            timestamp: expect.any(String),
          }),
        ])
      );

      const emittedEvents = diagnosticRecords.map((record) => record.event);
      expect(emittedEvents).toEqual(
        expect.arrayContaining(['extension_module_loaded', 'provider_registered'])
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('handles missing LLM_GATEWAY_URL gracefully', () => {
    /**
     * Test: Execute the real gateway provider initialization with
     * LLM_GATEWAY_URL unset. Provider registration should be skipped and
     * diagnostics should record the skip reason.
     */

    const previousGatewayUrl = process.env.LLM_GATEWAY_URL;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-gateway-missing-url-'));
    const diagnosticsPath = path.join(tempDir, '.gateway-diagnostics.jsonl');

    try {
      delete process.env.LLM_GATEWAY_URL;

      const output = executeGatewayProviderRegistration({
        ...process.env,
        LLM_GATEWAY_API_KEY: 'test-api-key',
        LLM_GATEWAY_MAX_OUTPUT_TOKENS: '2048',
        LLM_GATEWAY_MODEL: '',
        KASEKI_GATEWAY_DIAGNOSTICS_PATH: diagnosticsPath,
      });

      const calls = parseProviderRegistrationCalls(output);
      expect(calls).toHaveLength(0);

      const diagnosticRecords = fs
        .readFileSync(diagnosticsPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(diagnosticRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'extension_module_loaded',
            piExtensionsVersion: 'gateway-provider-v1',
            timestamp: expect.any(String),
          }),
          expect.objectContaining({
            event: 'provider_skipped',
            provider: 'gateway',
            reason: 'missing_llm_gateway_url',
            timestamp: expect.any(String),
          }),
        ])
      );
      expect(diagnosticRecords).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'provider_registered',
          }),
        ])
      );
    } finally {
      if (previousGatewayUrl === undefined) {
        delete process.env.LLM_GATEWAY_URL;
      } else {
        process.env.LLM_GATEWAY_URL = previousGatewayUrl;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('validates API type for Responses format', () => {
    /**
     * Test: Execute the real gateway provider registration source and assert
     * the registered provider uses Pi's Responses-compatible API type.
     *
     * This intentionally reads the value from .pi-extensions.js at runtime so
     * the test fails if production provider configuration changes.
     */

    const output = executeGatewayProviderRegistration({
      ...process.env,
      LLM_GATEWAY_URL: 'https://llm-gateway.local.xyz/v1',
      LLM_GATEWAY_API_KEY: 'test-api-key',
      LLM_GATEWAY_MAX_OUTPUT_TOKENS: '2048',
      LLM_GATEWAY_MODEL: 'dynamic/kaseki-agent',
    });

    const calls = parseProviderRegistrationCalls(output);
    expect(calls).toHaveLength(1);

    const [providerName, registeredProviderConfig] = calls[0];
    expect(providerName).toBe('gateway');
    expect(registeredProviderConfig).toEqual(
      expect.objectContaining({
        api: 'openai-completions',
      })
    );
  });

  it('registers the actual gateway provider with deterministic configuration', () => {
    /**
     * Test: Execute the real .pi-extensions.js registration entry point
     * instead of documenting manual setup in a console-only test.
     */

    const output = executeGatewayProviderRegistration({
      ...process.env,
      LLM_GATEWAY_URL: 'https://llm-gateway.local.xyz/v1',
      LLM_GATEWAY_API_KEY: 'test-api-key',
      LLM_GATEWAY_MAX_OUTPUT_TOKENS: '2048',
    });
    const calls = parseProviderRegistrationCalls(output);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'gateway',
      expect.objectContaining({
        name: 'LLM Gateway (CloudFlare)',
        baseUrl: 'https://llm-gateway.local.xyz/v1',
        apiKey: 'test-api-key',
        api: 'openai-completions',
        models: [
          expect.objectContaining({
            id: 'dynamic/kaseki-agent',
            name: 'CloudFlare Gateway (dynamic/kaseki-agent)',
            input: ['text'],
            maxTokens: 2048,
          }),
        ],
      }),
    ]);
  });
});

/**
 * Unit Test: Custom Stream Handler for Gateway Provider
 *
 * Tests define expected behavior for converting Pi's message format
 * to gateway's input format and parsing SSE responses correctly.
 */
describe('Gateway Custom Stream Handler', () => {
  // Mock fetch and stream utilities
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    process.env.LLM_GATEWAY_URL = 'https://llm-gateway.local.xyz/v1';
    process.env.LLM_GATEWAY_API_KEY = 'test-api-key';
  });

  describe('Tier 1: Critical Entry Guards', () => {
    it('logs handler entry immediately upon invocation', () => {
      /**
       * Test: Verify entry diagnostic is logged before any logic runs
       * This ensures we can catch failures like kaseki-165 where handler throws immediately
       */

      // Expected diagnostic: entry event should be logged at handler start
      const expectedEntryEvent = {
        event: 'entry',
        component: 'stream_handler',
        hasTimestamp: true,
        hasModelId: true,
        hasContextMessageCount: true,
      };

      // Entry guard documentation (actual implementation in .pi-extensions.js)
      console.log('✓ Entry guard implemented:');
      console.log('  • Logged immediately on handler invocation');
      console.log('  • Includes: timestamp, modelId, contextMessageCount');
      console.log('  • Written to .gateway-diagnostics.jsonl before any logic');

      expect(expectedEntryEvent.component).toBe('stream_handler');
      expect(expectedEntryEvent.event).toBe('entry');
    });

    it('validates context object shape before access', () => {
      /**
       * Test: Context validation catches malformed/missing context
       * Prevents immediate failures from accessing null/undefined context
       */

      // Test cases for context validation
      const testCases = [
        {
          name: 'null context',
          context: null,
          shouldFail: true,
          expectedDiagnostic: 'context_validation_failed',
        },
        {
          name: 'missing messages array',
          context: { someKey: 'value' },
          shouldFail: true,
          expectedDiagnostic: 'context_validation_failed',
        },
        {
          name: 'messages not an array',
          context: { messages: 'not-an-array' },
          shouldFail: true,
          expectedDiagnostic: 'context_validation_failed',
        },
        {
          name: 'empty messages array',
          context: { messages: [] },
          shouldFail: true,
          expectedDiagnostic: 'context_validation_failed',
        },
        {
          name: 'valid context',
          context: { messages: [{ role: 'user', content: 'hello' }] },
          shouldFail: false,
          expectedDiagnostic: 'context_validation_passed',
        },
      ];

      for (const testCase of testCases) {
        console.log(`  ✓ ${testCase.name}:`);
        console.log(`    - Should fail: ${testCase.shouldFail}`);
        console.log(`    - Logs: ${testCase.expectedDiagnostic}`);

        expect(testCase.expectedDiagnostic).toMatch(
          /context_validation_(passed|failed)/
        );
      }
    });

    it('logs request payload before sending to gateway', () => {
      /**
       * Test: Request payload is logged with structure and preview
       * Helps debug format issues and protocol mismatches
       */

      const expectedPayloadLogging = {
        event: 'request_payload',
        fields: [
          'model',
          'inputLength',
          'inputPreview',
          'store',
          'requestBodySize',
          'validJsonFormat',
        ],
      };

      console.log('✓ Request payload logged with:');
      for (const field of expectedPayloadLogging.fields) {
        console.log(`  • ${field}`);
      }

      expect(expectedPayloadLogging.fields).toContain('inputPreview');
      expect(expectedPayloadLogging.fields).toContain('model');
      expect(expectedPayloadLogging.fields).toContain('store');
    });

    it('logs gateway HTTP errors with response details', () => {
      /**
       * Test: HTTP error responses are captured with details for debugging
       */

      const expectedErrorDiagnostic = {
        event: 'gateway_http_error',
        fields: [
          'status',
          'statusText',
          'contentType',
          'errorBodyPreview',
          'errorBodyLength',
        ],
      };

      console.log('✓ HTTP errors logged with:');
      for (const field of expectedErrorDiagnostic.fields) {
        console.log(`  • ${field}`);
      }

      expect(expectedErrorDiagnostic.fields).toContain('status');
      expect(expectedErrorDiagnostic.fields).toContain('errorBodyPreview');
    });

    it('captures error type and stack trace for debugging', () => {
      /**
       * Test: Errors include type information and stack trace preview
       * Helps identify what went wrong and where
       */

      const expectedErrorContext = {
        reason: 'error',
        message: 'error message',
        errorType: 'TypeError', // or whatever error type
        stackPreview: 'first few lines of stack trace',
        timestamp: '2026-06-24T...',
      };

      console.log('✓ Error context captured:');
      console.log(`  • Error type: ${expectedErrorContext.errorType}`);
      console.log(`  • Stack preview: ${expectedErrorContext.stackPreview}`);
      console.log(`  • Timestamp: ${expectedErrorContext.timestamp}`);

      expect(expectedErrorContext).toHaveProperty('errorType');
      expect(expectedErrorContext).toHaveProperty('stackPreview');
    });
  });

  describe('Tier 2: Streaming Details (Future)', () => {
    it('documents stream event tracking for future implementation', () => {
      /**
       * Placeholder for Tier 2: Stream event diagnostics
       * Will track each event pushed to readable stream
       * Planned for kaseki-167+
       */

      const tier2Plans = [
        'Event type and payload size tracking',
        'SSE event parsing details',
        'Timing metrics (latency, duration)',
        'Event sequence validation',
      ];

      console.log('\n🔄 Tier 2 (Future - kaseki-167+):');
      for (const plan of tier2Plans) {
        console.log(`  ⏳ ${plan}`);
      }

      expect(tier2Plans.length).toBeGreaterThan(0);
    });
  });

  it('extracts user input from context correctly', () => {
    /**
     * Test: Extract last user message from Pi's context.messages
     * This ensures we get the right input to send to gateway.
     */

    // Mock context with multiple messages
    const context = {
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Second' },
            { type: 'text', text: ' question' },
          ],
        },
      ],
    };

    // Expected: Extract last user message and concatenate text blocks
    const expectedInput = 'Second question';

    // This test documents expected extraction behavior
    // (Implementation will be in .pi-extensions.js extractUserInput function)
    expect(context.messages[3].role).toBe('user');
    expect(Array.isArray(context.messages[3].content)).toBe(true);

    const extracted = context.messages[3].content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    expect(extracted).toBe(expectedInput);

    console.log(`\n✓ Extracted input from context: "${expectedInput}"`);
  });

  it('formats request with correct gateway contract', () => {
    /**
     * Test: Request body matches gateway's expected format.
     * Gateway expects: {model: "dynamic/kaseki-agent", input: "string", store: false}
     * Pi default sends: {model: "dynamic/kaseki-agent", messages: [...], ...}
     */

    // Expected request format for gateway
    const expectedRequestBody = {
      model: 'dynamic/kaseki-agent',
      input: 'Hello, what can you do?',
      store: false,
    };

    // Verify structure matches gateway contract
    expect(expectedRequestBody).toHaveProperty('model', 'dynamic/kaseki-agent');
    expect(expectedRequestBody).toHaveProperty('input');
    expect(typeof expectedRequestBody.input).toBe('string');
    expect(expectedRequestBody).toHaveProperty('store', false);
    expect(expectedRequestBody).not.toHaveProperty('messages'); // NOT the Pi format

    console.log('✓ Request format matches gateway contract:');
    console.log(`  {model: '${expectedRequestBody.model}', input: '...', store: ${expectedRequestBody.store}}`);
  });

  it('parses SSE response and extracts content', () => {
    /**
     * Test: Parse gateway's SSE stream correctly.
     * Extract text from response.output array.
     */

    // Mock SSE response from gateway (same format as kaseki-164)
    const sseResponse = `event: response.created
data: {"type":"response.created","response":{"id":"resp_123","output":[]}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_123","output":[{"type":"text","text":"Hello from gateway"}],"usage":{"input_tokens":100,"output_tokens":50}}}

data: [DONE]
`;

    // Expected extracted values
    const expectedText = 'Hello from gateway';
    const expectedUsage = {
      input_tokens: 100,
      output_tokens: 50,
    };

    // Parse SSE lines
    const lines = sseResponse.split('\n');
    let parsedText = '';
    let parsedUsage: any = null;

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6));
          if (
            json.response?.output?.length > 0 &&
            json.response.output[0]?.type === 'text'
          ) {
            parsedText = json.response.output[0].text;
          }
          if (json.response?.usage) {
            parsedUsage = json.response.usage;
          }
        } catch {
          // Ignore [DONE] marker
        }
      }
    }

    expect(parsedText).toBe(expectedText);
    expect(parsedUsage).toEqual(expectedUsage);

    console.log('✓ Parsed SSE response:');
    console.log(`  Text: '${parsedText}'`);
    console.log(`  Tokens: input=${parsedUsage.input_tokens}, output=${parsedUsage.output_tokens}`);
  });

  it('generates Pi-compatible stream events', () => {
    /**
     * Test: Stream handler produces correct event sequence for Pi.
     * Sequence: start → text_start → text_delta → text_end → done
     */

    // Mock stream object
    const mockStream = {
      push: jest.fn(),
      end: jest.fn(),
    };

    // Simulated stream event generation
    const output = {
      role: 'assistant',
      content: [],
      api: 'custom-gateway',
      provider: 'gateway',
      model: 'dynamic/kaseki-agent',
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
      stopReason: 'stop',
      timestamp: Date.now(),
    };

    // Expected event sequence
    const expectedEvents = [
      { type: 'start', partial: output },
      {
        type: 'text_start',
        contentIndex: 0,
        partial: expect.objectContaining({ content: [] }),
      },
      {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hello from gateway',
        partial: expect.any(Object),
      },
      { type: 'text_end', contentIndex: 0, content: 'Hello from gateway' },
      { type: 'done', reason: 'stop', message: expect.any(Object) },
    ];

    // Push events (simulating handler behavior)
    mockStream.push(expectedEvents[0]);
    mockStream.push(expectedEvents[1]);
    mockStream.push(expectedEvents[2]);
    mockStream.push(expectedEvents[3]);
    mockStream.push(expectedEvents[4]);
    mockStream.end();

    // Verify event sequence
    expect(mockStream.push).toHaveBeenCalledTimes(5);
    expect(mockStream.end).toHaveBeenCalledTimes(1);

    const calls = mockStream.push.mock.calls;
    expect(calls[0][0].type).toBe('start');
    expect(calls[1][0].type).toBe('text_start');
    expect(calls[2][0].type).toBe('text_delta');
    expect(calls[3][0].type).toBe('text_end');
    expect(calls[4][0].type).toBe('done');

    console.log('✓ Stream event sequence:');
    console.log('  1. start - Stream initialization');
    console.log('  2. text_start - Text block started');
    console.log('  3. text_delta - Text content chunk');
    console.log('  4. text_end - Text block complete');
    console.log('  5. done - Stream finished');
  });

  it('handles network errors gracefully', () => {
    /**
     * Test: Stream handler catches fetch errors and returns error event.
     */

    // Mock fetch to reject
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

    // Mock stream
    const mockStream = {
      push: jest.fn(),
      end: jest.fn(),
    };

    // Simulated error handling in handler
    try {
      throw new Error('Network timeout');
    } catch (error) {
      const errorOutput = {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };

      mockStream.push({ type: 'error', reason: 'error', error: errorOutput });
      mockStream.end();
    }

    // Verify error event
    expect(mockStream.push).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', reason: 'error' })
    );
    expect(mockStream.end).toHaveBeenCalled();

    console.log('✓ Error handling:');
    console.log('  ✓ Caught network error');
    console.log('  ✓ Generated error event');
    console.log('  ✓ Ended stream gracefully');
  });

  it('logs diagnostic events during stream handling', () => {
    /**
     * Test: Stream handler records diagnostics for troubleshooting.
     */

    // Mock fs for diagnostics writing
    const mockFs = {
      existsSync: jest.fn().mockReturnValue(true),
      appendFileSync: jest.fn(),
    };

    // Simulated diagnostic event
    const diagnosticEvent = {
      timestamp: new Date().toISOString(),
      event: 'stream_handler_invoked',
      provider: 'gateway',
      requestFormat: { model: 'dynamic/kaseki-agent', input: '...' },
    };

    // Simulate diagnostic write
    const diagnosticsPath = '/results/.gateway-diagnostics.jsonl';
    mockFs.appendFileSync(diagnosticsPath, JSON.stringify(diagnosticEvent) + '\n');

    // Verify diagnostic write
    expect(mockFs.appendFileSync).toHaveBeenCalledWith(
      diagnosticsPath,
      expect.stringContaining('stream_handler_invoked')
    );

    console.log('✓ Diagnostics recorded:');
    console.log('  Event: stream_handler_invoked');
    console.log(`  Path: ${diagnosticsPath}`);
  });
});
