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
}

/**
 * Test LLM gateway responsiveness
 *
 * @returns Gateway test result with status and diagnostics
 */
export async function testGatewayConnectivity(): Promise<GatewayTestResult> {
  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  // Check configuration
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const apiKey = process.env.LLM_GATEWAY_API_KEY;

  if (!gatewayUrl) {
    return {
      status: 'error',
      detail: 'LLM_GATEWAY_URL is not configured',
      responseTime: 0,
      timestamp,
      authenticationValidated: false,
      remediation: 'Set the LLM_GATEWAY_URL environment variable to your gateway endpoint (e.g., https://manifest.scheimann.xyz/v1/responses)',
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
      remediation: 'Set the LLM_GATEWAY_API_KEY environment variable with your gateway authentication token',
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
          ? 'Authentication failed. Check that LLM_GATEWAY_API_KEY is valid and properly formatted'
          : `Gateway returned an error. Verify the gateway is healthy and the URL is correct (${response.status})`,
      };
    }

    // Successful response
    return {
      status: 'ok',
      detail: `Gateway is responsive (${responseTime}ms)`,
      gatewayUrl,
      responseTime,
      timestamp,
      authenticationValidated: true,
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

/**
 * Build the appropriate models endpoint for the gateway
 * Different gateways have different paths:
 * - OpenAI-compatible: /v1/models
 * - Ollama: /api/tags
 * - Custom: Try /v1/models first
 */
function buildModelsEndpoint(baseUrl: string): string {
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  // If it already has a path component, assume it's correct
  if (url.includes('/v1/')) {
    // Replace the last part with /models
    const parts = url.split('/');
    if (parts[parts.length - 1] !== 'models') {
      parts[parts.length - 1] = 'models';
      return parts.join('/');
    }
    return url;
  }

  // Default to OpenAI-compatible path
  return `${url}/v1/models`;
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
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
  };
}
