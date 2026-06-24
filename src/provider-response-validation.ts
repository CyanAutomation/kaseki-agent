/**
 * Provider Response Validation Module
 *
 * Validates that provider responses are well-formed before they're processed
 * by Pi CLI. This catches issues like:
 * - Empty assistant turns (output_tokens > 0 but no content)
 * - Malformed response structures
 * - Missing required fields
 *
 * Usage in Gateway Adapter:
 * ```typescript
 * const validation = validateProviderResponse(response);
 * if (!validation.valid) {
 *   throw new ValidationError(validation.errors.join('; '));
 * }
 * ```
 */

export interface ProviderMessage {
  role: string;
  content: string | null | undefined;
  tool_calls?: Array<{
    id: string;
    type: string;
    function?: { name: string; arguments: string };
  }>;
  provider?: string;
  api?: string;
  model?: string;
  response_id?: string;
  stopReason?: string;
}

export interface ProviderUsage {
  input_tokens?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ProviderResponse {
  message: ProviderMessage;
  usage?: ProviderUsage;
  response_id?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a provider response for well-formedness
 *
 * Critical Checks:
 * 1. Response must have a message object
 * 2. If output_tokens > 0 and role=assistant, content OR tool_calls must exist
 * 3. Content, if present, should not be empty when tokens are claimed
 *
 * @param response The provider response to validate
 * @returns Validation result with errors and warnings
 */
export function validateProviderResponse(response: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check basic structure
  if (!response || typeof response !== 'object') {
    errors.push('Response is not an object');
    return { valid: false, errors, warnings };
  }

  const typedResponse = response as any;
  const message = typedResponse.message;

  if (!message || typeof message !== 'object') {
    errors.push('Response does not contain a message object');
    return { valid: false, errors, warnings };
  }

  // Extract usage metrics
  const usage = typedResponse.usage || {};
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;

  // Check for the kaseki-170 bug: output tokens claimed but no content
  if (outputTokens > 0 && message.role === 'assistant') {
    const hasTextContent =
      message.content && typeof message.content === 'string' && message.content.trim().length > 0;
    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;

    if (!hasTextContent && !hasToolCalls) {
      const responseId = typedResponse.response_id ?? message.response_id ?? 'unknown';
      const details = [
        `input_tokens=${inputTokens}`,
        `output_tokens=${outputTokens}`,
        `response_id=${responseId}`,
      ].join(', ');

      errors.push(
        `Output tokens (${outputTokens}) claimed but no assistant content or tool calls present. ` +
          `This indicates a provider/adapter bug. ${details}`
      );
    }
  }

  // Warning for zero output tokens with assistant role
  if (outputTokens === 0 && message.role === 'assistant') {
    warnings.push('Assistant message has zero output tokens; may indicate a provider issue');
  }

  // Warning for legacy GitHub secret mount paths
  if (message.provider === 'gateway' && message.api === 'openai-responses') {
    // This is informational; not an error
    if (!hasRecentSecretWarning()) {
      // Only warn once per session to avoid log spam
      warnings.push(
        'Gateway using openai-responses adapter; ensure manifest.scheimann.xyz is responsive'
      );
      recordSecretWarning();
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Extract diagnostic information from an empty assistant turn
 * Useful for debugging provider issues
 */
export function extractEmptyAssistantDiagnostics(response: ProviderResponse): {
  provider?: string;
  api?: string;
  model?: string;
  responseId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  description: string;
} {
  const message = response.message;
  const usage = response.usage || {};
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? 0;

  const description =
    `Empty assistant turn detected: ${outputTokens} output tokens claimed ` +
    'but no assistant text or tool calls present. ' +
    `Input: ${inputTokens}, Total: ${totalTokens} tokens. ` +
    `Provider: ${message.provider}, API: ${message.api}, Model: ${message.model}`;

  return {
    provider: message.provider,
    api: message.api,
    model: message.model,
    responseId: response.response_id ?? message.response_id,
    inputTokens,
    outputTokens,
    totalTokens,
    description,
  };
}

/**
 * Check if a message is considered empty (no valid content)
 */
export function isEmptyAssistantMessage(message: ProviderMessage, outputTokens: number = 0): boolean {
  if (message.role !== 'assistant') return false;

  const hasTextContent =
    message.content && typeof message.content === 'string' && message.content.trim().length > 0;
  const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;

  if (outputTokens > 0) {
    return !hasTextContent && !hasToolCalls;
  }

  return !hasTextContent && !hasToolCalls;
}

/**
 * Simple warning deduplication to avoid log spam
 */
let lastSecretWarningTime = 0;
function hasRecentSecretWarning(): boolean {
  return Date.now() - lastSecretWarningTime < 60000; // 60 second cooldown
}
function recordSecretWarning(): void {
  lastSecretWarningTime = Date.now();
}
