import { readHostSecret } from './secrets/host-secrets-reader';

/**
 * LLM Gateway Responsiveness Test
 *
 * Validates that the configured LLM gateway is:
 * 1. Reachable (network connectivity)
 * 2. Responsive (returns HTTP responses)
 * 3. Authenticated (API key is accepted)
 *
 * This is a lightweight test that doesn't consume tokens or make model requests.
 */

/**
 * Result of gateway connectivity test
 */
export interface GatewayTestResult {
  status: 'ok' | 'error';
  detail: string;
  gatewayUrl?: string;
  responseTime: number; // milliseconds
  timestamp: string; // ISO 8601
  authenticationValidated: boolean;
  remediation?: string;
  httpStatus?: number;
  warning?: string;
  responseSmokeValidated?: boolean;
  responseId?: string;
  outputTokens?: number;
}

export interface GatewayTestOptions {
  responseSmoke?: boolean;
}

const GATEWAY_LATENCY_WARNING_MS = 5000;
// Accept both base URLs (/v1) and full response paths (/v1/responses)
// Pi CLI automatically appends /responses, so either format is valid
const GATEWAY_VALID_PATH_PATTERN = /\/v\d+(\/responses)?\/?$/;

export interface GatewayApiKeyResolution {
  configured: boolean;
  source: 'env' | 'host-secret' | 'missing';
  value?: string;
}

export function resolveGatewayApiKey(): GatewayApiKeyResolution {
  if (process.env.LLM_GATEWAY_API_KEY) {
    return {
      configured: true,
      source: 'env',
      value: process.env.LLM_GATEWAY_API_KEY,
    };
  }

  const hostSecret = readHostSecret('llm_gateway_api_key');
  if (hostSecret) {
    return {
      configured: true,
      source: 'host-secret',
      value: hostSecret,
    };
  }

  return {
    configured: false,
    source: 'missing',
  };
}

function parseBooleanOverride(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
  return undefined;
}

export function shouldRunGatewayResponseSmoke(options: GatewayTestOptions = {}): boolean {
  if (typeof options.responseSmoke === 'boolean') return options.responseSmoke;

  const envOverride = parseBooleanOverride(process.env.KASEKI_GATEWAY_RESPONSE_SMOKE);
  if (typeof envOverride === 'boolean') return envOverride;

  if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') return false;
  if (process.env.NODE_ENV === 'development' || process.env.KASEKI_ENV === 'development') return false;

  return true;
}

/**
 * Test LLM gateway responsiveness
 *
 * @returns Gateway test result with status and diagnostics
 */
