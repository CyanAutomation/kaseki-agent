import type { DecisionsApiRequest } from './types/openrouter-decisions';
import { parseResponse } from './jev-classifier-response';
import { redactJevEvidence } from './jev-evidence-redaction';
import {
  DEFAULT_JEV_MODEL,
  JEV_DECISIONS_URL,
  JevClassificationError,
  type JevClassificationOptions,
  type JevClassificationResult,
} from './jev-classifier-types';

const MAX_PROVIDER_DIAGNOSTIC_LENGTH = 500;

function extractProviderErrorDetail(body: string): string | undefined {
  if (!body || body.length > 64 * 1024) return undefined;
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return undefined; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const root = payload as Record<string, unknown>;
  const error = root.error;
  const providerError = error && typeof error === 'object' && !Array.isArray(error)
    ? error as Record<string, unknown>
    : undefined;
  const fields = ['code', 'type', 'message', 'detail'] as const;
  const parts = fields.flatMap((field) => {
    const value = providerError?.[field] ?? (field === 'message' && !providerError ? error : undefined);
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    const redacted = String(redactJevEvidence(String(value)));
    const safe = Array.from(redacted, (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    }).join('').replace(/\s+/g, ' ').trim();
    return safe ? [safe.slice(0, MAX_PROVIDER_DIAGNOSTIC_LENGTH)] : [];
  });
  return parts.length > 0 ? parts.join(': ').slice(0, MAX_PROVIDER_DIAGNOSTIC_LENGTH) : undefined;
}

function providerRequestId(response: Response): string | undefined {
  const headers = response.headers;
  if (!headers || typeof headers.get !== 'function') return undefined;
  let value: string | null;
  try { value = headers.get('x-request-id') || headers.get('request-id'); } catch { return undefined; }
  return value && /^[A-Za-z0-9._:/-]{1,128}$/.test(value) ? value : undefined;
}

export function normalizeClassificationError(error: unknown, timeout: number): JevClassificationError {
  if (error instanceof JevClassificationError) return error;
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    return new JevClassificationError('timeout', `OpenRouter decision endpoint request timed out after ${timeout}ms`);
  }
  return new JevClassificationError(
    'network',
    `Could not reach the OpenRouter decision endpoint: ${error instanceof Error ? error.message : String(error)}`,
  );
}

export async function requestClassificationAttempt(
  request: DecisionsApiRequest,
  options: JevClassificationOptions,
  timeout: number,
  started: number,
  attempt: number,
  credentialsValue: string,
): Promise<JevClassificationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await (options.fetchImpl || fetch)(JEV_DECISIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentialsValue}` },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      let body = '';
      try { body = await response.text(); } catch { /* retain the HTTP failure even if its body cannot be read */ }
      const requestId = providerRequestId(response);
      const providerDetail = extractProviderErrorDetail(body);
      const baseMessage = response.status === 401 || response.status === 403
        ? `OpenRouter rejected the evaluation API key (HTTP ${response.status}); it may be invalid, expired, revoked, or missing access to the decisions endpoint.`
        : `OpenRouter decision endpoint returned HTTP ${response.status}`;
      const diagnostics = [requestId ? `request_id=${requestId}` : undefined, providerDetail].filter(Boolean).join('; ');
      throw new JevClassificationError('http', diagnostics ? `${baseMessage}; ${diagnostics}` : baseMessage, response.status, requestId);
    }
    const parsed = parseResponse(await response.json(), request.questions, DEFAULT_JEV_MODEL);
    if (!parsed) throw new JevClassificationError('invalid_response', 'evaluation response did not match the requested typed answer format');
    parsed.responseTime = Math.round(performance.now() - started);
    parsed.attemptCount = attempt + 1;
    return parsed;
  } catch (error) {
    const normalized = normalizeClassificationError(error, timeout);
    normalized.attemptCount = attempt + 1;
    throw normalized;
  } finally {
    clearTimeout(timer);
  }
}
