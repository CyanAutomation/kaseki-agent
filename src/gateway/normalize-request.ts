export type GatewayRequest = Record<string, unknown> & {
  input?: unknown;
};

export type GatewayTransportRequest = Record<string, unknown> & {
  url: string;
  body?: unknown;
  headers?: unknown;
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

/**
 * Apply request-body normalization at the transport boundary. Requests for
 * other gateway endpoints must pass through without changing their transport
 * arguments, even when their body happens to resemble a Responses payload.
 */
export function normalizeGatewayTransportRequest<T extends GatewayTransportRequest>(
  request: T
): GatewayTransportRequest {
  if (!/\/responses(?:[/?#]|$)/.test(request.url)) return request;

  if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) {
    try {
      const body = JSON.parse(request.body.toString()) as GatewayRequest;
      const normalizedBody = JSON.stringify(normalizeGatewayRequest(body));

      return {
        ...request,
        body: Buffer.isBuffer(request.body)
          ? Buffer.from(normalizedBody, 'utf8')
          : normalizedBody,
      };
    } catch {
      return request;
    }
  }

  if (request.body && typeof request.body === 'object') {
    return { ...request, body: normalizeGatewayRequest(request.body as GatewayRequest) };
  }

  return request;
}

/** Wrap an Undici dispatch/fetch-style transport with gateway normalization. */
export function createNormalizedGatewayTransport<TResult>(
  transport: (request: GatewayTransportRequest) => TResult
): (request: GatewayTransportRequest) => TResult {
  return request => transport(normalizeGatewayTransportRequest(request));
}
