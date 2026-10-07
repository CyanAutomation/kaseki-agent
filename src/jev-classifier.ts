import type { ClassificationAnswer, DecisionsApiRequest, QuestionDefinition } from './types/openrouter-decisions';
import { resolveOpenRouterApiKey } from './gateway-detection/resolve-openrouter-api-key';
import { parseResponse } from './jev-classifier-response';
import { redactJevEvidence } from './jev-evidence-redaction';
export { answerConfidence, answerIsFalse, answerIsTrue } from './decision-answers';

export const DEFAULT_JEV_MODEL = '~typesafe/jev-latest';
export const JEV_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export interface JevClassificationOptions { model?: string; timeoutMs?: number; fetchImpl?: typeof fetch; maxRetries?: number; }
export interface JevClassificationResult { model: string; answers: Record<string, ClassificationAnswer>; usage: Record<string, unknown>; responseTime: number; attemptCount: number; }
export class JevClassificationError extends Error {
  readonly code: 'configuration' | 'credentials' | 'timeout' | 'http' | 'invalid_response' | 'network'; readonly status?: number; readonly requestId?: string; attemptCount?: number;
  constructor(code: JevClassificationError['code'], message: string, status?: number, requestId?: string) { super(message); this.name = 'JevClassificationError'; this.code = code; this.status = status; this.requestId = requestId; }
}

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
  const value = response.headers.get('x-request-id') || response.headers.get('request-id');
  return value && /^[A-Za-z0-9._:/-]{1,128}$/.test(value) ? value : undefined;
}

function timeoutMs(value: number | undefined): number { return Number.isInteger(value) && value && value > 0 ? value : 15000; }
function retryable(error: JevClassificationError): boolean {
  return error.code === 'timeout' || error.code === 'network' || error.code === 'invalid_response' || error.status === 429 || error.status === 503 || error.status === 529;
}
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizeClassificationError(error: unknown, timeout: number): JevClassificationError {
  if (error instanceof JevClassificationError) return error;
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    return new JevClassificationError('timeout', `OpenRouter decision endpoint request timed out after ${timeout}ms`);
  }
  return new JevClassificationError(
    'network',
    `Could not reach the OpenRouter decision endpoint: ${error instanceof Error ? error.message : String(error)}`,
  );
}

async function requestClassificationAttempt(
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

const RETIRED_DECISION_SETTINGS = [
  'KASEKI_JEV_WORKFLOW',
  'KASEKI_JEV_CONFIDENCE',
  'KASEKI_JEV_GOAL_CHECK_TIMEOUT_MS',
  'KASEKI_JEV_RUN_EVALUATION_TIMEOUT_MS',
  'KASEKI_JEV_WORKFLOW_EVALUATOR',
  'KASEKI_CLASSIFICATION_MODEL',
  'KASEKI_JEV_API_KEY_FILE',
  'KASEKI_JEV_TASK_TYPE',
  'KASEKI_JEV_VALIDATION_FOCUS',
] as const;

export function hasRetiredDecisionSettings(): boolean {
  return RETIRED_DECISION_SETTINGS.some((name) => process.env[name] !== undefined);
}

export async function classifyWithJev(state: string | Record<string, unknown>, questions: Record<string, QuestionDefinition>, options: JevClassificationOptions = {}): Promise<JevClassificationResult> {
  if (hasRetiredDecisionSettings()) {
    throw new JevClassificationError('configuration', 'Retired evaluation settings are configured. Remove them and use the stage-based settings documented in docs/ENV_VARS.md.');
  }
  const credentials = resolveOpenRouterApiKey();
  if (!credentials.value) throw new JevClassificationError('credentials', 'OPENROUTER_API_KEY is not configured');
  const model = options.model || process.env.KASEKI_DECISION_MODEL || DEFAULT_JEV_MODEL;
  const request: DecisionsApiRequest = { model, state, questions };
  const started = performance.now();
  const retries = options.maxRetries ?? 2;
  const timeout = timeoutMs(options.timeoutMs);
  const credentialsValue = credentials.value;
  let lastError: JevClassificationError | undefined;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestClassificationAttempt(request, options, timeout, started, attempt, credentialsValue);
    } catch (error) {
      lastError = normalizeClassificationError(error, timeout);
      lastError.attemptCount = attempt + 1;
      if (attempt === retries || !retryable(lastError)) throw lastError;
      await wait(100 * 2 ** attempt);
    }
  }
  throw lastError || new JevClassificationError('network', 'evaluation request failed');
}
