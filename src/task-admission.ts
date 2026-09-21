import { resolveOpenRouterApiKey } from './gateway-detection/resolve-openrouter-api-key';
import { answerConfidence, classifyWithJev } from './jev-classifier';

export const TASK_ADMISSION_EXIT_CODE = 9;

export interface TaskAdmissionAnswer {
  type?: 'noul' | 'choice' | 'score';
  answer?: string | number | boolean | null;
  confidence?: number;
  probabilities?: Record<string, number>;
}

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
  warnings?: string[];
}

export type TaskAdmissionEvaluator = (request: Record<string, unknown>) => Promise<TaskAdmissionResult>;

const DEFAULT_MODEL = '~typesafe/jev-latest';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

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

function answerIsUnsafe(answer: TaskAdmissionAnswer | undefined): boolean {
  if (!answer) return false;
  const confidence = typeof answer.confidence === 'number' ? answer.confidence : 0;
  return (answer.answer === true || answer.answer === 'yes' || (typeof answer.answer === 'number' && answer.answer >= 2)) &&
    confidence >= confidenceThreshold();
}

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
      risk_score: {
        type: 'score',
        min: 0,
        max: 2,
        instructions: 'How risky is this task to run automatically?',
        legend: { '0': 'Low risk and reversible', '1': 'Moderate risk or needs review', '2': 'High risk, destructive, secret-related, or security-sensitive' },
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
      requestBody.questions as Record<string, { type: 'noul' | 'choice' | 'score'; instructions?: string; legend?: Record<string, string> }>,
      { model, timeoutMs: positiveIntegerEnv('KASEKI_TASK_ADMISSION_TIMEOUT_MS', DEFAULT_TIMEOUT_MS) },
    );
    const answers = parsed.answers as Record<string, TaskAdmissionAnswer>;
    const riskAnswer = answers.risk_score;
    const riskScore = typeof riskAnswer?.answer === 'number' ? riskAnswer.answer : undefined;
    const unsafeQuestion = ['contains_credentials', 'changes_permissions', 'crosses_security_boundary']
      .find((name) => answerIsUnsafe(answers[name]));
    const highRisk = riskScore !== undefined && riskScore >= 2 &&
      (typeof riskAnswer?.confidence !== 'number' || riskAnswer.confidence >= confidenceThreshold());
    const rejected = Boolean(unsafeQuestion || highRisk);
    const uncertainQuestions = Object.entries(answers)
      .filter(([, answer]) => answerConfidence(answer) < confidenceThreshold())
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
