/**
 * Gateway Response Smoke Test Checks
 * Extracted from kaseki-api-gateway-smoke.ts for modularity and testability
 *
 * Validates gateway inference and streaming capabilities via the OpenAI Responses API.
 */

import {
  buildGatewayAuthHeaders,
  buildResponsesEndpoint,
  isCloudflareGateway,
  resolveGatewayModel,
} from '../gateway-detection/detect-gateway-provider';
import {
  extractOutputTokens,
  parseResponsesSse,
} from './analyze-gateway-response';
import {
  fetchWithTimeout,
} from './extract-pi-json';
import { probeCloudflareGateway } from '../cloudflare-gateway-probe';
import type { GatewayTestResult, ResponseSmokeSubcheck, ResponseSmokeTestResult } from '../kaseki-api-gateway-smoke';

// Constants for gateway smoke testing
const GATEWAY_RESPONSE_SMOKE_TIMEOUT_MS = (() => {
  const envValue = process.env.KASEKI_GATEWAY_RESPONSE_SMOKE_TIMEOUT_MS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 45000; // 45 second default
})();

const GATEWAY_RESPONSE_SMOKE_PROMPT = [
  'You are validating an OpenAI Responses API gateway for Kaseki agent prompts.',
  'Return exactly one JSON object with no markdown and no surrounding text.',
  'The JSON object must be: {"status":"ok","summary":"kaseki gateway smoke ok"}',
].join('\n');

const GATEWAY_RESPONSE_LARGE_SMOKE_PROMPT = [
  GATEWAY_RESPONSE_SMOKE_PROMPT,
  '',
  'Context sample:',
  ...Array.from({ length: 80 }, (_, index) =>
    `- file_${String(index + 1).padStart(2, '0')}.ts: inspect this synthetic repository note and preserve the required JSON-only response contract.`,
  ),
].join('\n');

const GATEWAY_RESPONSE_SMOKE_MAX_OUTPUT_TOKENS = 256;

/**
 * Test gateway response inference and streaming capabilities
 * Runs multiple checks: JSON response, streaming response, large prompt response
 *
 * @returns Result with detailed checks array
 */
export async function testGatewayResponseSmokeFull(
  gatewayUrl: string,
  apiKey: string,
  timestamp: string,
  startTime: number,
  legacyShape: boolean,
): Promise<ResponseSmokeTestResult & GatewayTestResult> {
  const checks: ResponseSmokeSubcheck[] = [];

  // Cloudflare's /compat endpoint uses Chat Completions, so perform the
  // stage-2 inference with that protocol instead of skipping it.
  if (isCloudflareGateway(gatewayUrl)) {
    try {
      await probeCloudflareGateway({
        baseUrl: gatewayUrl,
        apiKey,
        model: resolveGatewayModel(),
        maxTokens: 256,
      });
      const responseTime = performance.now() - startTime;
      checks.push({
        name: 'cloudflare-compat-note',
        status: 'ok',
        detail: 'Cloudflare Chat Completions inference passed via /compat/chat/completions.',
        responseTime,
      });
      return {
        status: 'ok',
        detail: 'Cloudflare Chat Completions inference verified.',
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: true,
        responseSmokeValidated: true,
        checks,
      };
    } catch (error) {
      const responseTime = performance.now() - startTime;
      const detail = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        detail,
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: !/HTTP (401|403)/.test(detail),
        responseSmokeValidated: false,
        remediation: 'Verify the Cloudflare token, model route, and /compat Chat Completions endpoint.',
        checks: [{ name: 'cloudflare-compat-note', status: 'error', detail, responseTime }],
      };
    }
  }

  const jsonCheck = await runGatewayResponseJsonCheck(
    gatewayUrl,
    apiKey,
    timestamp,
    startTime,
    GATEWAY_RESPONSE_SMOKE_PROMPT,
    'json-response',
    legacyShape,
  );
  checks.push(jsonCheck.check);
  if (jsonCheck.result.status === 'error') {
    return { ...jsonCheck.result, checks };
  }

  const streamCheck = await runGatewayResponseStreamCheck(gatewayUrl, apiKey, timestamp, startTime);
  checks.push(streamCheck.check);
  if (streamCheck.result.status === 'error') {
    return { ...streamCheck.result, checks };
  }

  const largeCheck = await runGatewayResponseJsonCheck(
    gatewayUrl,
    apiKey,
    timestamp,
    startTime,
    GATEWAY_RESPONSE_LARGE_SMOKE_PROMPT,
    'large-prompt-response',
    legacyShape,
  );
  checks.push(largeCheck.check);
  if (largeCheck.result.status === 'error') {
    return { ...largeCheck.result, streamSmokeValidated: true, checks };
  }

  return {
    ...largeCheck.result,
    status: 'ok',
    detail: `Gateway Responses API smoke checks passed (${checks.length} checks)`,
    streamSmokeValidated: true,
    largePromptSmokeValidated: true,
    responseSmokeValidated: true,
    checks,
  };
}

