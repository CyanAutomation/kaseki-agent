import type { ClassificationAnswer, DecisionsApiRequest, DecisionsApiResponse, QuestionDefinition } from './types/openrouter-decisions';
import { resolveOpenRouterApiKey } from './gateway-detection/resolve-openrouter-api-key';

export const DEFAULT_JEV_MODEL = '~typesafe/jev-latest';
export const JEV_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

export interface JevClassificationOptions {
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface JevClassificationResult {
  model: string;
  answers: Record<string, ClassificationAnswer>;
  usage: Record<string, unknown>;
  responseTime: number;
}

export class JevClassificationError extends Error {
  readonly code: 'credentials' | 'timeout' | 'http' | 'invalid_response' | 'network';
  readonly status?: number;

  constructor(code: JevClassificationError['code'], message: string, status?: number) {
    super(message);
    this.name = 'JevClassificationError';
    this.code = code;
    this.status = status;
  }
}

function timeoutMs(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? value : 5000;
}

function parseResponse(value: unknown): JevClassificationResult | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Partial<DecisionsApiResponse>;
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return null;
  const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {};
  return {
    model: typeof body.model === 'string' ? body.model : DEFAULT_JEV_MODEL,
    answers: body.answers as Record<string, ClassificationAnswer>,
    usage,
    responseTime: 0,
  };
}

export async function classifyWithJev(
  state: string | Record<string, unknown>,
  questions: Record<string, QuestionDefinition>,
  options: JevClassificationOptions = {},
): Promise<JevClassificationResult> {
  const credentials = resolveOpenRouterApiKey();
  if (!credentials.value) throw new JevClassificationError('credentials', 'OPENROUTER_API_KEY is not configured');
  const model = options.model || process.env.KASEKI_CLASSIFICATION_MODEL || DEFAULT_JEV_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(options.timeoutMs));
  const started = performance.now();
  const request: DecisionsApiRequest = { model, state, questions };
  try {
    const response = await (options.fetchImpl || fetch)(JEV_DECISIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.value}` },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) throw new JevClassificationError('http', `classifier returned HTTP ${response.status}`, response.status);
    const parsed = parseResponse(await response.json());
    if (!parsed) throw new JevClassificationError('invalid_response', 'classifier response did not contain answers');
    parsed.model = parsed.model || model;
    parsed.responseTime = Math.round(performance.now() - started);
    return parsed;
  } catch (error) {
    if (error instanceof JevClassificationError) throw error;
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw new JevClassificationError('timeout', `classifier timed out after ${timeoutMs(options.timeoutMs)}ms`);
    }
    throw new JevClassificationError('network', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function answerConfidence(answer: { confidence?: unknown } | undefined): number {
  return typeof answer?.confidence === 'number' && Number.isFinite(answer.confidence) ? answer.confidence : 0;
}

export function answerIsTrue(answer: { answer?: unknown } | undefined): boolean {
  return answer?.answer === true || answer?.answer === 'yes';
}
