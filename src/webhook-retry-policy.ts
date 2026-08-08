import type { WebhookConfig } from './kaseki-api-types';

export function getRetryDecision(entryAttempts: number, config: WebhookConfig): {
  hasRemainingAttempts: boolean;
  backoffMs: number;
} {
  const policy = config.retryPolicy ?? { maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 30000 };
  return {
    hasRemainingAttempts: entryAttempts < policy.maxAttempts,
    backoffMs: Math.min(policy.initialDelayMs * Math.pow(2, entryAttempts - 1), policy.maxDelayMs),
  };
}
