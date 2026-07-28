import { Job } from '../kaseki-api-types';

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringFieldValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function optionalNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function resolveCompletedAtValue(job: Job, metadata: any): string | undefined {
  if (job.completedAt) return job.completedAt.toISOString();
  if (!(job.status === 'completed' || job.status === 'failed')) return undefined;

  const rawEndedAt = metadata?.ended_at ?? metadata?.completedAt ?? metadata?.completed_at;
  if (typeof rawEndedAt !== 'string' || rawEndedAt.trim().length === 0) return undefined;

  const normalized = /^\d{4}-\d{2}-\d{2}T.*Z$/.test(rawEndedAt)
    ? rawEndedAt
    : rawEndedAt.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