export async function testGatewayConnectivity(options: GatewayTestOptions = {}): Promise<GatewayTestResult> {
  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  // Check configuration
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const apiKey = resolveGatewayApiKey().value;

  if (!gatewayUrl) {
    return {
      status: 'error',
      detail: 'LLM_GATEWAY_URL is not configured',
      responseTime: 0,
      timestamp,
      authenticationValidated: false,
      remediation: 'Set the LLM_GATEWAY_URL environment variable to your gateway endpoint (e.g., https://llmgateway.local.xyz/v1/responses)',
    };
  }

  if (!apiKey) {
    return {
      status: 'error',
      detail: 'LLM_GATEWAY_API_KEY is not configured',
      gatewayUrl,
      responseTime: 0,
      timestamp,
      authenticationValidated: false,
      remediation: 'Set LLM_GATEWAY_API_KEY or provide a readable llm_gateway_api_key file in the configured Kaseki secrets directory',
    };
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(gatewayUrl);
    if (!parsedUrl.protocol.startsWith('http')) {
      throw new Error('URL must use HTTP or HTTPS');
    }
  } catch {
    return {
      status: 'error',
      detail: `Gateway URL is invalid: ${gatewayUrl}`,
      gatewayUrl,
      responseTime: 0,
      timestamp,
      authenticationValidated: false,
      remediation: 'Ensure LLM_GATEWAY_URL is a valid HTTP/HTTPS URL',
    };
  }

  if (!isResponsesEndpoint(parsedUrl)) {
    return {
      status: 'error',
      detail: `Gateway URL must point to a versioned OpenAI API endpoint (/v1, /v2, etc.): ${gatewayUrl}`,
      gatewayUrl,
      responseTime: 0,
      timestamp,
      authenticationValidated: false,
      remediation: 'Set LLM_GATEWAY_URL to a base API endpoint such as https://gateway.example/v1. Pi CLI will automatically append /responses for the OpenAI Responses API. Examples: https://api.openai.com/v1, https://llmgateway.local.xyz/v1',
    };
  }

  // Make test request to models endpoint
  // Most LLM gateways (OpenAI, Manifest, Ollama) have a /models endpoint for listing
  const modelsEndpoint = buildModelsEndpoint(gatewayUrl);

  try {
    const fetchStartTime = performance.now();
    const response = await fetchWithTimeout(modelsEndpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    }, 10000); // 10 second timeout

    const responseTime = Math.round(performance.now() - fetchStartTime);

    if (!response.ok) {
      const errorBody = await response.text();
      const authError = response.status === 401 || response.status === 403;

      return {
        status: 'error',
        detail: `Gateway returned HTTP ${response.status}: ${errorBody.substring(0, 100)}`,
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: !authError,
        httpStatus: response.status,
        remediation: authError
          ? 'Authentication failed. Check that LLM_GATEWAY_API_KEY is valid, or that the llm_gateway_api_key file in the configured Kaseki secrets directory contains the expected token'
          : `Gateway returned an error. Verify the gateway is healthy and the URL is correct (${response.status})`,
      };
    }

    if (shouldRunGatewayResponseSmoke(options)) {
      const smokeResult = await testGatewayResponseSmoke(gatewayUrl, apiKey, timestamp, startTime);
      if (smokeResult.status === 'error') return smokeResult;

      const warning = responseTime >= GATEWAY_LATENCY_WARNING_MS
        ? `Gateway responded slowly (${responseTime}ms; warning threshold ${GATEWAY_LATENCY_WARNING_MS}ms).`
        : undefined;
      return {
        ...smokeResult,
        detail: `Gateway is responsive and returned usable Responses API content (${smokeResult.responseTime}ms)`,
        warning,
      };
    }

    // Successful response
    const warning = responseTime >= GATEWAY_LATENCY_WARNING_MS
      ? `Gateway responded slowly (${responseTime}ms; warning threshold ${GATEWAY_LATENCY_WARNING_MS}ms).`
      : undefined;
    return {
      status: 'ok',
      detail: `Gateway is responsive (${responseTime}ms)`,
      gatewayUrl,
      responseTime,
      timestamp,
      authenticationValidated: true,
      responseSmokeValidated: false,
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Network errors, timeouts, etc.
    const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('Timeout');
    const isNetwork = errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND');

    return {
      status: 'error',
      detail: `Gateway is unreachable: ${errorMessage}`,
      gatewayUrl,
      responseTime,
      timestamp,
      authenticationValidated: false,
      remediation: isTimeout
        ? 'Gateway is slow or not responding. Check gateway health and network connectivity'
        : isNetwork
          ? 'Cannot reach gateway endpoint. Verify the URL is reachable and check network/firewall rules'
          : 'Unexpected error connecting to gateway. Check logs for details',
    };
  }
}

