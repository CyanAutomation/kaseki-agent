import type { ClassificationAnswer } from './types/openrouter-decisions';

export const DEFAULT_JEV_MODEL = '~typesafe/jev-latest';
export const JEV_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

export interface JevClassificationOptions {
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

export interface JevClassificationResult {
  model: string;
  answers: Record<string, ClassificationAnswer>;
  usage: Record<string, unknown>;
  responseTime: number;
  attemptCount: number;
}

export class JevClassificationError extends Error {
  readonly code: 'configuration' | 'credentials' | 'timeout' | 'http' | 'invalid_response' | 'network';
  readonly status?: number;
  readonly requestId?: string;
  attemptCount?: number;

  constructor(code: JevClassificationError['code'], message: string, status?: number, requestId?: string) {
    super(message);
    this.name = 'JevClassificationError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}
