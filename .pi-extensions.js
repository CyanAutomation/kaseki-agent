/**
 * Pi CLI Custom Extension: LLM Gateway Provider
 *
 * Registers a custom LLM gateway provider that reads endpoint and API key
 * from environment variables.
 *
 * Configuration Environment Variables:
 * - LLM_GATEWAY_URL: Gateway API endpoint (required; base URL only, e.g., https://llmgateway.local.xyz/v1)
 *   NOTE: Pi CLI automatically appends /responses for the openai-responses API type.
 *   So LLM_GATEWAY_URL=https://llmgateway.local.xyz/v1 results in requests to /v1/responses.
 * - LLM_GATEWAY_API_KEY: API key literal (optional, prefer file)
 * - LLM_GATEWAY_API_KEY_FILE: Path to file containing API key
 * - LLM_GATEWAY_MODEL: Model selector (optional, defaults to "auto")
 */

import fs from 'node:fs';

function resolveGatewayApiKey() {
  if (process.env.LLM_GATEWAY_API_KEY) {
    return process.env.LLM_GATEWAY_API_KEY;
  }

  const filePath = process.env.LLM_GATEWAY_API_KEY_FILE;
  if (filePath) {
    try {
      const value = fs.readFileSync(filePath, 'utf8').trim();
      if (value) return value;
    } catch {
      // Pi will surface the provider initialization failure to the caller.
    }
  }

  return '';
}

export default function registerGatewayProvider(pi) {
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const gatewayApiKey = resolveGatewayApiKey();

  // If gateway is configured, register the provider
  if (gatewayUrl) {
    pi.registerProvider('gateway', {
      name: 'LLM Gateway',
      baseUrl: gatewayUrl,
      apiKey: gatewayApiKey || '$LLM_GATEWAY_API_KEY',
      api: 'openai-responses', // Manifest gateway is OpenAI Responses API compatible
      models: [
        {
          id: 'auto',
          name: 'Auto (Gateway Default)',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096
        }
      ]
    });
  }
}
