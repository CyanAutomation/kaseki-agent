import { TokenUsageAggregator, type UsageObject } from './pi-event-aggregation/token-usage-aggregator';
import type { RunScorecard } from './types/run-scorecard';

export interface ArtifactSnapshot { json: Record<string, unknown>; text: Record<string, string>; summaries: unknown[] }
export interface Evidence {
  metadata: Record<string, unknown>; status: RunScorecard['lifecycle_status']; elapsedSeconds?: number; tokens?: number;
  tokenUsage: RunScorecard['token_totals']; phaseTokens: Record<string, RunScorecard['token_totals']>;
  unknownTokenRequests: number; retries: number; validation: 'passed' | 'failed' | 'unknown'; quality: 'passed' | 'failed' | 'unknown';
  goalMet?: boolean; changedFiles: number; diffBytes: number; evaluation?: Record<string, unknown>; present: string[];
}

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const bool = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
const phases = ['goal_setting', 'scouting', 'coding', 'validation', 'goal_check', 'run_evaluation'] as const;

function normalizedUsage(raw: Record<string, unknown>): UsageObject {
  return {
    prompt_tokens: number(raw.prompt_tokens) ?? number(raw.total_input_tokens), completion_tokens: number(raw.completion_tokens) ?? number(raw.total_output_tokens),
    input: number(raw.input), output: number(raw.output), cacheRead: number(raw.cacheRead) ?? number(raw.total_cache_read_tokens),
    cacheWrite: number(raw.cacheWrite) ?? number(raw.total_cache_creation_tokens), prompt_tokens_details: object(raw.prompt_tokens_details) as UsageObject['prompt_tokens_details'],
  };
}
function hasUsage(value: UsageObject): boolean { return [value.prompt_tokens, value.completion_tokens, value.input, value.output, value.cacheRead, value.cacheWrite].some(item => number(item) !== undefined) || value.prompt_tokens_details !== undefined; }
function canonicalPhase(value: string): typeof phases[number] { const normalized = value.toLowerCase().replace(/[- ]/g, '_'); return (phases as readonly string[]).includes(normalized) ? normalized as typeof phases[number] : 'coding'; }
function lifecycle(metadata: Record<string, unknown>): RunScorecard['lifecycle_status'] {
  const explicit = metadata.lifecycle_status ?? metadata.status ?? metadata.run_status;
  if (['queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out'].includes(String(explicit))) return explicit as RunScorecard['lifecycle_status'];
  const terminal = String(metadata.terminal_state ?? metadata.current_stage ?? '').toLowerCase();
  if (terminal.includes('cancel')) return 'cancelled'; if (terminal.includes('timed out') || terminal.includes('timeout')) return 'timed_out';
  const exit = number(metadata.exit_code); return exit === undefined ? 'running' : exit === 0 ? 'completed' : 'failed';
}
function statusFrom(metadata: Record<string, unknown>, keys: string[], nested?: unknown): 'passed' | 'failed' | 'unknown' {
  for (const value of [...keys.map(key => metadata[key]), object(nested)?.exit_code]) {
    if (value === 0 || value === true || value === 'passed' || value === 'success') return 'passed';
    if (typeof value === 'number' || value === false || value === 'failed') return 'failed';
  }
  return 'unknown';
}

export function collectEvidence(snapshot: ArtifactSnapshot): Evidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {}; const timing = object(snapshot.json['timings-manifest.json']) ?? {};
  const perf = object(snapshot.json['performance-metrics.json']) ?? {}; const goal = object(snapshot.json['goal-check.json']) ?? {};
  const evaluation = object(snapshot.json['run-evaluation.json']); const stageRows = Array.isArray(timing.stage_timings) ? timing.stage_timings : [];
  const stageElapsed = stageRows.reduce((total, row) => total + (number(object(row)?.elapsed_seconds) ?? 0), 0);
  const elapsed = number(perf.elapsed_seconds) ?? number(metadata.total_duration_seconds) ?? number(metadata.duration_seconds) ?? (stageElapsed || undefined);
  const validationRows = [...(Array.isArray(timing.validation_timings) ? timing.validation_timings : []), ...(Array.isArray(timing.pre_validation_timings) ? timing.pre_validation_timings : [])];
  const validation = validationRows.length ? validationRows.every(row => (number(object(row)?.exit_code) ?? 0) === 0) ? 'passed' : 'failed' : statusFrom(metadata, ['validation_exit_code', 'validation_exit', 'validation_status']);
  const quality = statusFrom(metadata, ['quality_exit_code', 'quality_exit', 'quality_status'], object(metadata.phases)?.quality_gates);
  const aggregator = new TokenUsageAggregator(); const identities = new Set<string>(); let unknown = 0;
  snapshot.summaries.forEach((raw, index) => { const summary = object(raw); if (!summary) return; const phase = canonicalPhase(String(summary.phase ?? summary.stage ?? 'coding')); const identity = `${phase}:${String(summary.request_id ?? summary.response_id ?? summary.id ?? index)}`; if (identities.has(identity)) return; identities.add(identity); const usage = normalizedUsage(object(summary.usage) ?? object(summary.token_usage) ?? summary); if (!hasUsage(usage)) { unknown += 1; return; } aggregator.setCurrentPhase(phase); aggregator.recordUsage(String(summary.model ?? summary.selected_model ?? 'unknown'), usage); });
  const totals = aggregator.getSummary(); const phaseStats = aggregator.getPhaseStats(); const phaseTokens: Evidence['phaseTokens'] = {};
  for (const [phase, usage] of Object.entries(phaseStats)) phaseTokens[phase] = { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read_tokens: usage.cache_read_tokens, cache_write_tokens: usage.cache_creation_tokens, unknown_tokens: 0, unavailable: false, completeness: 'complete' };
  const retryText = Object.entries(snapshot.text).filter(([key]) => /attempt|retry|restoration/.test(key)).map(([, value]) => value).join('\n');
  return { metadata, status: lifecycle(metadata), elapsedSeconds: elapsed, tokens: totals.total_tokens || undefined, tokenUsage: { input_tokens: totals.total_input_tokens, output_tokens: totals.total_output_tokens, cache_read_tokens: totals.total_cache_read_tokens, cache_write_tokens: totals.total_cache_creation_tokens, unknown_tokens: unknown, unavailable: totals.total_tokens === 0, completeness: totals.total_tokens === 0 ? 'unavailable' : unknown > 0 ? 'provisional' : 'complete' }, phaseTokens, unknownTokenRequests: unknown, retries: Math.max(Object.keys(snapshot.json).filter(key => /attempt|retry|restoration/.test(key)).length, (retryText.match(/retry|attempt/gi) ?? []).length), validation, quality, goalMet: bool(goal.met) ?? bool(metadata.goal_check_met), changedFiles: (snapshot.text['changed-files.txt'] ?? '').split(/\r?\n/).filter(Boolean).length, diffBytes: Buffer.byteLength(snapshot.text['git.diff'] ?? ''), evaluation, present: [...Object.keys(snapshot.json), ...Object.keys(snapshot.text)] };
}
