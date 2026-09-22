import type { ClassificationAnswer, DecisionsApiRequest, DecisionsApiResponse, QuestionDefinition } from './types/openrouter-decisions';
import { resolveOpenRouterApiKey } from './gateway-detection/resolve-openrouter-api-key';

export const DEFAULT_JEV_MODEL = '~typesafe/jev-latest';
export const JEV_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export interface JevClassificationOptions { model?: string; timeoutMs?: number; fetchImpl?: typeof fetch; maxRetries?: number; }
export interface JevClassificationResult { model: string; answers: Record<string, ClassificationAnswer>; usage: Record<string, unknown>; responseTime: number; }
export class JevClassificationError extends Error {
  readonly code: 'credentials' | 'timeout' | 'http' | 'invalid_response' | 'network'; readonly status?: number;
  constructor(code: JevClassificationError['code'], message: string, status?: number) { super(message); this.name = 'JevClassificationError'; this.code = code; this.status = status; }
}

function timeoutMs(value: number | undefined): number { return Number.isInteger(value) && value && value > 0 ? value : 5000; }
function isProbability(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function isDistribution(value: unknown): value is Record<string, number> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.values(value as Record<string, unknown>).every(isProbability); }
function validAnswer(question: QuestionDefinition, answer: unknown): answer is ClassificationAnswer {
  if (!answer || typeof answer !== 'object') return false;
  const value = answer as Record<string, unknown>;
  if (question.type === 'noul') return value.type === 'noul' && isProbability(value.noul);
  if (question.type === 'choice') return value.type === 'choice' && typeof value.choice === 'string' && Object.hasOwn(question.criteria, value.choice) && isDistribution(value.probabilities) && isProbability(value.confidence);
  return value.type === 'score' && typeof value.score === 'number' && Number.isFinite(value.score) && isDistribution(value.probabilities) && isProbability(value.confidence) && value.legend !== null && typeof value.legend === 'object';
}
function parseResponse(value: unknown, questions: Record<string, QuestionDefinition>): JevClassificationResult | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Partial<DecisionsApiResponse>;
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return null;
  const ids = Object.keys(questions);
  if (Object.keys(body.answers).length !== ids.length || !ids.every((id) => body.answers![id] && validAnswer(questions[id], body.answers![id]))) return null;
  return { model: typeof body.model === 'string' ? body.model : DEFAULT_JEV_MODEL, answers: body.answers, usage: body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {}, responseTime: 0 };
}
function retryable(status: number | undefined): boolean { return status === 429 || status === 503 || status === 529; }
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export async function classifyWithJev(state: string | Record<string, unknown>, questions: Record<string, QuestionDefinition>, options: JevClassificationOptions = {}): Promise<JevClassificationResult> {
  const credentials = resolveOpenRouterApiKey();
  if (!credentials.value) throw new JevClassificationError('credentials', 'OPENROUTER_API_KEY is not configured');
  const model = options.model || process.env.KASEKI_CLASSIFICATION_MODEL || DEFAULT_JEV_MODEL;
  const request: DecisionsApiRequest = { model, state, questions };
  const started = performance.now(); const retries = options.maxRetries ?? 2;
  let lastError: JevClassificationError | undefined;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs(options.timeoutMs));
    try {
      const response = await (options.fetchImpl || fetch)(JEV_DECISIONS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.value}` }, body: JSON.stringify(request), signal: controller.signal });
      if (!response.ok) throw new JevClassificationError('http', `classifier returned HTTP ${response.status}`, response.status);
      const parsed = parseResponse(await response.json(), questions);
      if (!parsed) throw new JevClassificationError('invalid_response', 'classifier response did not match requested JEV answer types');
      parsed.responseTime = Math.round(performance.now() - started); return parsed;
    } catch (error) {
      lastError = error instanceof JevClassificationError ? error : error && typeof error === 'object' && 'name' in error && error.name === 'AbortError' ? new JevClassificationError('timeout', `classifier timed out after ${timeoutMs(options.timeoutMs)}ms`) : new JevClassificationError('network', error instanceof Error ? error.message : String(error));
      if (attempt === retries || !retryable(lastError.status)) throw lastError;
      await wait(100 * 2 ** attempt);
    } finally { clearTimeout(timer); }
  }
  throw lastError || new JevClassificationError('network', 'classifier failed');
}

export function answerConfidence(answer: ClassificationAnswer | undefined): number { return answer?.type === 'choice' || answer?.type === 'score' ? answer.confidence : 0; }
export function answerIsTrue(answer: ClassificationAnswer | undefined, threshold = 0.8): boolean { return answer?.type === 'noul' && answer.noul >= threshold; }
export function answerIsFalse(answer: ClassificationAnswer | undefined, threshold = 0.2): boolean { return answer?.type === 'noul' && answer.noul <= threshold; }
