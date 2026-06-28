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
 * Resolve CloudFlare API key from environment or file
 * Prefers environment variable, falls back to file
 * @returns {string} API key or empty string if not configured
 */
function resolveGatewayApiKey() {
  if (process.env.LLM_GATEWAY_API_KEY) {
    return process.env.LLM_GATEWAY_API_KEY;
  }

  const filePath = process.env.LLM_GATEWAY_API_KEY_FILE || '~/.kaseki/secrets.json';
  if (filePath) {
    try {
      const expandedPath = filePath.startsWith('~')
        ? filePath.replace('~', process.env.HOME || '')
        : filePath;
      const value = fs.readFileSync(expandedPath, 'utf8').trim();
      if (value) return value;
    } catch {
      // Extension initialization will surface the failure
    }
  }

  return '';
}

/**
 * Resolve max output tokens from environment
 * @returns {number} Max tokens (default: 4096)
 */
function resolveGatewayMaxTokens() {
  const raw = process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS;
  if (!raw) return 4096;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4096;
}

/**
 * Register CloudFlare gateway provider with Pi CLI
 * @param {object} pi - Pi CLI extension API
 */
export default function (pi) {
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const gatewayApiKey = resolveGatewayApiKey();
  const maxTokens = resolveGatewayMaxTokens();
  const model = process.env.LLM_GATEWAY_MODEL || 'dynamic/kaseki-agent';

  if (!gatewayUrl) {
    recordGatewayDiagnostic({
      event: 'provider_skipped',
      provider: 'gateway',
      reason: 'missing_llm_gateway_url',
    });
    return;
  }

  pi.registerProvider('gateway', {
      name: 'LLM Gateway (CloudFlare)',
      baseUrl: gatewayUrl,
      apiKey: gatewayApiKey || '$LLM_GATEWAY_API_KEY',
      api: 'openai-responses', // Pi's native OpenAI-compatible API support
      models: [
        {
          id: model,
          name: `CloudFlare Gateway (${model})`,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens,
        },
      ],
    });
    recordGatewayDiagnostic({
      event: 'provider_registered',
      provider: 'gateway',
      baseUrl: gatewayUrl,
      apiType: 'openai-responses',
      modelId: model,
      hasApiKey: Boolean(gatewayApiKey),
    });
  }
}
