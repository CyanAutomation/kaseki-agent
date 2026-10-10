import { z } from 'zod';
import { RunRequestSchema, type RunRequest } from '../../kaseki-api-types';

export const SOYUZ_CONTRACT_VERSION = '1' as const;

const QueuedRunEnvelopeSchema = z.object({
  contractVersion: z.literal(SOYUZ_CONTRACT_VERSION),
  runId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  correlationId: z.string().uuid(),
  requestId: z.string().uuid(),
  request: z.record(z.string(), z.unknown()),
}).strict();

export interface SoyuzQueuedRun {
  contractVersion: typeof SOYUZ_CONTRACT_VERSION;
  runId: string;
  createdAt: string;
  correlationId: string;
  requestId: string;
  request: RunRequest;
}

export function parseSoyuzQueuedRun(value: unknown): SoyuzQueuedRun {
  const envelope = QueuedRunEnvelopeSchema.parse(value);
  if ('webhookConfig' in envelope.request || 'webhook_config' in envelope.request) {
    throw new Error('Soyuz contract v1 does not support webhookConfig');
  }
  rejectUnsupportedNestedOptions(envelope.request);
  const request = RunRequestSchema.parse(envelope.request);
  const knownRequestAliases = new Set([
    'repo_url', 'project_name', 'git_ref', 'task_prompt', 'changed_files_allowlist',
    'max_diff_bytes', 'validation_commands', 'auto_lint_cleanup', 'scouting_config',
    'goal_setting', 'goal_check', 'run_evaluation', 'task_mode', 'publish_mode',
    'startup_check', 'startup_check_mode', 'webhook_config', 'idempotency_key',
    'timeout_seconds',
  ]);
  const unsupportedFields = Object.keys(envelope.request)
    .filter((key) => !(key in request) && !knownRequestAliases.has(key));
  if (unsupportedFields.length > 0) {
    throw new Error(`Soyuz run request contains unsupported Kaseki fields: ${unsupportedFields.join(', ')}`);
  }
  return { ...envelope, request };
}

function rejectUnsupportedNestedOptions(raw: Record<string, unknown>): void {
  const objectOptions: Record<string, string[]> = {
    allowlist: ['include'],
    autoLintCleanup: ['enabled', 'commands'],
    validation: ['commands', 'autoLintCleanup'],
    goalSetting: ['enabled', 'model', 'timeoutSeconds'],
    scouting: ['enabled', 'model', 'timeoutSeconds'],
    goalCheck: ['enabled', 'maxRetries', 'model', 'timeoutSeconds'],
    runEvaluation: ['enabled', 'model', 'timeoutSeconds'],
    tracing: ['correlationId', 'requestId'],
  };
  const aliases: Record<string, string> = {
    autoLintCleanup: 'auto_lint_cleanup',
    goalSetting: 'goal_setting',
    scouting: 'scouting_config',
    goalCheck: 'goal_check',
    runEvaluation: 'run_evaluation',
  };

  for (const [field, allowed] of Object.entries(objectOptions)) {
    const value = raw[field] ?? (aliases[field] ? raw[aliases[field]] : undefined);
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
      throw new Error(`Soyuz run request contains unsupported ${field} fields: ${unknown.join(', ')}`);
    }
  }

  const validation = raw.validation;
  if (validation && typeof validation === 'object' && !Array.isArray(validation)) {
    const autoLint = (validation as Record<string, unknown>).autoLintCleanup;
    if (autoLint && typeof autoLint === 'object' && !Array.isArray(autoLint)) {
      const unknown = Object.keys(autoLint).filter((key) => !['enabled', 'commands'].includes(key));
      if (unknown.length > 0) {
        throw new Error(`Soyuz run request contains unsupported validation.autoLintCleanup fields: ${unknown.join(', ')}`);
      }
    }
  }
}

export type SoyuzRunStatus =
  | 'admitting'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'admission_failed';

export interface SoyuzWorkerRun {
  runId: string;
  contractVersion: string;
  status: SoyuzRunStatus;
  stage: string | null;
  claimExpiresAt: string | null;
  claimCallbackId?: string | null;
  cancelRequestedAt: string | null;
  workerId: string | null;
  updatedAt: string;
  lastHeartbeatAt?: string | null;
  operationalHealth?: 'unknown' | 'healthy' | 'suspect_stalled';
}

export interface CloudflarePulledMessage {
  body: unknown;
  id: string;
  timestamp_ms: number;
  attempts: number;
  lease_id: string;
}

export function decodeQueueMessageBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const decoded = Buffer.from(body, 'base64').toString('utf8');
    try {
      return JSON.parse(decoded) as unknown;
    } catch {
      throw new Error('Queue body is neither JSON nor base64-encoded JSON');
    }
  }
}
