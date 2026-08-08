import type { ScorecardSummary } from '../kaseki-api-types';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export interface ScorecardFilters {
  lifecycleStatus?: string;
  grade?: string;
  rubricVersion?: string;
  model?: string;
  repository?: string;
  startedAfter?: string;
  startedBefore?: string;
}

export function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const numeric = (value: unknown, fallback: number, maximum: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
  };
  return {
    limit: Math.max(1, numeric(query.limit, DEFAULT_LIMIT, MAX_LIMIT)),
    offset: numeric(query.offset, 0, 100_000),
  };
}

export function parseFilters(query: Record<string, unknown>): ScorecardFilters {
  const value = (key: keyof ScorecardFilters) => typeof query[key] === 'string' ? query[key] as string : undefined;
  return {
    lifecycleStatus: value('lifecycleStatus'), grade: value('grade'), rubricVersion: value('rubricVersion'),
    model: value('model'), repository: value('repository'), startedAfter: value('startedAfter'),
    startedBefore: value('startedBefore'),
  };
}

export function matchesFilters(item: ScorecardSummary, filters: ScorecardFilters): boolean {
  return (!filters.lifecycleStatus || item.lifecycleStatus === filters.lifecycleStatus)
    && (!filters.grade || item.grade === filters.grade)
    && (!filters.rubricVersion || item.rubricVersion === filters.rubricVersion)
    && (!filters.model || item.model === filters.model)
    && (!filters.repository || item.repository === filters.repository)
    && (!filters.startedAfter || item.startedAt >= filters.startedAfter)
    && (!filters.startedBefore || item.startedAt <= filters.startedBefore);
}
