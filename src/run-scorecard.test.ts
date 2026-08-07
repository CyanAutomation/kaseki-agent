import { assignGrade, buildScorecard, calculateCoverage, collectEvidence, normalizeConfig } from './run-scorecard';
import { RunScorecardSchema } from './types/run-scorecard';

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
  });
});
