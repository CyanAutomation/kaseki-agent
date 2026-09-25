import type { ClassificationAnswer, ClassificationValidationResult } from '../types/openrouter-decisions';

/**
 * Validates confidence thresholds for kaseki-agent classification tests.
 *
 * Used by the evaluationSmoke test to ensure that all classification answers
 * meet a minimum confidence threshold (default 0.75). This prevents low-confidence
 * decisions from being used for code review routing or triage decisions.
 *
 * Usage:
 * ```typescript
 * const answers = {
 *   code_quality_issue: { confidence: 0.85 },
 *   requires_human_review: { confidence: 0.70 }
 * };
 *
 * const result = validateClassificationConfidence(answers);
 * // result.isValid === false
 * // result.failedQuestions === ["requires_human_review"]
 * // result.messages contains detailed failure info
 * ```
 */
export function validateClassificationConfidence(
  answers: Record<string, ClassificationAnswer>,
  minConfidence: number = 0.75,
): ClassificationValidationResult {
  if (Object.keys(answers).length === 0) {
    return {
      isValid: true,
      failedQuestions: [],
      messages: [],
    };
  }

  const failedQuestions: string[] = [];
  const messages: string[] = [];

  for (const [question, answer] of Object.entries(answers)) {
    const confidence = answer?.type === 'noul'
      ? Math.max(answer.noul, 1 - answer.noul)
      : answer?.confidence;

    const isValidConfidence =
      typeof confidence === 'number' &&
      Number.isFinite(confidence) &&
      confidence >= minConfidence;

    if (!isValidConfidence) {
      failedQuestions.push(question);

      const confidenceValue =
        confidence === undefined ? 'undefined' : confidence.toFixed(2);

      messages.push(
        `${question} failed confidence validation: confidence ${confidenceValue} < required ${minConfidence.toFixed(2)}`,
      );
    }
  }

  return {
    isValid: failedQuestions.length === 0,
    failedQuestions,
    messages,
  };
}
