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
export default function (pi) {
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
}
