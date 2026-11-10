import { DecisionServiceError, type DecisionFailureCategory } from './decision-service/senku-client';
import type { ClassificationAnswer } from './types/openrouter-decisions';

/** @deprecated Senku selects the model; retained only for source compatibility. */
export const DEFAULT_JEV_MODEL = '~typesafe/jev-latest';

export interface JevClassificationOptions {
  /** @deprecated Senku selects its model and this value is ignored. */
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** @deprecated Senku calls are single-attempt; this value is ignored. */
  maxRetries?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface JevClassificationResult {
  model: string;
  answers: Record<string, ClassificationAnswer>;
  usage: Record<string, unknown>;
  responseTime: number;
  attemptCount: number;
}

/** @deprecated Use DecisionServiceError and its safe category fields. */
export class JevClassificationError extends DecisionServiceError {
  readonly code: DecisionFailureCategory;
  readonly status?: number;

  constructor(category: DecisionFailureCategory, _legacyMessage?: string, status?: number, requestId?: string) {
    super(category, { httpStatus: status, requestId });
    this.name = 'JevClassificationError';
    this.code = category;
    this.status = status;
  }
}