/**
 * Run JSON response smoke check against gateway
 * Tests basic inference with standard prompt
 */
export async function runGatewayResponseJsonCheck(
  gatewayUrl: string,
  apiKey: string,
  timestamp: string,
  startTime: number,
  prompt: string,
  checkName: 'json-response' | 'large-prompt-response',
  legacyShape: boolean,
): Promise<{ result: ResponseSmokeTestResult & GatewayTestResult; check: ResponseSmokeSubcheck }> {
  // Helper to extract response text
  const extractResponseText = (value: unknown): string => {
    if (!value || typeof value !== 'object') return '';
    const response = value as any;
    if (typeof response.output_text === 'string') return response.output_text;
    if (typeof response.text === 'string') return response.text;
    if (Array.isArray(response.output)) {
      return response.output
        .map((item: any) => {
          if (!item || typeof item !== 'object') return '';
          if (typeof item.text === 'string') return item.text;
          if (!Array.isArray(item.content)) return '';
          return item.content
            .map((part: any) => {
              if (!part || typeof part !== 'object') return '';
              if (typeof part.text === 'string') return part.text;
              if (typeof part.output_text === 'string') return part.output_text;
              return '';
            })
            .join('');
        })
        .join('');
    }
    return '';
  };

  const responseEndpoint = buildResponsesEndpoint(gatewayUrl);
  const fetchStartTime = performance.now();
  try {
    const response = await fetchWithTimeout(
      responseEndpoint,
      {
        method: 'POST',
        headers: {
          ...buildGatewayAuthHeaders(gatewayUrl, apiKey),
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: resolveGatewayModel(),
          input: prompt,
          max_output_tokens: GATEWAY_RESPONSE_SMOKE_MAX_OUTPUT_TOKENS,
        }),
      },
      GATEWAY_RESPONSE_SMOKE_TIMEOUT_MS,
    );

    const responseTime = Math.round(performance.now() - fetchStartTime);
    const bodyText = await response.text();
    if (!response.ok) {
      const authError = response.status === 401 || response.status === 403;
      return {
        result: {
          status: 'error',
          detail: `Gateway ${checkName} smoke test returned HTTP ${response.status}: ${bodyText.substring(0, 160)}`,
          gatewayUrl,
          responseTime,
          timestamp,
          authenticationValidated: !authError,
          responseSmokeValidated: false,
          httpStatus: response.status,
          remediation: authError
            ? 'Authentication failed for the Responses API smoke test. Check that LLM_GATEWAY_API_KEY is valid for response generation.'
            : 'Gateway /responses path is unhealthy or incompatible. Verify the gateway supports OpenAI Responses API requests with the resolved gateway model (default dynamic/kaseki-agent).',
        },
        check: { name: checkName, status: 'error', detail: `HTTP ${response.status}`, responseTime },
      };
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return {
        result: {
          status: 'error',
          detail: `Gateway ${checkName} smoke test returned non-JSON content: ${bodyText.substring(0, 160)}`,
          gatewayUrl,
          responseTime,
          timestamp,
          authenticationValidated: true,
          responseSmokeValidated: false,
          remediation: 'Gateway /responses should return OpenAI Responses-compatible JSON for dynamic/kaseki-agent by default, or the resolved gateway model.',
        },
        check: { name: checkName, status: 'error', detail: 'non-JSON response body', responseTime },
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
        result: {
          status: 'error',
          detail: detailParts.join(' '),
          gatewayUrl,
          responseTime,
          timestamp,
          authenticationValidated: true,
          responseSmokeValidated: false,
          responseId,
          outputTokens,
          remediation:
            'Gateway accepted the resolved gateway model for routing but returned an empty assistant response. Keep dynamic/kaseki-agent enabled by default, or set KASEKI_MODEL/LLM_GATEWAY_MODEL to a supported model; fix the Responses API adapter to surface routed model output as output_text, response.output_text.delta, or assistant message content.',
        },
        check: { name: checkName, status: 'error', detail: detailParts.join(' '), responseTime, responseId, outputTokens },
      };
    }

    return {
      result: {
        status: 'ok',
        detail: `${checkName} generated valid response (${responseTime}ms)`,
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: true,
        responseSmokeValidated: legacyShape ? true : undefined,
        responseId,
        outputTokens,
        largePromptSmokeValidated: checkName === 'large-prompt-response' ? true : undefined,
      },
      check: { name: checkName, status: 'ok', detail: 'assistant text returned', responseTime, responseId, outputTokens },
    };
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      result: {
        status: 'error',
        detail: `Gateway ${checkName} smoke test failed: ${errorMessage}`,
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: false,
        responseSmokeValidated: false,
        remediation: 'Cannot complete a Responses API request with the resolved gateway model. Check gateway health, routing, and network access.',
      },
      check: { name: checkName, status: 'error', detail: errorMessage, responseTime },
    };
  }
}

