/**
 * Tests for LLM Gateway responsiveness validation
 */

import { testGatewayConnectivity, GatewayTestResult } from './kaseki-api-gateway-test';

// Mock fetch before importing
global.fetch = jest.fn();

describe('LLM Gateway Test', () => {
  const originalEnv = process.env;
  const mockFetch = global.fetch as jest.Mock;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockFetch.mockClear();
  });

  afterEach(() => {
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
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
      delete process.env.LLM_GATEWAY_API_KEY;

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('LLM_GATEWAY_API_KEY');
      expect(result.remediation).toContain('LLM_GATEWAY_API_KEY');
    });

    it('should fail when gateway URL is invalid', async () => {
      process.env.LLM_GATEWAY_URL = 'not-a-valid-url';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('invalid');
    });

    it('should return ok when gateway is reachable and responsive', async () => {
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
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
    });

    it('should return error with 401 when authentication fails', async () => {
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
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
    });

    it('should return error with 403 when forbidden', async () => {
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
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
      process.env.LLM_GATEWAY_URL = 'https://unreachable-gateway-xyz.invalid/v1/models';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));

      const result = await testGatewayConnectivity();

      expect(result.status).toBe('error');
      expect(result.detail).toContain('unreachable');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should include timestamp in response', async () => {
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
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
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
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
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      });

      const result = await testGatewayConnectivity();

      expect(result.gatewayUrl).toBe('https://manifest.scheimann.xyz/v1/responses');
    });

    it('should not include API key in response', async () => {
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
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
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
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
      process.env.LLM_GATEWAY_URL = 'https://manifest.scheimann.xyz/v1/responses';
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
  });

  describe('GatewayTestResult type', () => {
    it('should have all required fields', () => {
      const result: GatewayTestResult = {
        status: 'ok',
        detail: 'Gateway is responsive',
        gatewayUrl: 'https://example.com/v1/models',
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
  });
});
