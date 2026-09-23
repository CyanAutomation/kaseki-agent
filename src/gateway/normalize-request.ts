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

export interface GatewayHttpErrorDiagnostic {
  event: 'gateway_http_error';
  status: number;
  statusText: string;
  contentType: string | null;
  errorBodyPreview: string;
  errorBodyLength: number;
}

export interface GatewayHandlerErrorDiagnostic {
  event: 'gateway_handler_error';
  reason: 'error';
  errorType: string;
  message: string;
  timestamp: string;
  stackPreview: string;
}

export type GatewayDiagnostic =
  | GatewayRequestDiagnostic
  | GatewayHttpErrorDiagnostic
  | GatewayHandlerErrorDiagnostic;
export type GatewayDiagnosticsSink = (diagnostic: GatewayDiagnostic) => void;

const INPUT_PREVIEW_LIMIT = 256;
const ERROR_BODY_PREVIEW_LIMIT = 256;
const ERROR_STACK_PREVIEW_LIMIT = 1024;

function handlerErrorDiagnostic(error: unknown): GatewayHandlerErrorDiagnostic {
  const normalizedError = error instanceof Error ? error : new Error(String(error));

  return {
    event: 'gateway_handler_error',
    reason: 'error',
    errorType: normalizedError.name || 'Error',
    message: normalizedError.message,
    timestamp: new Date().toISOString(),
    stackPreview: (normalizedError.stack ?? '').slice(0, ERROR_STACK_PREVIEW_LIMIT),
  };
}

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

type GatewayTransportResponse = {
  status: number;
  statusText?: string;
  headers?: { get(name: string): string | null };
  clone?: () => { text(): Promise<string> };
  text?: () => Promise<string>;
};

/** Record a bounded, redacted diagnostic for unsuccessful gateway responses. */
export async function handleGatewayTransportResponse(
  response: unknown,
  diagnosticsSink?: GatewayDiagnosticsSink
): Promise<void> {
  if (!response || typeof response !== 'object' || !('status' in response)) return;

  const gatewayResponse = response as GatewayTransportResponse;
  if (gatewayResponse.status >= 200 && gatewayResponse.status < 300) return;

  const readableResponse = gatewayResponse.clone?.() ?? gatewayResponse;
  let body = '';
  try {
    body = typeof readableResponse.text === 'function' ? await readableResponse.text() : '';
  } catch {
    body = '[Failed to read response body]';
  }
  const redactedBody = redactDiagnosticText(body);

  diagnosticsSink?.({
    event: 'gateway_http_error',
    status: gatewayResponse.status,
    statusText: gatewayResponse.statusText ?? '',
    contentType: gatewayResponse.headers?.get('content-type') ?? null,
    errorBodyPreview: redactedBody.slice(0, ERROR_BODY_PREVIEW_LIMIT),
    errorBodyLength: body.length,
  });
}

function extractLatestUserInput(input: unknown[]): string | undefined {
  const userMessage = [...input].reverse().find(item =>
    typeof item === 'object' &&
    item !== null &&
    'role' in item &&
    item.role === 'user' &&
    'content' in item
  );
  if (!userMessage || !('content' in userMessage)) return undefined;

  if (typeof userMessage.content === 'string') return userMessage.content;
  if (!Array.isArray(userMessage.content)) return undefined;

  return userMessage.content
    .filter(block =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      block.type === 'text' &&
      'text' in block &&
      typeof block.text === 'string'
    )
    .map(block => (block as { text: string }).text)
    .join('');
}

/**
 * Normalize the semantic request body before a gateway transport serializes it.
 * Pi conversations are reduced to the latest user text expected by the gateway;
 * every other input format is preserved exactly as supplied by the caller.
 */
export function normalizeGatewayRequest<T extends GatewayRequest>(request: T): GatewayRequest {
  const { input, ...rest } = request;

  if (Array.isArray(input)) {
    const normalizedInput = extractLatestUserInput(input);
    if (normalizedInput !== undefined) return { ...rest, input: normalizedInput };
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
    let result: TResult;
    try {
      result = transport(normalizedRequest);
    } catch (error) {
      diagnosticsSink?.(handlerErrorDiagnostic(error));
      throw error;
    }
    if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result)
        .then(async response => {
          await handleGatewayTransportResponse(response, diagnosticsSink);
          return response;
        })
        .catch(error => {
          diagnosticsSink?.(handlerErrorDiagnostic(error));
          throw error;
        }) as TResult;
    }
    void handleGatewayTransportResponse(result, diagnosticsSink);
    return result;
  };
}
