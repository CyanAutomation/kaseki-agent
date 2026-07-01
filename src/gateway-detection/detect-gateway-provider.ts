/**
 * Gateway Provider Detection & Configuration
 *
 * Handles detection and configuration of LLM gateway endpoints, provider types,
 * and endpoint builders for different gateway implementations (OpenAI-compatible,
 * Cloudflare /compat, etc.).
 */

import { readHostSecret } from '../secrets/host-secrets-reader';

// Accept base URLs (/v1), full response paths (/v1/responses), and gateway-specific suffixes (e.g., /v1/compat)
// For Cloudflare and similar gateways, allows /v1/{segments}/compat (e.g., /v1/account/namespace/compat)
// Pi CLI automatically appends /responses, so either format is valid
// Does NOT allow arbitrary endpoints like /v1/chat/completions
const GATEWAY_VALID_PATH_PATTERN = /\/v\d+(?:(?:\/[a-z0-9-]+)*\/compat)?(?:\/responses)?\/?$/;

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

/**
 * Detect current environment for stage 2 token consumption decisions
 * Returns 'production' | 'development' | 'test'
 */
export function detectGatewayTestEnvironment(): 'production' | 'development' | 'test' {
  // Test environment: Jest runner
  if (process.env.JEST_WORKER_ID) return 'test';

  // Test/development environment: NODE_ENV
  if (process.env.NODE_ENV === 'test') return 'test';
  if (process.env.NODE_ENV === 'development') return 'development';

  // Development environment: KASEKI_ENV
  if (process.env.KASEKI_ENV === 'development') return 'development';

  // Default to production for safety
  return 'production';
}

export interface GatewayTestOptions {
  responseSmoke?: boolean;
  forceStage2?: boolean; // Force stage 2 to run even in dev/test environments
}

export function shouldRunGatewayResponseSmoke(options: GatewayTestOptions = {}): boolean {
  // 1. Explicit query param override (highest priority)
  if (typeof options.responseSmoke === 'boolean') return options.responseSmoke;

  // 2. Environment variable override
  const envOverride = parseBooleanOverride(process.env.KASEKI_GATEWAY_RESPONSE_SMOKE);
  if (typeof envOverride === 'boolean') return envOverride;

  // 3. Forced stage 2 for testing in dev/test environments
  if (options.forceStage2) return true;

  // 4. Safe default: do not consume inference tokens unless explicitly opted in.
  // Live response smoke probing is enabled by passing responseSmoke=true,
  // forceStage2=true, or KASEKI_GATEWAY_RESPONSE_SMOKE=true.
  return false;
}

export function shouldRunPiProviderSmoke(requested: boolean): boolean {
  // 1. Allow explicit opt-in in any environment (requested=true from ?piProvider=true).
  if (requested) return true;

  // 2. Allow override via env var for integration environments.
  if (parseBooleanOverride(process.env.KASEKI_ALLOW_DEV_PI_PROVIDER_SMOKE) === true) return true;

  // 3. Default to skip unless explicitly requested.
  return false;
}

export function resolveGatewayModel(): string {
  return process.env.KASEKI_MODEL || process.env.LLM_GATEWAY_MODEL || 'dynamic/kaseki-agent';
}

/**
 * Detect if a gateway URL is a Cloudflare endpoint (ends with /compat)
 * Exported for testing
 */
export function isCloudflareGateway(url: string): boolean {
  try {
    const normalized = url.endsWith('/') ? url.slice(0, -1) : url;
    return /\/compat$/.test(new URL(normalized).pathname);
  } catch {
    return false;
  }
}

export function buildGatewayAuthHeaders(baseUrl: string, apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(isCloudflareGateway(baseUrl) ? { 'cf-aig-authorization': `Bearer ${apiKey}` } : {}),
  };
}

interface Stage1ProbeRequest {
  endpoint: string;
  init: Record<string, unknown>;
}

const CLOUDFLARE_STAGE1_PROBE_PROMPT = 'Reply with ok.';

export function buildStage1ProbeRequest(baseUrl: string): Stage1ProbeRequest {
  const apiKey = resolveGatewayApiKey().value ?? '';

  if (isCloudflareGateway(baseUrl)) {
    return {
      endpoint: buildCloudflareInferenceEndpoint(baseUrl),
      init: {
        method: 'POST',
        headers: {
          ...buildGatewayAuthHeaders(baseUrl, apiKey),
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: resolveGatewayModel(),
          messages: [{ role: 'user', content: CLOUDFLARE_STAGE1_PROBE_PROMPT }],
          max_tokens: 1,
          stream: false,
        }),
      },
    };
  }

  return {
    endpoint: buildModelsEndpoint(baseUrl),
    init: {
      method: 'GET',
      headers: {
        ...buildGatewayAuthHeaders(baseUrl, apiKey),
        Accept: 'application/json',
      },
    },
  };
}

/**
 * Build the appropriate models endpoint for the gateway
 * Handles both base URLs (/v1) and full paths (/v1/responses or /v1/chat/completions)
 * Exported for testing
 */
export function buildModelsEndpoint(baseUrl: string): string {
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

/**
 * Build the appropriate responses/chat endpoint for the gateway
 * For Cloudflare endpoints (/compat), returns base URL without appending /responses
 * For standard gateways, appends /responses for OpenAI Responses API
 * Exported for testing
 */
export function buildResponsesEndpoint(baseUrl: string): string {
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  // For Cloudflare gateways, return base URL as-is (SDK will handle path appending)
  if (isCloudflareGateway(url)) {
    return url;
  }

  // For standard gateways, append /responses if not already present
  if (/\/responses$/.test(url)) return url;
  return `${url}/responses`;
}

/**
 * Build the chat completions endpoint for Cloudflare gateways
 * Cloudflare requires /chat/completions for inference, not /responses
 * Exported for testing
 */
export function buildCloudflareInferenceEndpoint(baseUrl: string): string {
  if (!isCloudflareGateway(baseUrl)) {
    throw new Error('buildCloudflareInferenceEndpoint should only be used for Cloudflare URLs');
  }
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${url}/chat/completions`;
}

export function isResponsesEndpoint(url: URL): boolean {
  return GATEWAY_VALID_PATH_PATTERN.test(url.pathname);
}

export function isInvalidGatewayPathError(errorBody: string): boolean {
  return /invalid request path/i.test(errorBody);
}