async function testGatewayResponseSmoke(
  gatewayUrl: string,
  apiKey: string,
  timestamp: string,
  startTime: number,
): Promise<GatewayTestResult> {
  const responseEndpoint = buildResponsesEndpoint(gatewayUrl);
  const fetchStartTime = performance.now();
  try {
    const response = await fetchWithTimeout(responseEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'auto',
        input: 'Reply with exactly: kaseki gateway smoke ok',
        max_output_tokens: 32,
      }),
    }, 15000);

    const responseTime = Math.round(performance.now() - fetchStartTime);
    const bodyText = await response.text();
    if (!response.ok) {
      const authError = response.status === 401 || response.status === 403;
      return {
        status: 'error',
        detail: `Gateway Responses API smoke test returned HTTP ${response.status}: ${bodyText.substring(0, 160)}`,
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: !authError,
        responseSmokeValidated: false,
        httpStatus: response.status,
        remediation: authError
          ? 'Authentication failed for the Responses API smoke test. Check that LLM_GATEWAY_API_KEY is valid for response generation.'
          : 'Gateway /responses path is unhealthy or incompatible. Verify the gateway supports OpenAI Responses API requests with model=auto.',
      };
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return {
        status: 'error',
        detail: `Gateway Responses API smoke test returned non-JSON content: ${bodyText.substring(0, 160)}`,
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: true,
        responseSmokeValidated: false,
        remediation: 'Gateway /responses should return OpenAI Responses-compatible JSON for model=auto.',
      };
    }

    const text = extractResponseText(body);
    const outputTokens = extractOutputTokens(body);
    const responseId = typeof (body as any)?.id === 'string' ? (body as any).id : undefined;
    if (!text.trim()) {
      const detailParts = [
        'Gateway Responses API smoke test returned no assistant text.',
        responseId ? `response_id=${responseId}` : '',
        outputTokens !== undefined ? `output_tokens=${outputTokens}` : '',
      ].filter(Boolean);
      return {
        status: 'error',
        detail: detailParts.join(' '),
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: true,
        responseSmokeValidated: false,
        responseId,
        outputTokens,
        remediation: 'Gateway accepted model=auto but returned an empty assistant response. Check Responses API payload mapping and gateway model routing.',
      };
    }

    return {
      status: 'ok',
      detail: `Gateway Responses API smoke test returned assistant text (${responseTime}ms)`,
      gatewayUrl,
      responseTime,
      timestamp,
      authenticationValidated: true,
      responseSmokeValidated: true,
      responseId,
      outputTokens,
    };
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      status: 'error',
      detail: `Gateway Responses API smoke test failed: ${errorMessage}`,
      gatewayUrl,
      responseTime,
      timestamp,
      authenticationValidated: false,
      responseSmokeValidated: false,
      remediation: 'Cannot complete a model=auto Responses API request. Check gateway health, routing, and network access.',
    };
  }
}

/**
 * Build the appropriate models endpoint for the gateway
 * Handles both base URLs (/v1) and full paths (/v1/responses or /v1/chat/completions)
 */
function buildModelsEndpoint(baseUrl: string): string {
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  // Match base version path: /v1, /v2, /v3, etc., optionally with /responses or other paths
  const versionMatch = url.match(/\/(v\d+)(?:\/|$)/);

  if (versionMatch) {
    // Extract the base URL up to and including the version (e.g., https://example.com/v1)
    const baseWithVersion = url.split(versionMatch[0])[0] + '/' + versionMatch[1];
    return `${baseWithVersion}/models`;
  }

  // Default to OpenAI-compatible path (shouldn't reach here if validation works)
  return `${url}/v1/models`;
}

function buildResponsesEndpoint(baseUrl: string): string {
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (/\/responses$/.test(url)) return url;
  return `${url}/responses`;
}

function extractResponseText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const response = value as any;
  if (typeof response.output_text === 'string') return response.output_text;
  if (typeof response.text === 'string') return response.text;
  if (Array.isArray(response.output)) {
    return response.output.map((item: any) => {
      if (!item || typeof item !== 'object') return '';
      if (typeof item.text === 'string') return item.text;
      if (!Array.isArray(item.content)) return '';
      return item.content.map((part: any) => {
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.output_text === 'string') return part.output_text;
        return '';
      }).join('');
    }).join('');
  }
  return '';
}

function extractOutputTokens(value: unknown): number | undefined {
  const usage = (value as any)?.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  for (const key of ['output_tokens', 'output', 'completion_tokens']) {
    if (typeof usage[key] === 'number' && Number.isFinite(usage[key])) return usage[key];
  }
  return undefined;
}

export function isResponsesEndpoint(url: URL): boolean {
  return GATEWAY_VALID_PATH_PATTERN.test(url.pathname);
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Export test result for use in API routes
 */
export function formatGatewayTestResponse(result: GatewayTestResult): object {
  return {
    status: result.status,
    detail: result.detail,
    gatewayUrl: result.gatewayUrl,
    responseTime: result.responseTime,
    timestamp: result.timestamp,
    authenticationValidated: result.authenticationValidated,
    remediation: result.remediation,
    httpStatus: result.httpStatus,
    warning: result.warning,
    responseSmokeValidated: result.responseSmokeValidated,
    responseId: result.responseId,
    outputTokens: result.outputTokens,
  };
}
