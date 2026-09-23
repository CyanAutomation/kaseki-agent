export type GatewayRequest = Record<string, unknown> & {
  input?: unknown;
};

export type GatewayTransportRequest = Record<string, unknown> & {
  url: string;
  body?: unknown;
  headers?: unknown;
};

export interface GatewayRequestDiagnostic {
  event: 'request_payload';
  model: unknown;
  inputLength: number;
  inputPreview: string;
  inputPreviewTruncated: boolean;
  store: unknown;
  requestBodySize: number;
  validJsonFormat: boolean;
}

export type GatewayDiagnosticsSink = (diagnostic: GatewayRequestDiagnostic) => void;

const INPUT_PREVIEW_LIMIT = 256;

function redactDiagnosticText(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(
      /((?:["']?)(?:api[_-]?key|authorization|password|secret|token)(?:["']?)\s*:\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi,
      (_match, prefix: string, quotedValue: string) =>
        `${prefix}${quotedValue[0]}[REDACTED]${quotedValue[0]}`
    )
    .replace(
      /\b(api[_-]?key|authorization|password|secret|token)\b(\s*=\s*)[^\r\n;]+/gi,
      '$1$2[REDACTED]'
    )
    .replace(
      /\b(api[_-]?key|authorization|password|secret|token)\b(\s*[:=]\s*)([^\s,;"']+)/gi,
      '$1$2[REDACTED]'
    );
}

function requestDiagnostic(request: GatewayTransportRequest): GatewayRequestDiagnostic {
  let body: GatewayRequest | undefined;
  let validJsonFormat = false;

  if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) {
    try {
      body = JSON.parse(request.body.toString()) as GatewayRequest;
      validJsonFormat = true;
    } catch {
      body = undefined;
    }
  } else if (request.body && typeof request.body === 'object') {
    body = request.body as GatewayRequest;
    validJsonFormat = true;
  }

  const input = body?.input ?? body?.messages;
  const inputText = typeof input === 'string' ? input : input === undefined ? '' : JSON.stringify(input);
  const redactedInput = redactDiagnosticText(inputText);
  const serializedBody = typeof request.body === 'string' || Buffer.isBuffer(request.body)
    ? request.body
    : request.body !== undefined ? JSON.stringify(request.body) : '';

  return {
    event: 'request_payload',
    model: body?.model,
    inputLength: inputText.length,
    inputPreview: redactedInput.slice(0, INPUT_PREVIEW_LIMIT),
    inputPreviewTruncated: redactedInput.length > INPUT_PREVIEW_LIMIT,
    store: body?.store,
    requestBodySize: Buffer.byteLength(serializedBody),
    validJsonFormat,
  };
}

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
  transport: (request: GatewayTransportRequest) => TResult,
  diagnosticsSink?: GatewayDiagnosticsSink
): (request: GatewayTransportRequest) => TResult {
  return request => {
    const normalizedRequest = normalizeGatewayTransportRequest(request);
    diagnosticsSink?.(requestDiagnostic(normalizedRequest));
    return transport(normalizedRequest);
  };
}
