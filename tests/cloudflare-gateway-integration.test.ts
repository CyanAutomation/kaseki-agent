/**
 * Deterministic CloudFlare AI Workers Gateway contract tests.
 *
 * This file intentionally mocks fetch and never performs network I/O. Run the
 * opt-in live probe with:
 *   CLOUDFLARE_GATEWAY_TEST=1 node scripts/cloudflare-gateway-live-probe.mjs
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import registerGatewayProvider from '../src/.extensions.js';
import {
  buildCloudflareGatewayChatCompletionsUrl,
  probeCloudflareGateway,
} from '../src/cloudflare-gateway-probe.js';

const testGatewayConfig = {
  url: 'https://gateway.ai.cloudflare.com/v1/PLACEHOLDER_ACCOUNT_ID/default/compat',
  apiKey: 'cfut_PLACEHOLDER_TEST_KEY_DO_NOT_USE',
  model: 'dynamic/kaseki-agent',
};

describe('CloudFlare Gateway deterministic contract', () => {
  it('constructs the exact chat completions endpoint suffix', () => {
    expect(buildCloudflareGatewayChatCompletionsUrl(testGatewayConfig.url)).toBe(
      'https://gateway.ai.cloudflare.com/v1/PLACEHOLDER_ACCOUNT_ID/default/compat/chat/completions'
    );
    expect(buildCloudflareGatewayChatCompletionsUrl(`${testGatewayConfig.url}/`)).toBe(
      'https://gateway.ai.cloudflare.com/v1/PLACEHOLDER_ACCOUNT_ID/default/compat/chat/completions'
    );
  });

  it('posts expected body fields and bearer auth header with default model', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'CloudFlare gateway test successful.' } }],
      }),
    } as Response);

    const result = await probeCloudflareGateway({
      baseUrl: testGatewayConfig.url,
      apiKey: testGatewayConfig.apiKey,
      fetchImpl: fetchMock,
    });

    expect(result.content).toBe('CloudFlare gateway test successful.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.ai.cloudflare.com/v1/PLACEHOLDER_ACCOUNT_ID/default/compat/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testGatewayConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: 'dynamic/kaseki-agent',
          messages: [
            {
              role: 'user',
              content: 'Say "CloudFlare gateway test successful" in one sentence',
            },
          ],
          max_tokens: 256,
        }),
      }
    );
  });

  it('uses custom model, prompt, and max token request body fields', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: [{ text: 'custom response' }] } }] }),
    } as Response);

    const result = await probeCloudflareGateway({
      baseUrl: testGatewayConfig.url,
      apiKey: testGatewayConfig.apiKey,
      model: '@cf/meta/llama-3.1-8b-instruct',
      prompt: 'ping',
      maxTokens: 7,
      fetchImpl: fetchMock,
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      model: '@cf/meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 7,
    });
    expect(result.content).toBe('custom response');
  });

  it('explains reasoning-budget exhaustion when no message content is emitted', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          finish_reason: 'length',
          message: { content: null, reasoning: 'The model used the available output budget.' },
        }],
      }),
    } as Response);

    await expect(probeCloudflareGateway({
      baseUrl: testGatewayConfig.url,
      apiKey: testGatewayConfig.apiKey,
      fetchImpl: fetchMock,
    })).rejects.toThrow('exhausted max_tokens during model reasoning');
  });

  it('throws expected failure for non-200 responses without parsing success content', async () => {
    const jsonMock = jest.fn<() => Promise<unknown>>();
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 503,
      json: jsonMock,
    } as unknown as Response);

    await expect(
      probeCloudflareGateway({
        baseUrl: testGatewayConfig.url,
        apiKey: testGatewayConfig.apiKey,
        fetchImpl: fetchMock,
      })
    ).rejects.toThrow('CloudFlare gateway probe failed with HTTP 503');
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it('registers the gateway provider contract expected by Pi CLI', () => {
    const originalEnv = {
      LLM_GATEWAY_URL: process.env.LLM_GATEWAY_URL,
      LLM_GATEWAY_API_KEY: process.env.LLM_GATEWAY_API_KEY,
      LLM_GATEWAY_MODEL: process.env.LLM_GATEWAY_MODEL,
      LLM_GATEWAY_MAX_OUTPUT_TOKENS: process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS,
    };
    process.env.LLM_GATEWAY_URL = testGatewayConfig.url;
    process.env.LLM_GATEWAY_API_KEY = testGatewayConfig.apiKey;
    process.env.LLM_GATEWAY_MODEL = '@cf/meta/llama-3.1-8b-instruct';
    process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '1234';

    try {
      const mockPi = { registerProvider: jest.fn() };
      registerGatewayProvider(mockPi as unknown as ExtensionAPI);

      expect(mockPi.registerProvider).toHaveBeenCalledWith('gateway', {
        name: 'LLM Gateway (CloudFlare)',
        baseUrl: testGatewayConfig.url,
        apiKey: testGatewayConfig.apiKey,
        api: 'openai-completions',
        models: [
          {
            id: '@cf/meta/llama-3.1-8b-instruct',
            name: 'CloudFlare Gateway (@cf/meta/llama-3.1-8b-instruct)',
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 1234,
          },
        ],
      });
    } finally {
      Object.entries(originalEnv).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
    }
  });
});
