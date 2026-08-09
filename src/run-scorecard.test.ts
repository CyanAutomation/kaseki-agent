import { assignGrade, buildScorecard, calculateCoverage, collectEvidence, normalizeConfig } from './run-scorecard';
import { RunScorecardSchema } from './types/run-scorecard';
import { lifecycle, statusFrom } from './run-scorecard-evidence-status';
import { bool, number, object } from './run-scorecard-evidence-values';
import { aggregateTokenUsage, countRetries, providerRetryCounts } from './run-scorecard-evidence-tokens';

describe('run scorecard', () => {
  test('deduplicates request usage and reports unknown requests', () => {
    const evidence = collectEvidence({
      json: {
        'metadata.json': { instance: 'run-1', started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-01T00:01:00Z', exit_code: 0, quality_exit_code: 0 },
        'timings-manifest.json': { validation_timings: [{ exit_code: 0, elapsed_seconds: 2 }], stage_timings: [{ elapsed_seconds: 10 }] },
        'goal-check.json': { met: true },
      },
      text: { 'changed-files.txt': 'src/a.ts\n', 'git.diff': '+change\n' },
      summaries: [
        { phase: 'coding', request_id: 'one', usage: { input: 100, output: 20, cacheRead: 5 } },
        { phase: 'coding', request_id: 'one', usage: { input: 100, output: 20, cacheRead: 5 } },
        { phase: 'goal-check', request_id: 'two' },
      ],
    });
    expect(evidence.tokens).toBe(125);
    expect(evidence.unknownTokenRequests).toBe(1);
    expect(evidence.tokenUsage.completeness).toBe('provisional');
    expect(evidence.validation).toBe('passed');
    expect(evidence.quality).toBe('passed');
    expect(evidence.status).toBe('completed');
    expect(calculateCoverage(evidence).ratio).toBeGreaterThan(.7);
  });

  test('uses safe config defaults and stable grades', () => {
    const config = normalizeConfig({ KASEKI_SCORECARD_TARGET_SECONDS: '-1', KASEKI_SCORECARD_RUBRIC_VERSION: 'v2' });
    expect(config.targets.elapsedSeconds).toBe(1800);
    expect(config.rubricVersion).toBe('v2');
    expect(assignGrade(90)).toBe('A');
    const evidence = collectEvidence({ json: { 'metadata.json': { instance: 'run-2', started_at: '2025-12-31T23:00:00Z', ended_at: '2026-01-01T00:00:00Z', exit_code: 1 } }, text: {}, summaries: [] });
    const card = buildScorecard(evidence, config, new Date('2026-01-01T00:00:00Z'));
    expect(card.lifecycle_status).toBe('failed');
    expect(card.token_totals.unavailable).toBe(true);
    expect(RunScorecardSchema.safeParse(card).success).toBe(true);
  });

  test('reads aggregate phase-summary token fields', () => {
    const evidence = collectEvidence({
      json: { 'metadata.json': { exit_code: 0, quality_exit_code: 0 } }, text: {},
      summaries: [{ phase: 'coding', usage: { total_input_tokens: 40, total_output_tokens: 5, total_cache_read_tokens: 3, total_cache_creation_tokens: 2, total_tokens: 50 } }],
    });
    expect(evidence.tokens).toBe(50);
    expect(evidence.unknownTokenRequests).toBe(0);
    expect(evidence.tokenUsage).toMatchObject({ input_tokens: 40, output_tokens: 5, cache_read_tokens: 3, cache_write_tokens: 2 });
    expect(evidence.tokenUsage.completeness).toBe('complete');
  });

  test('reduces confidence only when token requests are unknown', () => {
    const snapshot = {
      json: { 'metadata.json': { exit_code: 0 } },
      text: {},
      summaries: [{ phase: 'coding', request_id: 'known', usage: { input: 10, output: 2 } }],
    };
    const known = collectEvidence(snapshot);
    const unknown = collectEvidence({ ...snapshot, summaries: [...snapshot.summaries, { phase: 'coding', request_id: 'unknown' }] });
    const config = normalizeConfig({});

    expect(buildScorecard(known, config).confidence.score).toBe(25);
    expect(buildScorecard(unknown, config).confidence.score).toBe(23);
  });

  test('handles disabled phases and evaluator contradiction penalties', () => {
    const evidence = collectEvidence({
      json: {
        'metadata.json': { instance: 'disabled-run', exit_code: 0, disabled_phases: ['scouting'] },
        'goal-check.json': { met: true },
        'run-evaluation.json': { score: 95, contradictions: ['one', 'two'] },
      },
      text: { 'git.diff': '+change\n' },
      summaries: [],
    });
    const card = buildScorecard(evidence, normalizeConfig({}), new Date('2026-01-01T00:00:00Z'));
    expect(card.phases.scouting).toMatchObject({ enabled: false, outcome: 'skipped', completeness: 'not_applicable' });
    expect(card.dimensions.find(d => d.id === 'scouting_quality')).toMatchObject({ effective_weight: 0, status: 'not_applicable' });
    expect(card.dimensions.find(d => d.id === 'evaluation_quality')?.normalized_score).toBe(65);
  });

  test('marks active runs as not started and unknown evidence as provisional', () => {
    const evidence = collectEvidence({ json: { 'metadata.json': { lifecycle_status: 'running' } }, text: {}, summaries: [] });
    const card = buildScorecard(evidence, normalizeConfig({}), new Date('2026-01-01T00:00:00Z'));
    expect(card.ended_at).toBeNull();
    expect(Object.values(card.phases).every(phase => phase.outcome === 'not_started')).toBe(true);
    expect(card.completeness).toBe('provisional');
  });

  test('marks the goal-check phase failed when a terminal run failed there', () => {
    const evidence = collectEvidence({
      json: {
        'metadata.json': {
          lifecycle_status: 'failed',
          failed_command: 'goal check',
          goal_check_failure_reason: 'goal_check_artifact_missing',
        },
      },
      text: { 'git.diff': '+change\n' },
      summaries: [],
    });

    const card = buildScorecard(evidence, normalizeConfig({}), new Date('2026-01-01T00:00:00Z'));
    expect(card.phases.goal_check.outcome).toBe('failed');
  });

  test('normalizes lifecycle and status variants used by artifact producers', () => {
    expect(lifecycle({ lifecycle_status: 'queued' })).toBe('queued');
    expect(lifecycle({ terminal_state: 'timed out' })).toBe('timed_out');
    expect(lifecycle({ terminal_state: 'cancelled' })).toBe('cancelled');
    expect(lifecycle({ exit_code: 1 })).toBe('failed');
    expect(statusFrom({ validation_status: 'success' }, ['validation_status'])).toBe('passed');
    expect(statusFrom({ validation_exit: false }, ['validation_exit'])).toBe('failed');
    expect(statusFrom({}, ['validation_exit'])).toBe('unknown');
  });

  test('coerces only supported evidence value types', () => {
    expect(object({ value: 1 })).toEqual({ value: 1 });
    expect(object(null)).toBeUndefined();
    expect(object([])).toBeUndefined();
    expect(number(12.5)).toBe(12.5);
    expect(number(Number.NaN)).toBeUndefined();
    expect(number('12.5')).toBeUndefined();
    expect(bool(true)).toBe(true);
    expect(bool('true')).toBeUndefined();
  });

  test('aggregates token phases and counts only structured provider retries', () => {
    const snapshot = {
      json: { 'retry-diagnostics.json': {}, 'metadata.json': {} },
      text: { 'provider-attempts.jsonl': [
        '{"phase":"coding","attempt":"primary-1"}',
        '{"phase":"coding","attempt":"primary-2"}',
        '{"phase":"goal-check","attempt":"primary-1"}',
      ].join('\n') },
    };
    const aggregate = aggregateTokenUsage([
      { phase: 'goal-check', request_id: 'known', usage: { input: 10, output: 2 } },
      { phase: 'goal-check', request_id: 'known', usage: { input: 10, output: 2 } },
      { phase: 'validation', request_id: 'unknown' },
    ]);
    expect(aggregate.tokens).toBe(12);
    expect(aggregate.phaseTokens['goal_check'].output_tokens).toBe(2);
    expect(aggregate.unknownTokenRequests).toBe(1);
    expect(countRetries(snapshot)).toBe(1);
    expect(providerRetryCounts(snapshot)).toEqual({ coding: 1 });
  });

  test('counts a provider retry for each structured retry invocation in a phase', () => {
    const snapshot = {
      json: {},
      text: { 'provider-attempts.jsonl': [
        '{"phase":"goal-check","attempt":"primary-1"}',
        '{"phase":"goal-check","attempt":"primary-2"}',
        '{"phase":"goal-check","attempt":"primary-1"}',
        '{"phase":"goal-check","attempt":"primary-2"}',
      ].join('\n') },
    };
    expect(providerRetryCounts(snapshot)).toEqual({ goal_check: 2 });
    expect(countRetries(snapshot)).toBe(2);
  });

  test('ignores malformed and non-object provider-attempt records', () => {
    const snapshot = {
      json: {},
      text: { 'provider-attempts.jsonl': [
        '{malformed',
        'null',
        '[]',
        '{"phase":"coding","attempt":"primary-1"}',
        '{"phase":"coding","attempt":"primary-2"}',
      ].join('\n') },
    };

    expect(providerRetryCounts(snapshot)).toEqual({ coding: 1 });
  });

  test('uses every canonical ledger response instead of collapsing a request to one turn', () => {
    const aggregate = aggregateTokenUsage([
      { phase: 'coding', request_id: 'request-1', turn: 1, response_id: 'response-1', input_tokens: 10, output_tokens: 2, cache_read_tokens: 100, cache_creation_tokens: 0 },
      { phase: 'coding', request_id: 'request-1', turn: 2, response_id: 'response-2', input_tokens: 20, output_tokens: 3, cache_read_tokens: 200, cache_creation_tokens: 0 },
    ]);
    expect(aggregate.tokenUsage).toMatchObject({ input_tokens: 30, output_tokens: 5, cache_read_tokens: 300 });
  });
});
