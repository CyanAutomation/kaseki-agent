/**
 * CloudFlare AI Workers Gateway Connectivity Integration Test
 *
 * Tests actual connection to CloudFlare gateway with provided credentials.
 * Validates that the extension properly configures Pi CLI for CloudFlare.
 *
 * SECURITY NOTE: Credentials are NOT hardcoded in this file.
 * Instead, set the following environment variables before running this test:
 * - LLM_GATEWAY_URL: CloudFlare gateway endpoint (https://gateway.ai.cloudflare.com/v1/...)
 * - LLM_GATEWAY_API_KEY: CloudFlare API key (cfut_...)
 * - LLM_GATEWAY_MODEL: CloudFlare model ID (defaults to dynamic/kaseki-agent)
 *
 * To enable this test, set: CLOUDFLARE_GATEWAY_TEST=1 npm test
 * This test is skipped by default to avoid unnecessary token consumption.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Determine if we should run integration tests
// Requires explicit environment variable to enable
const shouldRunIntegrationTests =
  process.env.CLOUDFLARE_GATEWAY_TEST === '1' ||
  process.env.CLOUDFLARE_GATEWAY_TEST === 'true';

const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

describeIntegration('CloudFlare Gateway Integration Test', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Verify required credentials are set before running tests
    if (shouldRunIntegrationTests) {
      if (!process.env.LLM_GATEWAY_URL) {
        throw new Error(
          'LLM_GATEWAY_URL environment variable must be set to run CloudFlare integration tests'
        );
      }
      if (!process.env.LLM_GATEWAY_API_KEY && !process.env.LLM_GATEWAY_API_KEY_FILE) {
        throw new Error(
          'Either LLM_GATEWAY_API_KEY or LLM_GATEWAY_API_KEY_FILE environment variable must be set'
        );
      }
    }

    originalEnv = {
      LLM_GATEWAY_URL: process.env.LLM_GATEWAY_URL,
      LLM_GATEWAY_API_KEY: process.env.LLM_GATEWAY_API_KEY,
      LLM_GATEWAY_API_KEY_FILE: process.env.LLM_GATEWAY_API_KEY_FILE,
      LLM_GATEWAY_MODEL: process.env.LLM_GATEWAY_MODEL,
    };

    // Use environment variables directly (no hardcoded credentials)
    // Set defaults if not already configured
    process.env.LLM_GATEWAY_MODEL = process.env.LLM_GATEWAY_MODEL || 'dynamic/kaseki-agent';
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

  it(
    'should verify CloudFlare gateway connectivity with provided credentials',
    async () => {
      // Load the extension
      const { resolveGatewayApiKey } = await import('../src/.extensions.js');

      const apiKey = resolveGatewayApiKey();
      const baseUrl = process.env.LLM_GATEWAY_URL;

      // Verify credentials are loaded
      expect(apiKey).toBeTruthy();
      expect(baseUrl).toBeTruthy();

      // Test basic connectivity to CloudFlare gateway
      const response = await fetch(
        `${baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: process.env.LLM_GATEWAY_MODEL || 'dynamic/kaseki-agent',
            messages: [
              {
                role: 'user',
                content: 'Say "CloudFlare gateway test successful" in one sentence',
              },
            ],
            max_tokens: 50,
          }),
        }
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.choices).toBeDefined();
      expect(Array.isArray(data.choices)).toBe(true);
      expect(data.choices.length).toBeGreaterThan(0);

      // Verify response structure (OpenAI-compatible format)
      const choice = data.choices[0];
      expect(choice.message).toBeDefined();
      expect(choice.message.content).toBeDefined();

      // Content can be string or array depending on response format
      const content =
        typeof choice.message.content === 'string'
          ? choice.message.content
          : Array.isArray(choice.message.content)
            ? choice.message.content
              .map((c: Record<string, unknown>) => c.text || c)
              .join('')
            : String(choice.message.content);

      expect(content).toBeTruthy();

      console.log('✓ CloudFlare gateway connectivity verified');

      console.log(`  Response: ${String(content).substring(0, 100)}`);
    },
    // Increase timeout for integration test (30 seconds)
    30000
  );

  it('should successfully register Pi CLI with CloudFlare gateway provider', async () => {
    // This is a smoke test that verifies the extension registration works
    // Actual Pi CLI invocation would be done in e2e tests

    const module = await import('../src/.extensions.js');

    const mockPi = {
      registerProvider: jest.fn(),
    };

    // Reload module to re-run registration with current env vars
    module.default(mockPi);

    // Verify the provider was registered
    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      'gateway',
      expect.objectContaining({
        name: expect.stringContaining('CloudFlare'),
        baseUrl: process.env.LLM_GATEWAY_URL,
        api: 'openai-responses',
        models: expect.arrayContaining([
          expect.objectContaining({
            id: process.env.LLM_GATEWAY_MODEL || 'dynamic/kaseki-agent',
          }),
        ]),
      })
    );
  });
});
