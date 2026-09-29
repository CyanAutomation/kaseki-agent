import type { ClassificationAnswer } from './types/openrouter-decisions';

export function answerConfidence(answer: ClassificationAnswer | undefined): number {
  return answer?.type === 'choice' || answer?.type === 'score' ? answer.confidence : 0;
}

export function answerIsTrue(answer: ClassificationAnswer | undefined, threshold = 0.8): boolean {
  return answer?.type === 'noul' && answer.noul >= threshold;
}

export function answerIsFalse(answer: ClassificationAnswer | undefined, threshold = 0.2): boolean {
  return answer?.type === 'noul' && answer.noul <= threshold;
}
