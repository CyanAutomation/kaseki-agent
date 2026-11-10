import type { ClassificationAnswer, QuestionDefinition } from './types/openrouter-decisions';
import {
  DecisionServiceError,
  requestSenkuDecision,
  type DecisionFailureCategory,
  type SenkuClientOptions,
} from './decision-service/senku-client';

/** @deprecated Senku selects the model; retained for source compatibility only. */
export const DEFAULT_DECISION_MODEL = '~typesafe/jev-latest';

export interface DecisionRequest {
  state: string | Record<string, unknown>;
  questions: Record<string, QuestionDefinition>;
  /** @deprecated Ignored; Senku owns model selection. */
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DecisionResult {
  provider: string;
  model: string;
  answers: Record<string, ClassificationAnswer>;
  usage: Record<string, unknown>;
  responseTime: number;
  attemptCount: number;
}

export interface DecisionService {
  readonly providerId: string;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

export interface DecisionFailureMetadata {
  code: DecisionFailureCategory | 'provider_failure';
  attemptCount?: number;
  httpStatus?: number;
  requestId?: string;
}

export function decisionFailureMetadata(error: unknown): DecisionFailureMetadata {
  if (!(error instanceof DecisionServiceError)) return { code: 'provider_failure' };
  return {
    code: error.category,
    ...(error.attemptCount ? { attemptCount: error.attemptCount } : {}),
    ...(Number.isInteger(error.httpStatus) && error.httpStatus! >= 100 && error.httpStatus! <= 599
      ? { httpStatus: error.httpStatus }
      : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
  };
}

/** The only remote DecisionService implementation used by Kaseki. */
export class SenkuDecisionService implements DecisionService {
  readonly providerId = 'senku';

  constructor(private readonly options: SenkuClientOptions = {}) {}

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const result = await requestSenkuDecision(request.state, request.questions, {
      ...this.options,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
    });
    return {
      provider: this.providerId,
      model: result.model,
      answers: result.answers,
      usage: result.usage ?? {},
      responseTime: result.responseTime,
      attemptCount: result.attemptCount,
    };
  }
}

export const decisionService: DecisionService = new SenkuDecisionService();

export { DecisionServiceError };
