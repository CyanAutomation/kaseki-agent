import { resolveOpenRouterApiKey } from './gateway-detection/resolve-openrouter-api-key';
import { parsePositiveInt } from './lib/env-var-helpers.js';
import { answerConfidence, answerIsTrue, classifyWithJev } from './jev-classifier';
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
  modelUsed?: string;
  responseTime: number;
  outputTokens?: number;
  degraded?: boolean;
  answers?: Record<string, TaskAdmissionAnswer>;
  /** Low-risk advisory only; user commands and deterministic workflow policy remain authoritative. */
  routingHints?: TaskAdmissionRoutingHints;
  warnings?: string[];
}

export type TaskAdmissionEvaluator = (request: Record<string, unknown>) => Promise<TaskAdmissionResult>;

const DEFAULT_MODEL = '~typesafe/jev-latest';
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

export function buildTaskAdmissionRequest(request: Record<string, unknown>): Record<string, unknown> {
  return {
    model: process.env.KASEKI_CLASSIFICATION_MODEL || DEFAULT_MODEL,
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

  const key = resolveOpenRouterApiKey();
  if (!key.configured || !key.value) {
    return {
      allowed: true,
      status: 'degraded',
      degraded: true,
      reason: 'Task admission classifier is unavailable; submission allowed by fail-open policy.',
      responseTime: 0,
      warnings: ['OPENROUTER_API_KEY is not configured.'],
    };
  }

  const model = process.env.KASEKI_CLASSIFICATION_MODEL || DEFAULT_MODEL;
  try {
    const requestBody = buildTaskAdmissionRequest(request);
    const parsed = await classifyWithJev(
      requestBody.state as string,
      requestBody.questions as Record<string, QuestionDefinition>,
      { model, timeoutMs: parsePositiveInt('KASEKI_TASK_ADMISSION_TIMEOUT_MS', DEFAULT_TIMEOUT_MS) },
    );
    const answers = parsed.answers as Record<string, TaskAdmissionAnswer>;
    const riskAnswer = answers.risk_level;
    const riskScore = riskAnswer?.type === 'choice' ? ({ low: 0, review: 1, high: 2 }[riskAnswer.choice] ?? undefined) : undefined;
    const unsafeQuestion = ['contains_credentials', 'changes_permissions', 'crosses_security_boundary']
      .find((name) => answerIsUnsafe(answers[name]));
    const highRisk = riskAnswer?.type === 'choice' && riskAnswer.choice === 'high' && answerConfidence(riskAnswer) >= confidenceThreshold();
    const taskTypeAnswer = answers.task_type;
    const validationFocusAnswer = answers.validation_focus;
    const routingHints = taskTypeAnswer?.type === 'choice' && validationFocusAnswer?.type === 'choice'
      && answerConfidence(taskTypeAnswer) >= confidenceThreshold()
      && answerConfidence(validationFocusAnswer) >= confidenceThreshold()
      ? { taskType: taskTypeAnswer.choice as TaskTypeHint, validationFocus: validationFocusAnswer.choice as ValidationFocusHint }
      : undefined;
    const rejected = Boolean(unsafeQuestion || highRisk);
    const uncertainQuestions = Object.entries(answers)
      .filter(([, answer]) => answer.type === 'noul' ? answer.noul > 1 - confidenceThreshold() && answer.noul < confidenceThreshold() : answerConfidence(answer) < confidenceThreshold())
      .map(([name]) => name);
    return {
      allowed: !rejected,
      status: rejected ? 'rejected' : 'allowed',
      reason: rejected ? `Task admission rejected: ${unsafeQuestion || 'classifier risk score is high'}.` : 'Task admission classifier found no high-confidence unsafe condition.',
      riskScore,
      modelUsed: parsed.model || model,
      responseTime: Math.round(performance.now() - started),
      outputTokens: typeof parsed.usage.output_tokens === 'number' ? parsed.usage.output_tokens : undefined,
      answers,
      routingHints,
      warnings: uncertainQuestions.length > 0
        ? [`Classifier confidence is below ${confidenceThreshold()} for: ${uncertainQuestions.join(', ')}.`]
        : undefined,
    };
  } catch (error) {
    return {
      allowed: true,
      status: 'degraded',
      degraded: true,
      reason: 'Task admission classifier failed; submission allowed by fail-open policy.',
      responseTime: Math.round(performance.now() - started),
      modelUsed: model,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}
