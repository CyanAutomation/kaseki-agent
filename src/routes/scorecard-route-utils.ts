import type { ScorecardSummary } from '../kaseki-api-types';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface ScorecardFilters {
  lifecycleStatus?: string;
  grade?: string;
  rubricVersion?: string;
  model?: string;
  repository?: string;
  startedAfter?: string;
  startedBefore?: string;
}

export { DEFAULT_LIMIT, MAX_LIMIT };

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
    && (!filters.startedAfter || (item.startedAt !== null && item.startedAt >= filters.startedAfter))
    && (!filters.startedBefore || (item.startedAt !== null && item.startedAt <= filters.startedBefore));
}
