const MAX_SOYUZ_RESPONSE_BYTES = 128 * 1024;

export class SoyuzApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SoyuzApiError';
  }
}

export async function readSoyuzResponseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOYUZ_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Soyuz response exceeded the 128 KB client limit');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SOYUZ_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Soyuz response exceeded the 128 KB client limit');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

export async function readSoyuzResponseData<T>(
  response: Response,
  allowArrayData = false,
): Promise<T> {
  const text = await readSoyuzResponseText(response);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Soyuz returned invalid JSON (${response.status})`);
  }

  if (!response.ok) {
    const error = parsed.error && typeof parsed.error === 'object'
      ? parsed.error as Record<string, unknown>
      : {};
    throw new SoyuzApiError(
      response.status,
      typeof error.code === 'string' ? error.code : 'SOYUZ_REQUEST_FAILED',
      typeof error.message === 'string' ? error.message : `Soyuz request failed (${response.status})`,
      error.details,
    );
  }

  const data = parsed.data;
  if (data === null || typeof data !== 'object' || (!allowArrayData && Array.isArray(data))) {
    throw new Error('Soyuz response did not contain a data object');
  }
  return data as T;
}
