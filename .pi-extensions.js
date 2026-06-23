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
 *
 * NOTE: This extension patches global.fetch to normalize multi-message array prompts
 * to the OpenAI Responses API format before sending to gateway.
 * Diagnostic events are emitted to .gateway-diagnostics.jsonl for monitoring.
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
 * @returns {{normalized: Record<string, any>, wasNormalized: boolean}} Normalized request and flag
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
      normalized: {
        ...rest,
        messages: input,
      },
      wasNormalized: true,
    };
  }

  // Keep input field as-is (string or invalid format)
  // String inputs are passed through unchanged for simple prompts
  // Malformed arrays will be caught by the gateway error handling
  return { normalized: { input, ...rest }, wasNormalized: false };
}

/**
 * Extract and parse JSON body from request options or Buffer
 *
 * @param {string | Buffer | undefined} body - Request body
 * @returns {{parsed: Record<string, any> | null}} Parsed body
 */
function parseRequestBody(body) {
  if (!body) {
    return { parsed: null };
  }

  try {
    const bodyStr = typeof body === 'string' ? body : body.toString('utf8');
    return { parsed: JSON.parse(bodyStr) };
  } catch {
    return { parsed: null };
  }
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
        const { parsed } = parseRequestBody(opts.body);

        if (parsed) {
          const { normalized, wasNormalized } = normalizeGatewayRequest(parsed);
          if (wasNormalized) {
            opts.body = JSON.stringify(normalized);
            recordGatewayDiagnostic('fetch', 'normalized', { from: 'array', to: 'messages' });
          } else {
            recordGatewayDiagnostic('fetch', 'passthrough', { format: typeof parsed.input });
          }
        }
        return originalFetch(url, opts);
      } catch (error) {
        // If normalization fails, log and proceed with original request
        recordGatewayDiagnostic('fetch', 'error', { reason: error?.message || 'unknown' });
        return originalFetch(url, options);
      }
    }

    // Pass through all other requests unchanged
    return originalFetch(url, options);
  };
}

/**
 * Create an undici request wrapper that normalizes request payloads
 * Note: Reserved for future use if Pi CLI transitions to using global.fetch
 * or if extension hooks become available. Currently, we rely on fetch wrapper.
 *
 * @param {Function} originalRequest - The original undici.request function
 * @returns {Function} Wrapped request function that normalizes payloads
 */
// eslint-disable-next-line no-unused-vars
function _createNormalizedUndiciRequest(originalRequest) {
  return async function normalizedRequest(options, factory) {
    // Only normalize requests to /responses endpoints
    if (
      typeof options === 'object' &&
      options.path &&
      typeof options.path === 'string' &&
      options.path.includes('/responses')
    ) {
      try {
        const opts = { ...options };
        const { parsed } = parseRequestBody(opts.body);

        if (parsed) {
          const { normalized, wasNormalized } = normalizeGatewayRequest(parsed);
          if (wasNormalized) {
            opts.body = JSON.stringify(normalized);
            recordGatewayDiagnostic('undici', 'normalized', { from: 'array', to: 'messages' });
          } else {
            recordGatewayDiagnostic('undici', 'passthrough', { format: typeof parsed.input });
          }
        }
        return originalRequest(opts, factory);
      } catch (error) {
        // If normalization fails, log and proceed with original request
        recordGatewayDiagnostic('undici', 'error', { reason: error?.message || 'unknown' });
        return originalRequest(options, factory);
      }
    }

    // Pass through all other requests unchanged
    return originalRequest(options, factory);
  };
}

/**
 * Record diagnostic events for gateway request normalization
 * Stores in global for access by monitoring/logging subsystems
 * Also writes to file if /results directory exists for artifact collection
 *
 * @param {string} transport - 'fetch' or 'undici'
 * @param {string} action - 'normalized', 'passthrough', 'error'
 * @param {Record<string, any>} details - Diagnostic details
 */
function recordGatewayDiagnostic(transport, action, details) {
  if (!global.__kasekiGatewayDiagnostics) {
    global.__kasekiGatewayDiagnostics = [];
  }

  const event = {
    timestamp: new Date().toISOString(),
    transport,
    action,
    details,
  };

  global.__kasekiGatewayDiagnostics.push(event);

  // Also try to write to /results/.gateway-diagnostics.jsonl if available
  // This ensures diagnostics are captured even if process is killed
  try {
    if (fs.existsSync('/results')) {
      const diagnosticsFile = '/results/.gateway-diagnostics.jsonl';
      fs.appendFileSync(diagnosticsFile, JSON.stringify(event) + '\n', 'utf8');
    }
  } catch {
    // Silently ignore file write errors (directory might not be writable or available)
  }
}

// Store original fetch before patching
const originalFetch = global.fetch;

// Patch global fetch with normalization wrapper (if not already patched)
if (originalFetch && !process.env.PI_EXTENSIONS_GATEWAY_FETCH_PATCHED) {
  global.fetch = createNormalizedFetch(originalFetch);
  process.env.PI_EXTENSIONS_GATEWAY_FETCH_PATCHED = 'true';
}

// Note: Undici patching is deferred to Pi CLI extension hooks if available
// The fetch wrapper above will catch requests made through fetch API
// Diagnostic events are still recorded to .gateway-diagnostics.jsonl file
// for visibility into all request normalization attempts
if (!process.env.PI_EXTENSIONS_GATEWAY_INIT_COMPLETE) {
  process.env.PI_EXTENSIONS_GATEWAY_INIT_COMPLETE = 'true';
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
