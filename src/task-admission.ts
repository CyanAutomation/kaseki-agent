import { parsePositiveInt } from './lib/env-var-helpers.js';
import { answerConfidence, answerIsTrue } from './decision-answers';
import { DecisionServiceError, decisionFailureMetadata, decisionService } from './decision-service';
import { hasRetiredDecisionSettings } from './decision-service/senku-client';
import type { ClassificationAnswer } from './types/openrouter-decisions';

export const TASK_ADMISSION_EXIT_CODE = 9;

export type TaskAdmissionAnswer = ClassificationAnswer;

export type TaskTypeHint = 'feature' | 'bug_fix' | 'refactor' | 'documentation' | 'investigation' | 'test_only' | 'infrastructure';
export type ValidationFocusHint = 'unit_tests' | 'integration_tests' | 'type_and_lint' | 'docs_checks' | 'repo_defined_checks';
export interface TaskAdmissionRoutingHints { taskType: TaskTypeHint; validationFocus: ValidationFocusHint; }

export type TaskAdmissionReasonCode =
  | 'admitted'
  | 'unsafe_condition'
  | 'high_risk'
  | 'credential_signal'
  | 'evaluation_unavailable';
export type TaskAdmissionSignal =
  | 'contains_credentials'
  | 'changes_permissions'
  | 'crosses_security_boundary'
  | 'risk_level'
  | 'local_credential_signal';
export type TaskAdmissionRiskLevel = 'low' | 'review' | 'high';

/** Bounded, non-sensitive admission metadata retained with a run and sent to Soyuz. */
export interface SafeTaskAdmissionRecord {
  schemaVersion: 1;
  status: 'allowed' | 'rejected' | 'degraded';
  reasonCode: TaskAdmissionReasonCode;
  signal?: TaskAdmissionSignal;
  summary: string;
  riskLevel?: TaskAdmissionRiskLevel;
  riskScore?: number;
  responseTimeMs: number;
  evaluatedAt: string;
}

export interface TaskAdmissionResult {
  allowed: boolean;
  status: 'allowed' | 'rejected' | 'degraded';
  reason: string;
  /** Machine-readable safe classification; classifier answers are deliberately excluded from the run record. */
  reasonCode?: TaskAdmissionReasonCode;
  signal?: TaskAdmissionSignal;
  riskLevel?: TaskAdmissionRiskLevel;
  riskScore?: number;
  responseTime: number;
  outputTokens?: number;
  degraded?: boolean;
  answers?: Record<string, TaskAdmissionAnswer>;
  /** Low-risk advisory only; user commands and deterministic workflow policy remain authoritative. */
  routingHints?: TaskAdmissionRoutingHints;
  warnings?: string[];
}

export type TaskAdmissionEvaluator = (request: Record<string, unknown>) => Promise<TaskAdmissionResult>;

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

function confidenceThreshold(): number {
  const value = Number.parseFloat(process.env.KASEKI_TASK_ADMISSION_CONFIDENCE || '');
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_CONFIDENCE_THRESHOLD;
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, '[REDACTED_CREDENTIAL]')
      .replace(/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = /secret|token|password|credential|api.?key/i.test(key) ? '[REDACTED_SECRET]' : redact(item);
    }
    return result;
  }
  return value;
}

function buildAdmissionInput(request: Record<string, unknown>): Record<string, unknown> {
  const safeRequest = redact({
    repoUrl: request.repoUrl,
    ref: request.ref,
    taskPrompt: request.taskPrompt,
    validationCommands: request.validationCommands,
    changedFilesAllowlist: request.changedFilesAllowlist,
    taskMode: request.taskMode,
    publishMode: request.publishMode,
    startupCheck: request.startupCheck,
    scouting: request.scouting,
    goalSetting: request.goalSetting,
  }) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(safeRequest).filter(([, value]) => value !== undefined));
}

