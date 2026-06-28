/**
 * Pi JSON Extraction & Formatting
 *
 * Handles extraction of assistant text from Pi provider JSONL output,
 * supporting multiple response formats from different gateways and providers.
 */

/**
 * Extract assistant text from Pi provider JSONL output
 * Supports multiple response formats:
 * - Legacy Pi formats: message.text, message.output_text, message.assistantMessage
 * - Chat Completions: choices[0].message.content, choices[0].delta.content
 * - Direct content: message.content (string or array)
 * - Response wrapper: message.response.content
 * - Cloudflare variants: direct string content field
 */
export function extractPiJsonAssistantText(stdout: string): string {
  let text = '';
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const message = event?.message;
    if (!message || message.role !== 'assistant') continue;

    // Legacy Pi formats
    if (typeof message.text === 'string') text += message.text;
    if (typeof message.output_text === 'string') text += message.output_text;
    if (typeof message.assistantMessage === 'string') text += message.assistantMessage;

    // Chat Completions API: standard format with choices
    if (Array.isArray(message.choices) && message.choices.length > 0) {
      const choice = message.choices[0];
      // Standard message format
      if (typeof choice?.message?.content === 'string') {
        text += choice.message.content;
      }
      // Streaming delta format
      if (typeof choice?.delta?.content === 'string') {
        text += choice.delta.content;
      }
    }

    // Direct delta field (streaming format without choices wrapper)
    if (typeof message.delta?.content === 'string') {
      text += message.delta.content;
    }

    // Direct content field (Cloudflare and other variants)
    if (typeof message.content === 'string') {
      text += message.content;
    }

    // Content as array of parts (Pi format)
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (typeof part?.text === 'string') text += part.text;
        if (typeof part?.output_text === 'string') text += part.output_text;
        // Support content objects with direct content field
        if (typeof part?.content === 'string') text += part.content;
      }
    }

    // Response wrapper (some gateway implementations)
    if (typeof message.response?.content === 'string') {
      text += message.response.content;
    }
  }
  return text;
}

/**
 * Export test result for use in API routes
 */
export function formatGatewayTestResponse(result: any): object {
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
    streamSmokeValidated: result.streamSmokeValidated,
    largePromptSmokeValidated: result.largePromptSmokeValidated,
    checks: result.checks,
  };
}

/**
 * Fetch with timeout
 */
export async function fetchWithTimeout(
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
