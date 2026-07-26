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
    const event = parseJsonLine(line);
    if (!event) continue;

    const message = event?.message;
    if (!message || message.role !== 'assistant') continue;

    // Prefer the richest representation in an event. Pi JSON mode can emit
    // cumulative assistant snapshots ("{", then "{\"status\"", ...), while
    // gateway adapters can emit true deltas. Replace on a cumulative snapshot,
    // ignore stale/repeated snapshots, and append only independent deltas.
    text = mergeAssistantFragment(text, richestFragment(collectAssistantTextFragments(message)));
  }
  return text;
}

function parseJsonLine(line: string): any | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function collectAssistantTextFragments(message: any): string[] {
  const fragments: string[] = [];
  const add = (value: unknown) => addUniqueTextFragment(fragments, value);

  add(message.text);
  add(message.output_text);
  add(message.assistantMessage);
  addChoiceContentFragments(message, add);
  add(message.delta?.content);
  add(typeof message.content === 'string' ? message.content : undefined);
  add(contentArrayText(message.content));
  add(message.response?.content);

  return fragments;
}

function addUniqueTextFragment(fragments: string[], value: unknown): void {
  if (typeof value === 'string' && value.length > 0 && !fragments.includes(value)) {
    fragments.push(value);
  }
}

function addChoiceContentFragments(message: any, add: (value: unknown) => void): void {
  if (!Array.isArray(message.choices) || message.choices.length === 0) return;
  const choice = message.choices[0];
  add(choice?.message?.content);
  add(choice?.delta?.content);
}

function contentArrayText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;

  let contentParts = '';
  for (const part of content) {
    if (typeof part?.text === 'string') contentParts += part.text;
    else if (typeof part?.output_text === 'string') contentParts += part.output_text;
    else if (typeof part?.content === 'string') contentParts += part.content;
  }
  return contentParts;
}

function richestFragment(fragments: string[]): string | undefined {
  return fragments.sort((a, b) => b.length - a.length)[0];
}

function mergeAssistantFragment(text: string, fragment: string | undefined): string {
  if (!fragment) return text;
  if (fragment.startsWith(text)) return fragment;
  return text.startsWith(fragment) ? text : text + fragment;
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
