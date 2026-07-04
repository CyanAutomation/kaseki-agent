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

    const fragments: string[] = [];
    const add = (value: unknown) => {
      if (typeof value === 'string' && value.length > 0 && !fragments.includes(value)) fragments.push(value);
    };

    // Pi may expose the same assistant snapshot through several compatibility
    // fields. Collect first so one event contributes the text only once.
    add(message.text);
    add(message.output_text);
    add(message.assistantMessage);

    // Chat Completions API: standard format with choices
    if (Array.isArray(message.choices) && message.choices.length > 0) {
      const choice = message.choices[0];
      // Standard message format
      if (typeof choice?.message?.content === 'string') {
        add(choice.message.content);
      }
      // Streaming delta format
      if (typeof choice?.delta?.content === 'string') {
        add(choice.delta.content);
      }
    }

    // Direct delta field (streaming format without choices wrapper)
    if (typeof message.delta?.content === 'string') {
      add(message.delta.content);
    }

    // Direct content field (Cloudflare and other variants)
    if (typeof message.content === 'string') {
      add(message.content);
    }

    // Content as array of parts (Pi format)
    if (Array.isArray(message.content)) {
      let contentParts = '';
      for (const part of message.content) {
        if (typeof part?.text === 'string') contentParts += part.text;
        else if (typeof part?.output_text === 'string') contentParts += part.output_text;
        // Support content objects with direct content field
        else if (typeof part?.content === 'string') contentParts += part.content;
      }
      add(contentParts);
    }

    // Response wrapper (some gateway implementations)
    if (typeof message.response?.content === 'string') {
      add(message.response.content);
    }

    // Prefer the richest representation in an event. Pi JSON mode can emit
    // cumulative assistant snapshots ("{", then "{\"status\"", ...), while
    // gateway adapters can emit true deltas. Replace on a cumulative snapshot,
    // ignore stale/repeated snapshots, and append only independent deltas.
    const fragment = fragments.sort((a, b) => b.length - a.length)[0];
    if (!fragment) continue;
    if (fragment.startsWith(text)) {
      text = fragment;
    } else if (!text.startsWith(fragment)) {
      text += fragment;
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
