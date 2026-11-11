import { TextEncoder } from 'node:util';
import type { ClassificationAnswer } from './types/openrouter-decisions';
import { answerConfidence } from './decision-answers';
import { redactJevEvidence } from './jev-evidence-redaction';

export type ValidationRecoveryMode = 'off' | 'observe' | 'auto';
export type ValidationFailureCause =
  | 'test_failure'
  | 'type_or_lint_failure'
  | 'build_failure'
  | 'dependency_or_environment'
  | 'timeout_or_flaky'
  | 'implementation_logic'
  | 'unknown';

export interface ValidationRetryDecision {
  shouldRetry: boolean;
  reason:
    | 'approved'
    | 'observe_only'
    | 'command_not_allowlisted'
    | 'confidence_below_threshold'
    | 'cause_not_transient'
    | 'action_not_retry'
    | 'retry_limit_reached'
    | 'disabled'
    | 'classification_unavailable';
  cause?: ValidationFailureCause;
  recommendedAction?: string;
  confidence: number;
}

export interface ValidationRecoveryArtifact {
  stage: 'validation recovery';
  mode: ValidationRecoveryMode;
  status: 'classified' | 'unavailable' | 'skipped';
  command: string;
  exit_code: number;
  cause?: ValidationFailureCause;
  recommended_action?: string;
  confidence: number;
  retry_eligible: boolean;
  retry_authorized: boolean;
  retry_attempted: boolean;
  retry_result?: 'passed' | 'failed';
  reason: string;
}

export function resolveValidationRecoveryMode(value: string | undefined): ValidationRecoveryMode {
  return value === 'off' || value === 'auto' || value === 'observe' ? value : 'observe';
}

export function parseRetrySafeCommands(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.trim().length > 0)) return [];
    return [...new Set(parsed.map((item: string) => item.trim()))];
  } catch {
    return [];
  }
}

function tailUtf8(value: string, maxBytes: number): string {
  const characters = Array.from(value);
  const encoder = new TextEncoder();
  let start = characters.length;
  let bytes = 0;
  while (start > 0) {
    const characterBytes = encoder.encode(characters[start - 1]!).byteLength;
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    start -= 1;
  }
  return characters.slice(start).join('');
}

function headUtf8(value: string, maxBytes: number): string {
  const characters = Array.from(value);
  const encoder = new TextEncoder();
  let end = 0;
  let bytes = 0;
  while (end < characters.length) {
    const characterBytes = encoder.encode(characters[end]!).byteLength;
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    end += 1;
  }
  return characters.slice(0, end).join('');
}

export function prepareValidationFailureInput(input: { command: string; exitCode: number; output: string; maxOutputBytes?: number }): Record<string, unknown> {
  const maxOutputBytes = Number.isInteger(input.maxOutputBytes) && Number(input.maxOutputBytes) > 0
    ? Math.min(Number(input.maxOutputBytes), 6000)
    : 6000;
  return {
    command: headUtf8(String(redactJevEvidence(input.command)), 1000),
    exitCode: input.exitCode,
    output: tailUtf8(String(redactJevEvidence(input.output)), maxOutputBytes),
  };
}

export function decideValidationRetry(input: {
  mode: ValidationRecoveryMode;
  command: string;
  safeCommands?: string[];
  answers: Record<string, ClassificationAnswer>;
  confidenceThreshold: number;
  alreadyRetried: boolean;
}): ValidationRetryDecision {
  const causeAnswer = input.answers.validation_failure_cause;
  const actionAnswer = input.answers.validation_recovery_action;
  const cause = causeAnswer?.type === 'choice' ? causeAnswer.choice as ValidationFailureCause : undefined;
  const recommendedAction = actionAnswer?.type === 'choice' ? actionAnswer.choice : undefined;
  const confidence = Math.min(answerConfidence(causeAnswer), answerConfidence(actionAnswer));
  const decision = (reason: ValidationRetryDecision['reason']): ValidationRetryDecision => ({
    shouldRetry: reason === 'approved', reason, cause, recommendedAction, confidence,
  });

  if (input.mode === 'off') return decision('disabled');
  if (input.alreadyRetried) return decision('retry_limit_reached');
  if (!input.safeCommands?.includes(input.command)) return decision('command_not_allowlisted');
  if (confidence < input.confidenceThreshold) return decision('confidence_below_threshold');
  if (cause !== 'dependency_or_environment' && cause !== 'timeout_or_flaky') return decision('cause_not_transient');
  if (recommendedAction !== 'retry_validation_once') return decision('action_not_retry');
  if (input.mode === 'observe') return decision('observe_only');
  return decision('approved');
}

export function buildValidationRecoveryArtifact(input: {
  mode: ValidationRecoveryMode;
  command: string;
  exitCode: number;
  decision: ValidationRetryDecision;
  status?: 'classified' | 'unavailable' | 'skipped';
  retryAttempted?: boolean;
  retryResult?: 'passed' | 'failed';
}): ValidationRecoveryArtifact {
  return {
    stage: 'validation recovery',
    mode: input.mode,
    status: input.status ?? 'classified',
    command: String(redactJevEvidence(input.command)).slice(0, 1000),
    exit_code: input.exitCode,
    ...(input.decision.cause ? { cause: input.decision.cause } : {}),
    ...(input.decision.recommendedAction ? { recommended_action: input.decision.recommendedAction } : {}),
    confidence: input.decision.confidence,
    retry_eligible: input.decision.reason === 'approved' || input.decision.reason === 'observe_only',
    retry_authorized: input.decision.shouldRetry,
    retry_attempted: input.retryAttempted ?? false,
    ...(input.retryResult ? { retry_result: input.retryResult } : {}),
    reason: input.decision.reason,
  };
}
