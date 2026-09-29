/**
 * Pi CLI Custom Extension: CloudFlare AI Workers Gateway Provider
 *
 * Registers a gateway provider configured for CloudFlare's AI Workers gateway.
 * Uses Pi CLI's native OpenAI Responses API which is OpenAI-compatible.
 *
 * Configuration Environment Variables:
 * - LLM_GATEWAY_URL: CloudFlare gateway base URL (required)
 *   Example: https://gateway.ai.cloudflare.com/v1/c40f3cb30efbf8c6d081cf9e50a61931/default/compat
 * - LLM_GATEWAY_API_KEY: CloudFlare API token (optional, prefer file)
 * - LLM_GATEWAY_API_KEY_FILE: Path to file containing CloudFlare API token (default: ~/.kaseki/secrets.json)
 * - LLM_GATEWAY_MODEL: Model to use (optional, defaults to "dynamic/kaseki-agent")
 * - LLM_GATEWAY_MAX_OUTPUT_TOKENS: Max output tokens (optional, defaults to 4096)
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGatewayProviderConfig } from './dist/gateway/create-provider-config.js';

const DEFAULT_GATEWAY_DIAGNOSTICS_PATH = '/results/.gateway-diagnostics.jsonl';

function resolveGatewayDiagnosticsPath() {
  return (
    process.env.KASEKI_GATEWAY_DIAGNOSTICS_PATH ||
    (process.env.KASEKI_RESULTS_DIR
      ? path.join(process.env.KASEKI_RESULTS_DIR, '.gateway-diagnostics.jsonl')
      : DEFAULT_GATEWAY_DIAGNOSTICS_PATH)
  );
}

function recordGatewayDiagnostic(event) {
  const diagnosticsPath = resolveGatewayDiagnosticsPath();
  try {
    fs.mkdirSync(path.dirname(diagnosticsPath), { recursive: true });
    fs.appendFileSync(
      diagnosticsPath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`
    );
  } catch {
    // Diagnostics must never prevent Pi from loading the provider extension.
  }
}

recordGatewayDiagnostic({
  event: 'extension_module_loaded',
  piExtensionsVersion: 'gateway-provider-v1',
});

/**
 * Register CloudFlare gateway provider with Pi CLI
 * @param {object} pi - Pi CLI extension API
 */
export default async function (pi) {
  const config = createGatewayProviderConfig(process.env, fs.readFileSync);

  if (!config) {
    recordGatewayDiagnostic({
      event: 'provider_skipped',
      provider: 'gateway',
      reason: 'missing_llm_gateway_url',
    });
    return;
  }

  pi.registerProvider('gateway', config);
  recordGatewayDiagnostic({
    event: 'provider_registered',
    provider: 'gateway',
    baseUrl: config.baseUrl,
    apiType: 'openai-completions',
    modelId: config.models[0].id,
    resolvedModel: process.env.KASEKI_RESOLVED_MODEL || config.models[0].id,
    hasApiKey: config.apiKey !== '$LLM_GATEWAY_API_KEY',
    requestId: process.env.KASEKI_INFERENCE_REQUEST_ID || undefined,
    phase: process.env.KASEKI_INFERENCE_PHASE || undefined,
    attempt: process.env.KASEKI_INFERENCE_ATTEMPT || undefined,
    payloadLogging: process.env.KASEKI_GATEWAY_LOG_PAYLOADS === '1',
  });

  const cavemanEnabled = process.env.KASEKI_CAVEMAN !== '0';
  const cavemanLevel = Number.parseInt(process.env.KASEKI_CAVEMAN_LEVEL || '2', 10);
  const routerMode = process.env.KASEKI_CAVEMAN_ROUTER || 'jev';
  if (cavemanEnabled && cavemanLevel >= 2 && routerMode === 'jev') {
    try {
      const appRoot = process.env.KASEKI_APP_ROOT || '/app';
      const routerUrl = pathToFileURL(path.join(appRoot, 'dist/caveman/tool-output-router.js')).href;
      const classifierUrl = pathToFileURL(path.join(appRoot, 'dist/jev-classifier.js')).href;
      const keyResolverUrl = pathToFileURL(path.join(appRoot, 'dist/gateway-detection/resolve-openrouter-api-key.js')).href;
      const [router, jev, keyResolver] = await Promise.all([import(routerUrl), import(classifierUrl), import(keyResolverUrl)]);
      if (!keyResolver.resolveOpenRouterApiKey().value) {
        recordGatewayDiagnostic({ event: 'caveman_tool_output_router_skipped', reason: 'decision_credentials_unavailable' });
        return;
      }
      const configuredTimeout = Number.parseInt(process.env.KASEKI_CAVEMAN_ROUTER_TIMEOUT_MS || '1200', 10);
      router.installCavemanToolOutputRouter(pi, (state, questions) =>
        jev.classifyWithJev(state, questions, {
          timeoutMs: Number.isInteger(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 1200,
          maxRetries: 0,
        }),
      );
      recordGatewayDiagnostic({ event: 'caveman_tool_output_router_registered', mode: routerMode, level: cavemanLevel });
    } catch {
      // A missing router must not prevent the gateway provider or Pi from loading.
      recordGatewayDiagnostic({ event: 'caveman_tool_output_router_unavailable' });
    }
  }
}
