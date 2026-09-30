import { resolveOpenRouterApiKey } from './gateway-detection/resolve-openrouter-api-key';
import { parsePositiveInt } from './lib/env-var-helpers.js';
import { answerConfidence, answerIsTrue } from './decision-answers';
import { DEFAULT_DECISION_MODEL, decisionService } from './decision-service';
import { hasRetiredDecisionSettings } from './jev-classifier';
import type { ClassificationAnswer, QuestionDefinition } from './types/openrouter-decisions';

export const TASK_ADMISSION_EXIT_CODE = 9;

export type TaskAdmissionAnswer = ClassificationAnswer;

export type TaskTypeHint = 'feature' | 'bug_fix' | 'refactor' | 'documentation' | 'investigation' | 'test_only' | 'infrastructure';
export type ValidationFocusHint = 'unit_tests' | 'integration_tests' | 'type_and_lint' | 'docs_checks' | 'repo_defined_checks';
export interface TaskAdmissionRoutingHints { taskType: TaskTypeHint; validationFocus: ValidationFocusHint; }

export interface TaskAdmissionResult {
  allowed: boolean;
  status: 'allowed' | 'rejected' | 'degraded';
  reason: string;
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

const DEFAULT_MODEL = DEFAULT_DECISION_MODEL;
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

function buildAdmissionState(request: Record<string, unknown>): string {
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
  });
  return JSON.stringify(safeRequest);
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

function firstUnsafeQuestion(answers: Record<string, TaskAdmissionAnswer>): string | undefined {
  return ['contains_credentials', 'changes_permissions', 'crosses_security_boundary']
    .find((name) => answerIsUnsafe(answers[name]));
}

function isHighConfidenceRisk(answer: TaskAdmissionAnswer | undefined): boolean {
  return answer?.type === 'choice'
    && answer.choice === 'high'
    && answerConfidence(answer) >= confidenceThreshold();
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
  const unsafeQuestion = firstUnsafeQuestion(answers);
  const rejected = Boolean(unsafeQuestion || isHighConfidenceRisk(answers.risk_level));
  const uncertainQuestions = uncertainQuestionNames(answers);
  const threshold = confidenceThreshold();
  return {
    allowed: !rejected,
    status: rejected ? 'rejected' : 'allowed',
    reason: rejected
      ? `Task admission rejected: ${unsafeQuestion || 'evaluation risk score is high'}.`
      : 'Task Admission evaluation found no high-confidence unsafe condition.',
    riskScore: riskScore(answers.risk_level),
    responseTime: Math.round(performance.now() - started),
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
    answers,
    routingHints: routingHints(answers),
    warnings: uncertainQuestions.length > 0
      ? [`Task Admission evaluation confidence is below ${threshold} for: ${uncertainQuestions.join(', ')}.`]
      : undefined,
  };
}

export function buildTaskAdmissionRequest(request: Record<string, unknown>): Record<string, unknown> {
  return {
    model: process.env.KASEKI_DECISION_MODEL || DEFAULT_MODEL,
    state: buildAdmissionState(request),
    questions: {
      contains_credentials: {
        type: 'noul',
        instructions: 'Does this task request contain, expose, create, copy, rotate, or exfiltrate credentials or secrets?',
      },
      changes_permissions: {
        type: 'noul',
        instructions: 'Will this task change permissions, authentication, authorization, ownership, or access control?',
      },
      crosses_security_boundary: {
        type: 'noul',
        instructions: 'Will this task weaken, bypass, or cross a security boundary or isolation boundary?',
      },
      risk_level: {
        type: 'choice',
        instructions: 'How risky is this task to run automatically?',
        criteria: {
          low: 'Low risk and reversible.',
          review: 'Potentially consequential; record increased PR-stage review risk.',
          high: 'Destructive, secret-related, or security-sensitive.',
        },
      },
      task_type: {
        type: 'choice',
        instructions: 'What kind of repository task is requested? Classify the user objective, not incidental wording.',
        criteria: {
          feature: 'Add or extend user-facing behavior or capability.',
          bug_fix: 'Correct behavior that currently fails or is incorrect.',
          refactor: 'Restructure implementation while preserving behavior.',
          documentation: 'Change documentation, examples, or explanatory text.',
          investigation: 'Inspect or diagnose without necessarily changing code.',
          test_only: 'Add or update automated tests without changing production behavior.',
          infrastructure: 'Change build, deployment, CI, dependency, or runtime configuration.',
        },
      },
      validation_focus: {
        type: 'choice',
        instructions: 'Which validation category is most relevant to this task? This is advisory and must not replace explicit commands.',
        criteria: {
          unit_tests: 'Focused unit tests are the clearest signal.',
          integration_tests: 'Integration or end-to-end checks are the clearest signal.',
          type_and_lint: 'Type checking or linting is the clearest signal.',
          docs_checks: 'Documentation links, generation, formatting, or examples checks are the clearest signal.',
          repo_defined_checks: 'Use the repository’s declared general check or validation target.',
        },
      },
    },
  };
}

export async function evaluateTaskAdmission(request: Record<string, unknown>): Promise<TaskAdmissionResult> {
  const started = performance.now();
  if (localCredentialSignal(request)) {
    return {
      allowed: false,
      status: 'rejected',
      reason: 'Task request contains a credential or secret-like value.',
      responseTime: Math.round(performance.now() - started),
      warnings: ['Rejected by deterministic local credential screening.'],
    };
  }

  if (hasRetiredDecisionSettings()) {
    return {
      allowed: true,
      status: 'degraded',
      degraded: true,
      reason: 'Task admission evaluation is unavailable because retired settings were detected; submission remains fail-open. Configure the stage-based settings.',
      responseTime: Math.round(performance.now() - started),
      warnings: ['Remove retired evaluation settings and configure the stage-based replacements.'],
    };
  }

  const key = resolveOpenRouterApiKey();
  if (!key.configured || !key.value) {
    return {
      allowed: true,
      status: 'degraded',
      degraded: true,
      reason: 'Task admission evaluation is unavailable; submission allowed by fail-open policy.',
      responseTime: 0,
      warnings: ['Evaluation credentials are not configured.'],
    };
  }

  const model = process.env.KASEKI_DECISION_MODEL || DEFAULT_MODEL;
  try {
    const requestBody = buildTaskAdmissionRequest(request);
    const parsed = await decisionService.decide({
      state: requestBody.state as string,
      questions: requestBody.questions as Record<string, QuestionDefinition>,
      model,
      timeoutMs: parsePositiveInt('KASEKI_TASK_ADMISSION_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    });
    return buildClassifiedResult(
      parsed.answers as Record<string, TaskAdmissionAnswer>,
      parsed.usage,
      started,
    );
  } catch (error) {
    return {
      allowed: true,
      status: 'degraded',
      degraded: true,
      reason: 'Task Admission evaluation failed; submission allowed by fail-open policy.',
      responseTime: Math.round(performance.now() - started),
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}
