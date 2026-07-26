export type GatewayRequest = Record<string, unknown> & {
  input?: unknown;
};

/**
 * Normalize the semantic request body before a gateway transport serializes it.
 * Conversation-shaped input is sent as `messages`; every other input format is
 * preserved exactly as supplied by the caller.
 */
export function normalizeGatewayRequest<T extends GatewayRequest>(request: T): GatewayRequest {
  const { input, ...rest } = request;

  if (
    Array.isArray(input) &&
    input.length > 0 &&
    input.every(item =>
      typeof item === 'object' &&
      item !== null &&
      'role' in item &&
      'content' in item
    )
  ) {
    return { ...rest, messages: input };
  }

  return { ...rest, input };
}
