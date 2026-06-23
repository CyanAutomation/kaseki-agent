/**
 * Tests for LLM Gateway responsiveness validation
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  formatGatewayTestResponse,
  shouldRunGatewayResponseSmoke,
  testGatewayConnectivity,
  detectGatewayTestEnvironment,
  testGatewayConnectivity_Stage1,
  testGatewayResponseSmoke_Stage2,
  GatewayTestResult,
} from './kaseki-api-gateway-test';

// Mock fetch before importing
global.fetch = jest.fn();

describe('LLM Gateway Test', () => {
  const originalEnv = process.env;
  const mockFetch = global.fetch as jest.Mock;
  let secretsDir: string;

  function mockSuccessfulStage2Responses(
    jsonResponse: Record<string, unknown> = {
      id: 'resp_json',
      output_text: 'kaseki gateway smoke ok',
      usage: { output_tokens: 5 },
    },
    streamResponse = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_stream","output":[]}}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"kaseki gateway smoke ok"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'),
    largeResponse: Record<string, unknown> = {
      id: 'resp_large',
      output_text: 'kaseki gateway smoke ok',
      usage: { output_tokens: 6 },
    },
  ) {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(jsonResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => streamResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(largeResponse),
      });
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-gateway-test-secrets-'));
    process.env.KASEKI_SECRETS_DIR = secretsDir;
    mockFetch.mockClear();
  });

  afterEach(() => {
    fs.rmSync(secretsDir, { recursive: true, force: true });
    process.env = originalEnv;
    mockFetch.mockClear();
  });

  describe('testGatewayConnectivity', () => {
    it('should default to response smoke in production-like runtime', async () => {
      delete process.env.JEST_WORKER_ID;
      delete process.env.NODE_ENV;
      delete process.env.KASEKI_ENV;
      delete process.env.KASEKI_GATEWAY_RESPONSE_SMOKE;
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '{"models": []}',
        });
      mockSuccessfulStage2Responses({
        id: 'resp_default_smoke',
        output_text: 'kaseki gateway smoke ok',
        usage: { output_tokens: 5 },
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('ok');
      expect(result.responseSmokeValidated).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should default to lightweight connectivity under Jest', async () => {
      process.env.JEST_WORKER_ID = '1';
      delete process.env.KASEKI_GATEWAY_RESPONSE_SMOKE;
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"models": []}',
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('ok');
      expect(result.responseSmokeValidated).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should resolve smoke defaults and explicit overrides', () => {
      delete process.env.JEST_WORKER_ID;
      delete process.env.NODE_ENV;
      delete process.env.KASEKI_ENV;
      delete process.env.KASEKI_GATEWAY_RESPONSE_SMOKE;
      expect(shouldRunGatewayResponseSmoke()).toBe(true);
      process.env.NODE_ENV = 'development';
      expect(shouldRunGatewayResponseSmoke()).toBe(false);
      process.env.KASEKI_GATEWAY_RESPONSE_SMOKE = '1';
      expect(shouldRunGatewayResponseSmoke()).toBe(true);
      process.env.KASEKI_GATEWAY_RESPONSE_SMOKE = 'off';
      expect(shouldRunGatewayResponseSmoke()).toBe(false);
      expect(shouldRunGatewayResponseSmoke({ responseSmoke: true })).toBe(true);
      expect(shouldRunGatewayResponseSmoke({ responseSmoke: false })).toBe(false);
    });

    it('should fail when LLM_GATEWAY_URL is not configured', async () => {
      delete process.env.LLM_GATEWAY_URL;
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('LLM_GATEWAY_URL');
      expect(result.remediation).toContain('LLM_GATEWAY_URL');
    });

    it('should fail when LLM_GATEWAY_API_KEY is not configured', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      delete process.env.LLM_GATEWAY_API_KEY;

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('LLM_GATEWAY_API_KEY');
      expect(result.remediation).toContain('LLM_GATEWAY_API_KEY');
    });

    it('should read LLM gateway API key from host secrets when inline env is not configured', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      delete process.env.LLM_GATEWAY_API_KEY;
      fs.writeFileSync(path.join(secretsDir, 'llm_gateway_api_key'), 'file-test-key\n');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"models": []}',
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('ok');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://llmgateway.local.xyz/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer file-test-key',
          }),
        }),
      );
      expect(JSON.stringify(result)).not.toContain('file-test-key');
    });

    it('should fail when gateway URL is invalid', async () => {
      process.env.LLM_GATEWAY_URL = 'not-a-valid-url';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('invalid');
    });

    it('should fail before probing when gateway URL does not have a version path', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('versioned OpenAI API endpoint');
      expect(result.remediation).toContain('Pi CLI will automatically append /responses');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should accept base URL format (e.g., /v1) and succeed when reachable', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"models": []}',
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('ok');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.authenticationValidated).toBe(true);
      // Verify it converts /v1 to /v1/models for the test probe
      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://llmgateway.local.xyz/v1/models');
      expect(callArgs[1].headers.Authorization).toBe('Bearer test-key');
    });

    it('should return error with 401 when authentication fails', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'invalid-key';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('401');
      expect(result.authenticationValidated).toBe(false);
      expect(result.remediation).toBeDefined();
      expect(result.remediation).toContain('LLM_GATEWAY_API_KEY');
      expect(result.remediation).toContain('llm_gateway_api_key');
    });

    it('should return error with 403 when forbidden', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('403');
      expect(result.authenticationValidated).toBe(false);
    });

    it('should handle network errors gracefully', async () => {
      process.env.LLM_GATEWAY_URL = 'https://unreachable-gateway-xyz.invalid/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('unreachable');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should include timestamp in response', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      });

      const result = await testGatewayConnectivity();

      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
      // Verify it's a valid ISO string
      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
    });

    it('should measure and return response time', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      });

      const result = await testGatewayConnectivity();

      expect(result.responseTime).toBeDefined();
      expect(typeof result.responseTime).toBe('number');
    });

    it('should include gateway URL in response', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      });

      const result = await testGatewayConnectivity();

      expect(result.gatewayUrl).toBe('https://llmgateway.local.xyz/v1/responses');
    });

    it('should not include API key in response', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'secret-test-key-12345';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      });

      const result = await testGatewayConnectivity();

      expect(JSON.stringify(result)).not.toContain('secret-test-key');
    });

    it('should validate Bearer token format', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      });

      const result = await testGatewayConnectivity();

      expect(result.authenticationValidated).toBeDefined();
      expect(typeof result.authenticationValidated).toBe('boolean');
    });

    it('should provide clear remediation for configuration errors', async () => {
      delete process.env.LLM_GATEWAY_URL;
      delete process.env.LLM_GATEWAY_API_KEY;

      const result = await testGatewayConnectivity();

      expect(result.remediation).toBeDefined();
      expect(result.remediation).toContain('environment');
    });

    it('should have a detail field describing the test result', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      });

      const result = await testGatewayConnectivity();

      expect(result.detail).toBeDefined();
      expect(typeof result.detail).toBe('string');
    });

    it('should accept full response path format (e.g., /v1/responses)', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"models": []}',
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('ok');
      expect(result.authenticationValidated).toBe(true);
    });

    it('should validate Responses API smoke output with model auto when enabled', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';
      process.env.KASEKI_GATEWAY_RESPONSE_SMOKE = '1';

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '{"models": []}',
        });
      mockSuccessfulStage2Responses({
        id: 'resp_smoke_ok',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'kaseki gateway smoke ok' }],
          },
        ],
        usage: { output_tokens: 5 },
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('ok');
      expect(result.responseSmokeValidated).toBe(true);
      expect(result.streamSmokeValidated).toBe(true);
      expect(result.largePromptSmokeValidated).toBe(true);
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://llmgateway.local.xyz/v1/responses',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"model":"auto"'),
        }),
      );
    });

    it('should skip Responses API smoke output when explicitly disabled', async () => {
      delete process.env.JEST_WORKER_ID;
      delete process.env.NODE_ENV;
      delete process.env.KASEKI_ENV;
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';
      process.env.KASEKI_GATEWAY_RESPONSE_SMOKE = '0';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"models": []}',
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('ok');
      expect(result.responseSmokeValidated).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should fail Responses API smoke output when gateway returns tokens but no assistant text', async () => {
      process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';
      process.env.KASEKI_GATEWAY_RESPONSE_SMOKE = 'true';

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '{"models": []}',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            id: 'resp_empty',
            output: [],
            usage: { output_tokens: 128 },
          }),
        });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('no assistant text');
      expect(result.detail).toContain('response_id=resp_empty');
      expect(result.detail).toContain('output_tokens=128');
      expect(result.responseSmokeValidated).toBe(false);
      expect(result.remediation).toContain('model=auto');
      expect(result.remediation).toContain('Responses API adapter');
      expect(result.remediation).toContain('output_text');
    });

    it('should accept different API versions (/v2, /v3, etc.)', async () => {
      process.env.LLM_GATEWAY_URL = 'https://gateway.example/v2';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      });

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('ok');
    });

    it('should reject URLs without version path', async () => {
      process.env.LLM_GATEWAY_URL = 'https://gateway.example/api';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('versioned');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject URLs with version path but wrong structure', async () => {
      process.env.LLM_GATEWAY_URL = 'https://gateway.example/v1/chat/completions';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('versioned');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('GatewayTestResult type', () => {
    it('should have all required fields', () => {
      const result: GatewayTestResult = {
        status: 'ok',
        detail: 'Gateway is responsive',
        gatewayUrl: 'https://example.com/v1/responses',
        responseTime: 125,
        timestamp: new Date().toISOString(),
        authenticationValidated: true,
      };

      expect(result.status).toBe('ok');
      expect(result.detail).toBeDefined();
      expect(result.gatewayUrl).toBeDefined();
      expect(result.responseTime).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.authenticationValidated).toBeDefined();
    });

    it('should support optional fields like remediation', () => {
      const result: GatewayTestResult = {
        status: 'error',
        detail: 'Configuration missing',
        gatewayUrl: undefined,
        responseTime: 0,
        timestamp: new Date().toISOString(),
        authenticationValidated: false,
        remediation: 'Set LLM_GATEWAY_URL environment variable',
      };

      expect(result.remediation).toBeDefined();
    });

    it('formats optional latency warnings', () => {
      const result: GatewayTestResult = {
        status: 'ok',
        detail: 'Gateway is responsive',
        gatewayUrl: 'https://example.com/v1/responses',
        responseTime: 9459,
        timestamp: new Date().toISOString(),
        authenticationValidated: true,
        warning: 'Gateway responded slowly (9459ms; warning threshold 5000ms).',
      };

      expect(formatGatewayTestResponse(result)).toMatchObject({
        status: 'ok',
        responseTime: 9459,
        warning: expect.stringContaining('responded slowly'),
      });
    });
  });

  describe('Two-Stage Gateway Test', () => {
    describe('detectGatewayTestEnvironment', () => {
      it('should return "test" when JEST_WORKER_ID is set', () => {
        process.env.JEST_WORKER_ID = '1';
        delete process.env.NODE_ENV;
        delete process.env.KASEKI_ENV;

        expect(detectGatewayTestEnvironment()).toBe('test');
      });

      it('should return "test" when NODE_ENV=test', () => {
        delete process.env.JEST_WORKER_ID;
        process.env.NODE_ENV = 'test';
        delete process.env.KASEKI_ENV;

        expect(detectGatewayTestEnvironment()).toBe('test');
      });

      it('should return "development" when NODE_ENV=development', () => {
        delete process.env.JEST_WORKER_ID;
        process.env.NODE_ENV = 'development';
        delete process.env.KASEKI_ENV;

        expect(detectGatewayTestEnvironment()).toBe('development');
      });

      it('should return "development" when KASEKI_ENV=development', () => {
        delete process.env.JEST_WORKER_ID;
        delete process.env.NODE_ENV;
        process.env.KASEKI_ENV = 'development';

        expect(detectGatewayTestEnvironment()).toBe('development');
      });

      it('should return "production" as default', () => {
        delete process.env.JEST_WORKER_ID;
        delete process.env.NODE_ENV;
        delete process.env.KASEKI_ENV;

        expect(detectGatewayTestEnvironment()).toBe('production');
      });
    });

    describe('shouldRunGatewayResponseSmoke with environment detection', () => {
      it('should return true in production by default', () => {
        delete process.env.JEST_WORKER_ID;
        delete process.env.NODE_ENV;
        delete process.env.KASEKI_ENV;
        delete process.env.KASEKI_GATEWAY_RESPONSE_SMOKE;

        expect(shouldRunGatewayResponseSmoke()).toBe(true);
      });

      it('should return false in test environment by default', () => {
        process.env.JEST_WORKER_ID = '1';
        delete process.env.KASEKI_GATEWAY_RESPONSE_SMOKE;

        expect(shouldRunGatewayResponseSmoke()).toBe(false);
      });

      it('should return false in development environment by default', () => {
        delete process.env.JEST_WORKER_ID;
        process.env.NODE_ENV = 'development';
        delete process.env.KASEKI_GATEWAY_RESPONSE_SMOKE;

        expect(shouldRunGatewayResponseSmoke()).toBe(false);
      });

      it('should respect forceStage2 option to run in development', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.KASEKI_GATEWAY_RESPONSE_SMOKE;

        expect(shouldRunGatewayResponseSmoke({ forceStage2: true })).toBe(true);
      });

      it('should respect forceStage2 option to run in test', () => {
        process.env.JEST_WORKER_ID = '1';
        delete process.env.KASEKI_GATEWAY_RESPONSE_SMOKE;

        expect(shouldRunGatewayResponseSmoke({ forceStage2: true })).toBe(true);
      });

      it('should prefer explicit responseSmoke option over forceStage2', () => {
        delete process.env.JEST_WORKER_ID;
        delete process.env.NODE_ENV;
        delete process.env.KASEKI_GATEWAY_RESPONSE_SMOKE;

        expect(shouldRunGatewayResponseSmoke({ forceStage2: true, responseSmoke: false })).toBe(false);
      });

      it('should respect environment variable override over forceStage2', () => {
        delete process.env.JEST_WORKER_ID;
        delete process.env.NODE_ENV;
        process.env.KASEKI_GATEWAY_RESPONSE_SMOKE = 'false';

        expect(shouldRunGatewayResponseSmoke({ forceStage2: true })).toBe(false);
      });
    });

    describe('testGatewayConnectivity_Stage1', () => {
      it('should return ConnectivityTestResult interface (not ResponseSmoke)', async () => {
        process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
        process.env.LLM_GATEWAY_API_KEY = 'test-key';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '{"models": []}',
        });

        const result = await testGatewayConnectivity_Stage1();

        // Should NOT have responseSmokeValidated field
        expect(result).not.toHaveProperty('responseSmokeValidated');
        expect(result).not.toHaveProperty('responseId');
        expect(result).not.toHaveProperty('outputTokens');

        // Should have connectivity fields
        expect(result.status).toBe('ok');
        expect(result.gatewayUrl).toBeDefined();
        expect(result.responseTime).toBeDefined();
        expect(result.authenticationValidated).toBe(true);
      });

      it('should only call /models endpoint, never /responses', async () => {
        process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
        process.env.LLM_GATEWAY_API_KEY = 'test-key';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '{"models": []}',
        });

        await testGatewayConnectivity_Stage1();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/models'),
          expect.any(Object)
        );
        expect(mockFetch).not.toHaveBeenCalledWith(
          expect.stringContaining('/responses'),
          expect.any(Object)
        );
      });

      it('should validate API key via /models endpoint', async () => {
        process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
        process.env.LLM_GATEWAY_API_KEY = 'test-key';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '{"models": []}',
        });

        const result = await testGatewayConnectivity_Stage1();

        expect(result.authenticationValidated).toBe(true);
        expect(result.status).toBe('ok');
      });

      it('should return authenticationValidated=false on 401', async () => {
        process.env.LLM_GATEWAY_URL = 'https://llmgateway.local.xyz/v1';
        process.env.LLM_GATEWAY_API_KEY = 'invalid-key';

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => 'Unauthorized',
        });

        const result = await testGatewayConnectivity_Stage1();

        expect(result.status).toBe('error');
        expect(result.authenticationValidated).toBe(false);
      });
    });

    describe('testGatewayResponseSmoke_Stage2', () => {
      it('should return ResponseSmokeTestResult interface with inference details', async () => {
        mockSuccessfulStage2Responses({
          id: 'resp_12345',
          output_text: 'kaseki gateway smoke ok',
          usage: { output_tokens: 32 },
        });

        const result = await testGatewayResponseSmoke_Stage2(
          'https://llmgateway.local.xyz/v1',
          'test-key',
          new Date().toISOString(),
          performance.now()
        );

        // Should have response-specific fields
        expect(result).toHaveProperty('responseId');
        expect(result).toHaveProperty('outputTokens');

        expect(result.status).toBe('ok');
        expect(result.streamSmokeValidated).toBe(true);
        expect(result.largePromptSmokeValidated).toBe(true);
        expect(result.checks).toHaveLength(3);
      });

      it('should only call /responses endpoint for Stage 2 subchecks', async () => {
        mockSuccessfulStage2Responses({
          id: 'resp_xyz',
          output_text: 'ok',
          usage: { output_tokens: 1 },
        });

        await testGatewayResponseSmoke_Stage2(
          'https://llmgateway.local.xyz/v1',
          'test-key',
          new Date().toISOString(),
          performance.now()
        );

        expect(mockFetch).toHaveBeenCalledTimes(3);
        for (const call of mockFetch.mock.calls) {
          expect(call[0]).toEqual(expect.stringContaining('/responses'));
          expect(call[1]).toEqual(expect.objectContaining({ method: 'POST' }));
        }
      });

      it('should consume tokens (model=auto inference)', async () => {
        mockSuccessfulStage2Responses({
          id: 'resp_inference',
          output_text: 'response text',
          usage: { output_tokens: 42 },
        });

        await testGatewayResponseSmoke_Stage2(
          'https://llmgateway.local.xyz/v1',
          'test-key',
          new Date().toISOString(),
          performance.now()
        );

        // Verify model=auto request was sent
        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining('"model":"auto"'),
          })
        );
      });

      it('should use an artifact-shaped prompt that catches empty assistant turns from complex agent prompts', async () => {
        mockSuccessfulStage2Responses({
          id: 'resp_agent_shape',
          output_text: '{"status":"ok","summary":"kaseki gateway smoke ok"}',
          usage: { output_tokens: 18 },
        });

        await testGatewayResponseSmoke_Stage2(
          'https://llmgateway.local.xyz/v1',
          'test-key',
          new Date().toISOString(),
          performance.now()
        );

        const requestBody = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
        expect(requestBody.model).toBe('auto');
        expect(requestBody.max_output_tokens).toBeGreaterThanOrEqual(128);
        expect(requestBody.input).toContain('Return exactly one JSON object');
        expect(requestBody.input).toContain('kaseki gateway smoke ok');
        expect(requestBody.input).toContain('"status"');
        const streamBody = JSON.parse(String(mockFetch.mock.calls[1][1]?.body));
        expect(streamBody.stream).toBe(true);
        const largeBody = JSON.parse(String(mockFetch.mock.calls[2][1]?.body));
        expect(largeBody.input.length).toBeGreaterThan(requestBody.input.length);
      });

      it('should detect streaming responses with usage but no assistant text deltas', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              id: 'resp_json_ok',
              output_text: 'kaseki gateway smoke ok',
              usage: { output_tokens: 7 },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => [
              ': OPENROUTER PROCESSING',
              '',
              'event: response.completed',
              'data: {"type":"response.completed","response":{"id":"resp_empty_stream","status":"completed","output":[],"usage":{"output_tokens":121}}}',
              '',
              'data: [DONE]',
              '',
            ].join('\n'),
          });

        const result = await testGatewayResponseSmoke_Stage2(
          'https://llmgateway.local.xyz/v1',
          'test-key',
          new Date().toISOString(),
          performance.now()
        );

        expect(result.status).toBe('error');
        expect(result.streamSmokeValidated).toBe(false);
        expect(result.detail).toContain('no assistant text deltas');
        expect(result.responseId).toBe('resp_empty_stream');
        expect(result.outputTokens).toBe(121);
      });

      it('should return error on 401 (auth failure)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => 'Unauthorized',
        });

        const result = await testGatewayResponseSmoke_Stage2(
          'https://llmgateway.local.xyz/v1',
          'invalid-key',
          new Date().toISOString(),
          performance.now()
        );

        expect(result.status).toBe('error');
        expect(result.authenticationValidated).toBe(false);
      });

      it('should return error on timeout', async () => {
        mockFetch.mockRejectedValueOnce(new Error('This operation was aborted'));

        const result = await testGatewayResponseSmoke_Stage2(
          'https://llmgateway.local.xyz/v1',
          'test-key',
          new Date().toISOString(),
          performance.now()
        );

        expect(result.status).toBe('error');
        expect(result.detail).toContain('aborted');
      });
    });
  });
});
