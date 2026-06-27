/**
 * CloudFlare AI Workers Gateway Extension Tests
 *
 * Tests for CloudFlare gateway provider using Pi CLI's native OpenAI API support.
 * Uses TDD approach: tests first, then implementation.
 *
 * NOTE: This test file uses placeholder credentials for unit testing only.
 * Do not add real CloudFlare credentials to this file.
 * Real credentials are injected via environment variables in CI/CD and production.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// Test fixtures (placeholder values - not real credentials)
const testGatewayConfig = {
  url: 'https://gateway.ai.cloudflare.com/v1/PLACEHOLDER_ACCOUNT_ID/default/compat',
  apiKey: 'cfut_PLACEHOLDER_TEST_KEY_DO_NOT_USE',
  model: 'dynamic/kaseki-agent',
};

describe('CloudFlare Gateway Extension', () => {
  let mockPi: Partial<ExtensionAPI>;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save original env
    originalEnv = {
      LLM_GATEWAY_URL: process.env.LLM_GATEWAY_URL,
      LLM_GATEWAY_API_KEY: process.env.LLM_GATEWAY_API_KEY,
      LLM_GATEWAY_API_KEY_FILE: process.env.LLM_GATEWAY_API_KEY_FILE,
      LLM_GATEWAY_MODEL: process.env.LLM_GATEWAY_MODEL,
      LLM_GATEWAY_MAX_OUTPUT_TOKENS: process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS,
      HOME: process.env.HOME,
    };

    // Mock pi.registerProvider
    mockPi = {
      registerProvider: jest.fn(),
    };
  });

  afterEach(() => {
    // Restore original env
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  describe('Credential Resolution', () => {
    it('should resolve API key from LLM_GATEWAY_API_KEY env var', async () => {
      process.env.LLM_GATEWAY_URL = testGatewayConfig.url;
      process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;

      // Dynamic import to ensure fresh module
      const { resolveGatewayApiKey } = await import('../src/.extensions.js');

      const key = resolveGatewayApiKey();
      expect(key).toBe(testGatewayConfig.apiKey);
    });

    it('should return empty string if no API key is configured', async () => {
      delete process.env.LLM_GATEWAY_API_KEY;
      delete process.env.LLM_GATEWAY_API_KEY_FILE;

      const { resolveGatewayApiKey } = await import('../src/.extensions.js');

      const key = resolveGatewayApiKey();
      expect(key).toBe('');
    });

    it('should resolve max output tokens from env var (default 4096)', async () => {
      delete process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS;

      const { resolveGatewayMaxTokens } = await import('../src/.extensions.js');

      const maxTokens = resolveGatewayMaxTokens();
      expect(maxTokens).toBe(4096);
    });

    it('should parse custom max output tokens from env var', async () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '8192';

      const { resolveGatewayMaxTokens } = await import('../src/.extensions.js');

      const maxTokens = resolveGatewayMaxTokens();
      expect(maxTokens).toBe(8192);
    });

    it('should ignore invalid max output tokens and use default', async () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = 'invalid';

      const { resolveGatewayMaxTokens } = await import('../src/.extensions.js');

      const maxTokens = resolveGatewayMaxTokens();
      expect(maxTokens).toBe(4096);
    });
  });

  describe('Provider Registration (OpenAI-compatible)', () => {
    it('should register gateway provider when LLM_GATEWAY_URL is configured', async () => {
      process.env.LLM_GATEWAY_URL = testGatewayConfig.url;
      process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;

      const registerGatewayProvider = (await import('../src/.extensions.js')).default;

      // Call the extension
      registerGatewayProvider(mockPi as ExtensionAPI);

      // Verify provider was registered
      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        'gateway',
        expect.objectContaining({
          name: expect.stringContaining('CloudFlare'),
        })
      );
    });

    it('should NOT register provider if LLM_GATEWAY_URL is not set', async () => {
      delete process.env.LLM_GATEWAY_URL;

      const registerGatewayProvider = (await import('../src/.extensions.js')).default;

      registerGatewayProvider(mockPi as ExtensionAPI);

      // Verify provider was NOT registered
      expect(mockPi.registerProvider).not.toHaveBeenCalled();
    });

    it('should use openai-responses API type for CloudFlare compatibility', async () => {
      process.env.LLM_GATEWAY_URL = testGatewayConfig.url;
      process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;

      const registerGatewayProvider = (await import('../src/.extensions.js')).default;

      registerGatewayProvider(mockPi as ExtensionAPI);

      const callArgs = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const providerConfig = callArgs[1];

      // Should use Pi's native OpenAI-compatible API support
      expect(providerConfig.api).toBe('openai-responses');
    });

    it('should configure model with correct max tokens', async () => {
      process.env.LLM_GATEWAY_URL = testGatewayConfig.url;
      process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '8000';

      const registerGatewayProvider = (await import('../src/.extensions.js')).default;

      registerGatewayProvider(mockPi as ExtensionAPI);

      const callArgs = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const providerConfig = callArgs[1];

      expect(providerConfig.models[0].maxTokens).toBe(8000);
    });
  });

  describe('CloudFlare-specific configuration', () => {
    it('should use "dynamic/kaseki-agent" as default model for CloudFlare', async () => {
      process.env.LLM_GATEWAY_URL = testGatewayConfig.url;
      process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;
      delete process.env.LLM_GATEWAY_MODEL;

      const registerGatewayProvider = (await import('../src/.extensions.js')).default;

      registerGatewayProvider(mockPi as ExtensionAPI);

      const callArgs = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const providerConfig = callArgs[1];

      // CloudFlare gateway expects "dynamic/kaseki-agent" model by default
      expect(providerConfig.models[0].id).toBe('dynamic/kaseki-agent');
    });

    it('should use custom model if LLM_GATEWAY_MODEL is set', async () => {
      process.env.LLM_GATEWAY_URL = testGatewayConfig.url;
      process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;
      process.env.LLM_GATEWAY_MODEL = 'claude-3-opus';

      const registerGatewayProvider = (await import('../src/.extensions.js')).default;

      registerGatewayProvider(mockPi as ExtensionAPI);

      const callArgs = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const providerConfig = callArgs[1];

      expect(providerConfig.models[0].id).toBe('claude-3-opus');
    });

    it('should use CloudFlare baseURL as-is (without path modification)', async () => {
      const baseUrl = 'https://gateway.ai.cloudflare.com/v1/PLACEHOLDER_ACCOUNT_ID/default/compat';
      process.env.LLM_GATEWAY_URL = baseUrl;
      process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;

      const registerGatewayProvider = (await import('../src/.extensions.js')).default;

      registerGatewayProvider(mockPi as ExtensionAPI);

      const callArgs = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const providerConfig = callArgs[1];

      // Pi CLI will append /chat/completions automatically for openai-responses API
      expect(providerConfig.baseUrl).toBe(baseUrl);
    });

    it('should set context window to 128000 tokens for cloud models', async () => {
      process.env.LLM_GATEWAY_URL = testGatewayConfig.url;
      process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;

      const registerGatewayProvider = (await import('../src/.extensions.js')).default;

      registerGatewayProvider(mockPi as ExtensionAPI);

      const callArgs = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const providerConfig = callArgs[1];

      expect(providerConfig.models[0].contextWindow).toBe(128000);
    });
  });

  describe('OpenAI compatibility', () => {
    it('should not require custom fetch normalization', async () => {
      process.env.LLM_GATEWAY_URL = testGatewayConfig.url;
      process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;

      const module = await import('../src/.extensions.js');

      // Should not export fetch normalization functions
      expect(module.normalizeGatewayRequest).toBeUndefined();
      expect(module.createNormalizedFetch).toBeUndefined();

      // Extension should be clean and minimal
      const keys = Object.keys(module);
      expect(keys).toContain('default');
      expect(keys).toContain('resolveGatewayApiKey');
      expect(keys).toContain('resolveGatewayMaxTokens');
    });
  });
});
