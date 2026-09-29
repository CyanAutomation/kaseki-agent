import type { ClassificationAnswer, QuestionDefinition } from './types/openrouter-decisions';
import {
  classifyWithJev,
  DEFAULT_JEV_MODEL,
  JevClassificationError,
  type JevClassificationOptions,
} from './jev-classifier';

export const DEFAULT_DECISION_MODEL = DEFAULT_JEV_MODEL;

export interface DecisionRequest {
  state: string | Record<string, unknown>;
  questions: Record<string, QuestionDefinition>;
  model?: string;
  timeoutMs?: number;
}

export interface DecisionResult {
  provider: string;
  model: string;
  answers: Record<string, ClassificationAnswer>;
  usage: Record<string, unknown>;
  responseTime: number;
  attemptCount: number;
}

export interface DecisionProvider {
  readonly id: string;
  decide(request: DecisionRequest): Promise<Omit<DecisionResult, 'provider'>>;
}

export interface DecisionService {
  readonly providerId: string;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

export interface DecisionFailureMetadata {
  code: 'configuration' | 'credentials' | 'timeout' | 'http' | 'invalid_response' | 'network' | 'provider_failure';
  attemptCount?: number;
}

export function decisionFailureMetadata(error: unknown): DecisionFailureMetadata {
  if (!(error instanceof JevClassificationError)) return { code: 'provider_failure' };
  return {
    code: error.code,
    ...(error.attemptCount ? { attemptCount: error.attemptCount } : {}),
  };
}

/** JEV adapter. The workflow depends on DecisionService, not this provider. */
export class JevDecisionProvider implements DecisionProvider {
  readonly id = 'jev';

  constructor(private readonly classifierOptions: Pick<JevClassificationOptions, 'fetchImpl' | 'maxRetries'> = {}) {}

  async decide(request: DecisionRequest): Promise<Omit<DecisionResult, 'provider'>> {
    const result = await classifyWithJev(request.state, request.questions, {
      ...this.classifierOptions,
      model: request.model,
      timeoutMs: request.timeoutMs,
    });
    return result;
  }
}

export class ProviderDecisionService implements DecisionService {
  readonly providerId: string;

  constructor(private readonly provider: DecisionProvider) {
    this.providerId = provider.id;
  }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const result = await this.provider.decide(request);
    return { ...result, provider: this.provider.id };
  }
}

export const decisionService: DecisionService = new ProviderDecisionService(new JevDecisionProvider());
