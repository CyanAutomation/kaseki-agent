/**
 * Tests for LLM Gateway responsiveness validation
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatGatewayTestResponse, testGatewayConnectivity, GatewayTestResult } from './kaseki-api-gateway-test';

// Mock fetch before importing
global.fetch = jest.fn();

describe('LLM Gateway Test', () => {
  const originalEnv = process.env;
  const mockFetch = global.fetch as jest.Mock;
  let secretsDir: string;

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
});
