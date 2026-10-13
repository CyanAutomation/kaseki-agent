import type { QuestionDefinition } from './types/openrouter-decisions';
import { resolveOpenRouterApiKey } from './gateway-detection/resolve-openrouter-api-key';
import { normalizeClassificationError, requestClassificationAttempt } from './jev-classifier-request';
import {
  DEFAULT_JEV_MODEL,
  JevClassificationError,
  type JevClassificationOptions,
  type JevClassificationResult,
} from './jev-classifier-types';

export { DEFAULT_JEV_MODEL, JEV_DECISIONS_URL, JevClassificationError } from './jev-classifier-types';
export type { JevClassificationOptions, JevClassificationResult } from './jev-classifier-types';
export { answerConfidence, answerIsFalse, answerIsTrue } from './decision-answers';

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

function timeoutMs(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? value : 15000;
}

function retryable(error: JevClassificationError): boolean {
  return error.code === 'timeout' || error.code === 'network' || error.code === 'invalid_response'
    || error.status === 429 || error.status === 503 || error.status === 529;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function classifyWithJev(
  state: string | Record<string, unknown>,
  questions: Record<string, QuestionDefinition>,
  options: JevClassificationOptions = {},
): Promise<JevClassificationResult> {
  if (hasRetiredDecisionSettings()) {
    throw new JevClassificationError('configuration', 'Retired evaluation settings are configured. Remove them and use the stage-based settings documented in docs/ENV_VARS.md.');
  }
  const credentials = resolveOpenRouterApiKey();
  if (!credentials.value) throw new JevClassificationError('credentials', 'OPENROUTER_API_KEY is not configured');
  const model = options.model || process.env.KASEKI_DECISION_MODEL || DEFAULT_JEV_MODEL;
  const request = { model, state, questions };
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
