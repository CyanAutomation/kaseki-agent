import type { ClassificationAnswer, QuestionDefinition } from './types/openrouter-decisions';
import { answerConfidence } from './jev-classifier';
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

const CAUSES: Record<ValidationFailureCause, string> = {
  test_failure: 'A test assertion or behavioral check failed.',
  type_or_lint_failure: 'Type checking, linting, or formatting failed.',
  build_failure: 'Compilation, bundling, or build failed.',
  dependency_or_environment: 'A dependency, service, platform, or environment problem caused the failure.',
  timeout_or_flaky: 'The evidence points to a timeout or intermittent failure.',
  implementation_logic: 'The code change appears to cause incorrect behavior.',
  unknown: 'The available evidence does not support a more specific cause.',
};

const ACTIONS = {
  fix_implementation: 'Correct the implementation, then rerun the requested checks.',
  repair_environment: 'Repair the dependency or environment issue, then rerun the requested checks.',
  retry_validation_once: 'Retry the same validation command once to confirm a likely transient failure.',
  inspect_diagnostics: 'Use the retained logs and failure artifact to narrow the cause before changing code.',
};

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

export function buildValidationRecoveryQuestions(): Record<string, QuestionDefinition> {
  return {
    validation_failure_cause: {
      type: 'choice',
      instructions: 'Classify the most likely cause of this validation failure from the supplied command, exit status, and bounded failure output.',
      criteria: CAUSES,
    },
    validation_recovery_action: {
      type: 'choice',
      instructions: 'Recommend the safest next validation workflow action. A retry is only a recommendation and is subject to local retry policy.',
      criteria: ACTIONS,
    },
  };
}

export function prepareValidationFailureState(input: { command: string; exitCode: number; output: string; maxOutputChars?: number }): Record<string, unknown> {
  const maxOutputChars = Number.isInteger(input.maxOutputChars) && Number(input.maxOutputChars) > 0
    ? Math.min(Number(input.maxOutputChars), 6000)
    : 5000;
  return {
    command: String(redactJevEvidence(input.command)).slice(0, 1000),
    exit_code: input.exitCode,
    failure_output: String(redactJevEvidence(input.output)).slice(-maxOutputChars),
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
