import type { QuestionDefinition } from './types/openrouter-decisions';
import {
  DecisionServiceError,
  hasRetiredDecisionSettings,
  requestSenkuDecision,
} from './decision-service/senku-client';
import type { JevClassificationOptions, JevClassificationResult } from './jev-classifier-types';

export { DEFAULT_JEV_MODEL, JevClassificationError } from './jev-classifier-types';
export type { JevClassificationOptions, JevClassificationResult } from './jev-classifier-types';
export { answerConfidence, answerIsFalse, answerIsTrue } from './decision-answers';
export { hasRetiredDecisionSettings };

/**
 * Temporary compatibility shim for dynamic consumers. All inference is sent to
 * Senku; model and retry options are intentionally ignored.
 */
export async function classifyWithJev(
  state: string | Record<string, unknown>,
  questions: Record<string, QuestionDefinition>,
  options: JevClassificationOptions = {},
): Promise<JevClassificationResult> {
  if (hasRetiredDecisionSettings(options.env ?? process.env)) {
    throw new DecisionServiceError('configuration');
  }
  const result = await requestSenkuDecision(state, questions, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    env: options.env,
    signal: options.signal,
  });
  return {
    model: result.model,
    answers: result.answers,
    usage: result.usage ?? {},
    responseTime: result.responseTime,
    attemptCount: result.attemptCount,
  };
}
