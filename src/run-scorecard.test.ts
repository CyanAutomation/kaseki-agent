import { assignGrade, buildScorecard, calculateCoverage, collectEvidence, normalizeConfig } from './run-scorecard';

describe('run scorecard', () => {
  test('deduplicates request usage and reports unknown requests', () => {
    const evidence = collectEvidence({
      json: {
        'metadata.json': { status: 'completed', quality_exit: 0 },
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
    expect(calculateCoverage(evidence).ratio).toBeGreaterThan(.7);
  });

  test('uses safe config defaults and stable grades', () => {
    const config = normalizeConfig({ KASEKI_SCORECARD_TARGET_SECONDS: '-1', KASEKI_SCORECARD_RUBRIC_VERSION: 'v2' });
    expect(config.targets.elapsedSeconds).toBe(1800);
    expect(config.rubricVersion).toBe('v2');
    expect(assignGrade(90)).toBe('A');
    const card = buildScorecard({ status: 'failed', unknownTokenRequests: 0, retries: 0, validation: 'failed', quality: 'unknown', changedFiles: 0, diffBytes: 0, present: ['metadata.json'] }, config, new Date('2026-01-01T00:00:00Z'));
    expect(card.status).toBe('failed');
    expect(card.coverage.missing).toContain('tokens');
  });
});
