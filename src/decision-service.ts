import type { ClassificationAnswer } from './types/openrouter-decisions';
import {
  DecisionServiceError,
  requestSenkuProfile,
  type DecisionFailureCategory,
  type SenkuProfileId,
  type SenkuClientOptions,
} from './decision-service/senku-client';

export interface DecisionResult {
  provider: string;
  model: string;
  answers: Record<string, ClassificationAnswer>;
  usage: Record<string, unknown>;
  responseTime: number;
  attemptCount: number;
}

export interface ProfileDecisionRequest {
  profileId: SenkuProfileId;
  input: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProfileDecisionResult extends DecisionResult {
  profileId: SenkuProfileId;
  profileVersion: string;
}

export interface DecisionService {
  readonly providerId: string;
  evaluateProfile(request: ProfileDecisionRequest): Promise<ProfileDecisionResult>;
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

  async evaluateProfile(request: ProfileDecisionRequest): Promise<ProfileDecisionResult> {
    const result = await requestSenkuProfile(request.profileId, request.input, {
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
      profileId: result.profileId,
      profileVersion: result.profileVersion,
    };
  }
}

export const decisionService = new SenkuDecisionService();

export { DecisionServiceError };