/**
 * Run streaming response smoke check against gateway
 * Tests streaming inference with SSE deltas
 */
export async function runGatewayResponseStreamCheck(
  gatewayUrl: string,
  apiKey: string,
  timestamp: string,
  startTime: number,
): Promise<{ result: ResponseSmokeTestResult & GatewayTestResult; check: ResponseSmokeSubcheck }> {
  const responseEndpoint = buildResponsesEndpoint(gatewayUrl);
  const fetchStartTime = performance.now();
  try {
    const response = await fetchWithTimeout(
      responseEndpoint,
      {
        method: 'POST',
        headers: {
          ...buildGatewayAuthHeaders(gatewayUrl, apiKey),
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: resolveGatewayModel(),
          input: GATEWAY_RESPONSE_SMOKE_PROMPT,
          max_output_tokens: GATEWAY_RESPONSE_SMOKE_MAX_OUTPUT_TOKENS,
          stream: true,
        }),
      },
      GATEWAY_RESPONSE_SMOKE_TIMEOUT_MS,
    );

    const responseTime = Math.round(performance.now() - fetchStartTime);
    const bodyText = await response.text();
    if (!response.ok) {
      const authError = response.status === 401 || response.status === 403;
      return {
        result: {
          status: 'error',
          detail: `Gateway streaming smoke test returned HTTP ${response.status}: ${bodyText.substring(0, 160)}`,
          gatewayUrl,
          responseTime,
          timestamp,
          authenticationValidated: !authError,
          responseSmokeValidated: false,
          streamSmokeValidated: false,
          httpStatus: response.status,
          remediation: authError
            ? 'Authentication failed for the streaming Responses API smoke test. Check that LLM_GATEWAY_API_KEY is valid for response generation.'
            : 'Gateway streaming /responses path is unhealthy or incompatible. Verify it emits OpenAI Responses SSE events for stream=true.',
        },
        check: { name: 'streaming-response', status: 'error', detail: `HTTP ${response.status}`, responseTime },
      };
    }

    const parsed = parseResponsesSse(bodyText);
    if (!parsed.text.trim()) {
      const detailParts = [
        'Gateway streaming smoke test returned no assistant text deltas.',
        parsed.responseId ? `response_id=${parsed.responseId}` : '',
        parsed.outputTokens !== undefined ? `output_tokens=${parsed.outputTokens}` : '',
      ].filter(Boolean);
      return {
        result: {
          status: 'error',
          detail: detailParts.join(' '),
          gatewayUrl,
          responseTime,
          timestamp,
          authenticationValidated: true,
          responseSmokeValidated: false,
          streamSmokeValidated: false,
          responseId: parsed.responseId,
          outputTokens: parsed.outputTokens,
          remediation:
            'Gateway accepted stream=true but produced no response.output_text.delta events and no final assistant text. Fix the Responses API streaming adapter before running Kaseki agent traffic through the resolved gateway model.',
        },
        check: {
          name: 'streaming-response',
          status: 'error',
          detail: detailParts.join(' '),
          responseTime,
          responseId: parsed.responseId,
          outputTokens: parsed.outputTokens,
        },
      };
    }

    return {
      result: {
        status: 'ok',
        detail: `streaming-response generated valid deltas (${responseTime}ms)`,
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: true,
        responseSmokeValidated: true,
        streamSmokeValidated: true,
        responseId: parsed.responseId,
        outputTokens: parsed.outputTokens,
      },
      check: {
        name: 'streaming-response',
        status: 'ok',
        detail: 'assistant text deltas returned',
        responseTime,
        responseId: parsed.responseId,
        outputTokens: parsed.outputTokens,
      },
    };
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      result: {
        status: 'error',
        detail: `Gateway streaming smoke test failed: ${errorMessage}`,
        gatewayUrl,
        responseTime,
        timestamp,
        authenticationValidated: false,
        responseSmokeValidated: false,
        streamSmokeValidated: false,
        remediation: 'Cannot complete a stream=true Responses API request with the resolved gateway model. Check gateway health, routing, and SSE adapter behavior.',
      },
      check: { name: 'streaming-response', status: 'error', detail: errorMessage, responseTime },
    };
  }
}
