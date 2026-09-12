import { buildScorecard } from './run-scorecard-scoring';
import { normalizeConfig } from './run-scorecard-config';
import { buildEvidence } from './run-scorecard-test-fixtures';

describe('buildScorecard warnings', () => {
  test('includes missing evidence and token budget warning', () => {
    const evidence = buildEvidence({
      metadata: { instance: 'kaseki-1', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-01T00:01:00.000Z' },
      elapsedSeconds: 60,
      tokens: 5000,
      // tokenUsage must match RunScorecard token_totals schema
      tokenUsage: { input_tokens: 5000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, unknown_tokens: 0, unavailable: false, completeness: 'complete' },
      validation: 'unknown', quality: 'unknown', goalMet: undefined,
      present: ['metadata.json'],
      phaseReached: {
        goal_setting: true,
        scouting: true,
        coding: true,
        validation: true,
        goal_check: true,
        run_evaluation: true,
      },
    });
    const config = normalizeConfig({ KASEKI_SCORECARD_TARGET_TOKENS: '1000' });
    const card = buildScorecard(evidence, config);
    expect(Array.isArray(card.warnings)).toBe(true);
    const hasMissing = card.warnings.some(w => /Missing evidence: validation/.test(w));
    const hasToken = card.warnings.includes('Token budget exceeded: 5000 model tokens used versus 1000 target.');
    expect(hasMissing).toBe(true);
    expect(hasToken).toBe(true);
  });
});
