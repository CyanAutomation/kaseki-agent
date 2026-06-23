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

function resolveGatewayMaxTokens() {
  const raw = process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS;
  if (!raw) return 4096;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4096;
}

/**
 * Normalize request payload for OpenAI Responses API compatibility
 *
 * Converts multi-message array input to messages field:
 * - {input: [{role, content}]} → {messages: [{role, content}]}
 * - {input: "string"} → {input: "string"} (unchanged)
 *
 * @param {Record<string, any>} request - Request payload
 * @returns {Record<string, any>} Normalized request
 */
function normalizeGatewayRequest(request) {
  const { input, ...rest } = request;

  // Check if input is a multi-message array (array of {role, content} objects)
  if (
    Array.isArray(input) &&
    input.length > 0 &&
    input.every(item =>
      typeof item === 'object' &&
      item !== null &&
      'role' in item &&
      'content' in item,
    )
  ) {
    // Convert multi-message array to messages field
    // This is required for OpenAI Responses API when sending conversation history
    return {
      ...rest,
      messages: input,
    };
  }

  // Keep input field as-is (string or invalid format)
  // String inputs are passed through unchanged for simple prompts
  // Malformed arrays will be caught by the gateway error handling
  return { input, ...rest };
}

/**
 * Create a fetch wrapper that normalizes request payloads
 * This intercepts fetch calls to apply normalization before sending to gateway
 *
 * @param {Function} originalFetch - The original fetch function
 * @returns {Function} Wrapped fetch function that normalizes requests
 */
function createNormalizedFetch(originalFetch) {
  return async function normalizedFetch(url, options) {
    // Only normalize requests to /responses endpoints
    if (typeof url === 'string' && url.includes('/responses')) {
      try {
        const opts = { ...options };
        if (opts.body && typeof opts.body === 'string') {
          const body = JSON.parse(opts.body);
          const normalized = normalizeGatewayRequest(body);
          opts.body = JSON.stringify(normalized);
        }
        return originalFetch(url, opts);
      } catch {
        // If normalization fails, proceed with original request
        // This ensures we don't break anything if there are parsing issues
        return originalFetch(url, options);
      }
    }

    // Pass through all other requests unchanged
    return originalFetch(url, options);
  };
}

// Store original fetch before patching
const originalFetch = global.fetch;

// Patch global fetch with normalization wrapper
if (originalFetch && !process.env.PI_EXTENSIONS_GATEWAY_FETCH_PATCHED) {
  global.fetch = createNormalizedFetch(originalFetch);
  process.env.PI_EXTENSIONS_GATEWAY_FETCH_PATCHED = 'true';
}

export default function registerGatewayProvider(pi) {
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const gatewayApiKey = resolveGatewayApiKey();
  const maxTokens = resolveGatewayMaxTokens();

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
          maxTokens
        }
      ]
    });
  }
}