function localCredentialSignal(request: Record<string, unknown>): boolean {
  const text = JSON.stringify(request);
  return /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/.test(text) ||
    /(?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i.test(text);
}

function answerIsUnsafe(answer: TaskAdmissionAnswer | undefined): boolean { return answerIsTrue(answer, confidenceThreshold()); }

function riskScore(answer: TaskAdmissionAnswer | undefined): number | undefined {
  if (answer?.type !== 'choice') return undefined;
  return { low: 0, review: 1, high: 2 }[answer.choice];
}

function riskLevel(answer: TaskAdmissionAnswer | undefined): TaskAdmissionRiskLevel | undefined {
  if (answer?.type !== 'choice' || !['low', 'review', 'high'].includes(answer.choice)) return undefined;
  return answer.choice as TaskAdmissionRiskLevel;
}

function firstUnsafeQuestion(answers: Record<string, TaskAdmissionAnswer>): string | undefined {
  return ['contains_credentials', 'changes_permissions', 'crosses_security_boundary']
    .find((name) => answerIsUnsafe(answers[name]));
}

function isHighConfidenceRisk(answer: TaskAdmissionAnswer | undefined): boolean {
  return answer?.type === 'choice'
    && answer.choice === 'high'
    && answerConfidence(answer) >= confidenceThreshold();
}

interface TaskAdmissionClassification {
  reasonCode: TaskAdmissionReasonCode;
  reason: string;
  signal?: TaskAdmissionSignal;
  riskLevel?: TaskAdmissionRiskLevel;
  riskScore?: number;
}

function classifyTaskAdmissionAnswers(answers: Record<string, TaskAdmissionAnswer>): TaskAdmissionClassification {
  const riskAnswer = answers.risk_level;
  const classifiedRiskLevel = riskLevel(riskAnswer);
  const classifiedRiskScore = riskScore(riskAnswer);
  const unsafeSignal = firstUnsafeQuestion(answers) as TaskAdmissionSignal | undefined;
  if (unsafeSignal) {
    return {
      reasonCode: 'unsafe_condition',
      reason: `Task admission rejected: ${unsafeSignal}.`,
      signal: unsafeSignal,
      riskLevel: classifiedRiskLevel,
      riskScore: classifiedRiskScore,
    };
  }
  if (isHighConfidenceRisk(riskAnswer)) {
    return {
      reasonCode: 'high_risk',
      reason: 'Task admission rejected: evaluation risk score is high.',
      signal: 'risk_level',
      riskLevel: classifiedRiskLevel,
      riskScore: classifiedRiskScore,
    };
  }
  return {
    reasonCode: 'admitted',
    reason: 'Task Admission evaluation found no high-confidence unsafe condition.',
    riskLevel: classifiedRiskLevel,
    riskScore: classifiedRiskScore,
  };
}

function routingHints(answers: Record<string, TaskAdmissionAnswer>): TaskAdmissionRoutingHints | undefined {
  const taskType = answers.task_type;
  const validationFocus = answers.validation_focus;
  if (taskType?.type !== 'choice' || validationFocus?.type !== 'choice') return undefined;
  const threshold = confidenceThreshold();
  if (answerConfidence(taskType) < threshold || answerConfidence(validationFocus) < threshold) return undefined;
  return {
    taskType: taskType.choice as TaskTypeHint,
    validationFocus: validationFocus.choice as ValidationFocusHint,
  };
}

function isUncertainAnswer(answer: TaskAdmissionAnswer, threshold: number): boolean {
  if (answer.type === 'noul') {
    return answer.noul > 1 - threshold && answer.noul < threshold;
  }
  return answerConfidence(answer) < threshold;
}

function uncertainQuestionNames(answers: Record<string, TaskAdmissionAnswer>): string[] {
  const threshold = confidenceThreshold();
  return Object.entries(answers)
    .filter(([, answer]) => isUncertainAnswer(answer, threshold))
    .map(([name]) => name);
}

function buildClassifiedResult(
  answers: Record<string, TaskAdmissionAnswer>,
  usage: Record<string, unknown>,
  started: number,
): TaskAdmissionResult {
  const classification = classifyTaskAdmissionAnswers(answers);
  const rejected = classification.reasonCode !== 'admitted';
  const uncertainQuestions = uncertainQuestionNames(answers);
  const threshold = confidenceThreshold();
  return {
    allowed: !rejected,
    status: rejected ? 'rejected' : 'allowed',
    reasonCode: classification.reasonCode,
    ...(classification.signal ? { signal: classification.signal } : {}),
    riskLevel: classification.riskLevel,
    reason: classification.reason,
    riskScore: classification.riskScore,
    responseTime: Math.round(performance.now() - started),
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
    answers,
    routingHints: routingHints(answers),
    warnings: uncertainQuestions.length > 0
      ? [`Task Admission evaluation confidence is below ${threshold} for: ${uncertainQuestions.join(', ')}.`]
      : undefined,
  };
}

const SAFE_ADMISSION_SUMMARIES: Record<TaskAdmissionReasonCode, string> = {
  admitted: 'Task admission allowed after safety evaluation.',
  unsafe_condition: 'Task admission rejected after a local safety evaluation.',
  high_risk: 'Task admission rejected after a high-confidence high-risk classification.',
  credential_signal: 'Task admission rejected by deterministic credential screening.',
  evaluation_unavailable: 'Task admission evaluation was unavailable; the configured fail-open policy was applied.',
};

const SAFE_SIGNAL_SUMMARIES: Partial<Record<TaskAdmissionSignal, string>> = {
  contains_credentials: 'Task admission rejected after a credential-related safety signal.',
  changes_permissions: 'Task admission rejected after a permission-change safety signal.',
  crosses_security_boundary: 'Task admission rejected after a security-boundary safety signal.',
  risk_level: SAFE_ADMISSION_SUMMARIES.high_risk,
  local_credential_signal: SAFE_ADMISSION_SUMMARIES.credential_signal,
};

function inferredReasonCode(result: TaskAdmissionResult, classification?: TaskAdmissionClassification): TaskAdmissionReasonCode {
  if (result.reasonCode) return result.reasonCode;
  if (classification && classification.reasonCode !== 'admitted') return classification.reasonCode;
  if (result.status === 'degraded') return 'evaluation_unavailable';
  return result.status === 'rejected' ? 'unsafe_condition' : 'admitted';
}

function safeRiskResult(
  result: TaskAdmissionResult,
  classification?: TaskAdmissionClassification,
): Pick<SafeTaskAdmissionRecord, 'riskLevel' | 'riskScore'> {
  const safeRiskLevel = result.riskLevel ?? classification?.riskLevel;
  const candidateRiskScore = result.riskScore ?? classification?.riskScore;
  const safeRiskScore = safeRiskLevel
    ? { low: 0, review: 1, high: 2 }[safeRiskLevel]
    : typeof candidateRiskScore === 'number' && Number.isInteger(candidateRiskScore) && candidateRiskScore >= 0 && candidateRiskScore <= 2
      ? candidateRiskScore
      : undefined;
  return {
    ...(safeRiskLevel ? { riskLevel: safeRiskLevel } : {}),
    ...(safeRiskScore !== undefined ? { riskScore: safeRiskScore } : {}),
  };
}

function safeResponseTimeMs(responseTime: number): number {
  return Number.isFinite(responseTime)
    ? Math.trunc(Math.max(0, Math.min(86_400_000, responseTime)))
    : 0;
}

/** Project a full classifier response into the small safe record persisted for a run. */
export function toSafeTaskAdmissionRecord(
  result: TaskAdmissionResult,
  evaluatedAt = new Date(),
): SafeTaskAdmissionRecord {
  const classification = result.answers ? classifyTaskAdmissionAnswers(result.answers) : undefined;
  const reasonCode = inferredReasonCode(result, classification);
  const signal = result.signal ?? classification?.signal;
  const summary = (signal ? SAFE_SIGNAL_SUMMARIES[signal] : undefined) ?? SAFE_ADMISSION_SUMMARIES[reasonCode];
  const risk = safeRiskResult(result, classification);
  return {
    schemaVersion: 1,
    status: result.status,
    reasonCode,
    ...(signal ? { signal } : {}),
    summary,
    ...risk,
    responseTimeMs: safeResponseTimeMs(result.responseTime),
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

export function buildTaskAdmissionRequest(request: Record<string, unknown>): Record<string, unknown> {
  return {
    input: buildAdmissionInput(request),
  };
}

export async function evaluateTaskAdmission(request: Record<string, unknown>): Promise<TaskAdmissionResult> {
  const started = performance.now();
  if (localCredentialSignal(request)) {
    return {
      allowed: false,
      status: 'rejected',
      reasonCode: 'credential_signal',
      signal: 'local_credential_signal',
      reason: 'Task request contains a credential or secret-like value.',
      responseTime: Math.round(performance.now() - started),
      warnings: ['Rejected by deterministic local credential screening.'],
    };
  }

  if (hasRetiredDecisionSettings()) {
    return {
      allowed: true,
      status: 'degraded',
      reasonCode: 'evaluation_unavailable',
      degraded: true,
      reason: 'Task admission evaluation is unavailable because retired settings were detected; submission remains fail-open. Configure the stage-based settings.',
      responseTime: Math.round(performance.now() - started),
      warnings: ['Remove retired evaluation settings and configure the stage-based replacements.'],
    };
  }

  try {
    const requestBody = buildTaskAdmissionRequest(request);
    const parsed = await decisionService.evaluateProfile({
      profileId: 'task_admission_v1',
      input: requestBody.input as Record<string, unknown>,
      timeoutMs: parsePositiveInt('KASEKI_TASK_ADMISSION_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    });
    return buildClassifiedResult(
      parsed.answers as Record<string, TaskAdmissionAnswer>,
      parsed.usage,
      started,
    );
  } catch (error) {
    const failure = decisionFailureMetadata(error);
    const credentialWarning = error instanceof DecisionServiceError && error.category === 'credentials'
      ? error.credentialSource === 'none'
        ? 'Senku decision credentials are not configured.'
        : error.credentialSource === 'file' || error.credentialSource === 'environment'
          ? 'Senku decision credentials are invalid or unreadable.'
          : undefined
      : undefined;
    return {
      allowed: true,
      status: 'degraded',
      reasonCode: 'evaluation_unavailable',
      degraded: true,
      reason: 'Task Admission evaluation failed; submission allowed by fail-open policy.',
      responseTime: Math.round(performance.now() - started),
      warnings: [credentialWarning ?? `Senku decision classification is unavailable (${failure.code}).`],
    };
  }
}
