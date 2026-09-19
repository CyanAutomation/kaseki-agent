import { object } from './run-scorecard-guards';

const phases = ['goal_setting', 'scouting', 'coding', 'validation', 'goal_check', 'run_evaluation'] as const;
function canonicalPhase(value: string): typeof phases[number] {
  const normalized = value.toLowerCase().replace(/[- ]/g, '_');
  return (phases as readonly string[]).includes(normalized) ? normalized as typeof phases[number] : 'coding';
}

/**
 * Extract provider retry counts from provider-attempts.jsonl
 * Each entry after attempt 1 is a retry for billing purposes
 */
export function providerRetryCounts(snapshot: { json: Record<string, unknown>; text: Record<string, string> }): Record<string, number> {
  const attempts = snapshot.text['provider-attempts.jsonl'] ?? '';
  const retriesByPhase = new Map<string, number>();
  for (const line of attempts.split(/\r?\n/)) {
    try {
      const entry = object(JSON.parse(line));
      if (!entry) continue;
      const match = String(entry.attempt ?? '').match(/(?:^|[-_])(\d+)$/);
      if (!match || Number(match[1]) <= 1) continue;
      const phase = canonicalPhase(String(entry.phase ?? 'coding'));
      // provider-attempts.jsonl records each provider invocation. Every
      // primary-N row after primary-1 is one extra billed inference attempt;
      // count rows, not words or artifact filenames.
      retriesByPhase.set(phase, (retriesByPhase.get(phase) ?? 0) + 1);
    } catch { /* a partially written JSONL line is not retry evidence */ }
  }
  return Object.fromEntries(retriesByPhase);
}

/**
 * Count total provider retries across all phases
 */
export function countRetries(snapshot: { json: Record<string, unknown>; text: Record<string, string> }): number {
  return Object.values(providerRetryCounts(snapshot)).reduce((total, retries) => total + retries, 0);
}
