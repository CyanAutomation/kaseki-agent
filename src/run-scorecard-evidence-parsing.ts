import type { RunScorecard } from './types/run-scorecard';

export const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export const bool = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;

export function lifecycle(metadata: Record<string, unknown>): RunScorecard['lifecycle_status'] {
  const explicit = metadata.lifecycle_status ?? metadata.status ?? metadata.run_status;
  if (['queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out'].includes(String(explicit))) {
    return explicit as RunScorecard['lifecycle_status'];
  }
  const terminal = String(metadata.terminal_state ?? metadata.current_stage ?? '').toLowerCase();
  if (terminal.includes('cancel')) return 'cancelled';
  if (terminal.includes('timed out') || terminal.includes('timeout')) return 'timed_out';
  const exit = number(metadata.exit_code);
  return exit === undefined ? 'running' : exit === 0 ? 'completed' : 'failed';
}

export function statusFrom(metadata: Record<string, unknown>, keys: string[], nested?: unknown): 'passed' | 'failed' | 'unknown' {
  for (const value of [...keys.map(key => metadata[key]), object(nested)?.exit_code]) {
    if (value === 0 || value === true || value === 'passed' || value === 'success') return 'passed';
    if (typeof value === 'number' || value === false || value === 'failed') return 'failed';
  }
  return 'unknown';
}
