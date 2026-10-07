import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ClassificationAnswer } from './types/openrouter-decisions';

export type DecisionWorkflowStage = 'goal_check' | 'run_evaluation' | 'validation_recovery';

export interface DecisionTelemetryRecord {
  stage: DecisionWorkflowStage;
  status: 'completed' | 'unavailable';
  provider: string;
  model?: string;
  outcome?: string;
  confidence?: number;
  durationMs: number;
  attemptCount?: number;
  usage?: Record<string, unknown>;
  generativeCallsAvoided?: number;
  errorCode?: string;
  httpStatus?: number;
  requestId?: string;
}

const USAGE_FIELDS = [
  'input_tokens',
  'prompt_tokens',
  'completion_tokens',
  'output_tokens',
  'total_tokens',
  'cost',
] as const;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function safeUsage(usage: Record<string, unknown> | undefined): Record<string, number> | undefined {
  if (!usage) return undefined;
  const result = Object.fromEntries(USAGE_FIELDS.flatMap((key) => (
    finiteNumber(usage[key]) ? [[key, usage[key] as number]] : []
  )));
  return Object.keys(result).length > 0 ? result : undefined;
}

export function summarizeDecisionConfidence(answers: Record<string, ClassificationAnswer>): number | undefined {
  const confidences = Object.values(answers).map((answer) => {
    if (answer.type === 'noul') return Math.max(answer.noul, 1 - answer.noul);
    return answer.confidence;
  });
  return confidences.length > 0 ? Math.min(...confidences) : undefined;
}

/** Store only decision metadata and aggregate usage; evaluated state is intentionally excluded. */
export function appendDecisionTelemetry(resultsDir: string, record: DecisionTelemetryRecord): void {
  const safeRecord = {
    timestamp: new Date().toISOString(),
    stage: record.stage,
    status: record.status,
    provider: record.provider.slice(0, 80),
    ...(record.model ? { model: record.model.slice(0, 120) } : {}),
    ...(record.outcome ? { outcome: record.outcome.slice(0, 120) } : {}),
    ...(finiteNumber(record.confidence) && record.confidence <= 1 ? { confidence: record.confidence } : {}),
    durationMs: finiteNumber(record.durationMs) ? Math.round(record.durationMs) : 0,
    ...(finiteNumber(record.attemptCount) ? { attemptCount: Math.floor(record.attemptCount) } : {}),
    ...(safeUsage(record.usage) ? { usage: safeUsage(record.usage) } : {}),
    ...(finiteNumber(record.generativeCallsAvoided) ? { generativeCallsAvoided: Math.floor(record.generativeCallsAvoided) } : {}),
    ...(record.errorCode ? { errorCode: record.errorCode.slice(0, 80) } : {}),
    ...(Number.isInteger(record.httpStatus) && record.httpStatus! >= 100 && record.httpStatus! <= 599 ? { httpStatus: record.httpStatus } : {}),
    ...(record.requestId && /^[A-Za-z0-9._:/-]{1,128}$/.test(record.requestId) ? { requestId: record.requestId } : {}),
  };
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.appendFileSync(path.join(resultsDir, 'decisions.jsonl'), JSON.stringify(safeRecord) + '\n', { mode: 0o600 });
}
