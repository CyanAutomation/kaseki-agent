import { buildDimensions, buildPhases, normalizeEvaluationScore, computeImplementationQualityScore } from './run-scorecard-scoring-parts';
import { normalizeConfig } from './run-scorecard-config';
import { buildEvidence } from './run-scorecard-test-fixtures';

describe('run-scorecard-scoring-parts', () => {
  test('disabled phases produce not_applicable dimensions and zero weight', () => {
    const evidence = buildEvidence({
      metadata: { disabled_phases: ['scouting'] },
      tokens: 100,
      tokenUsage: {
        input_tokens: 100,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        unknown_tokens: 0,
        unavailable: false,
        completeness: 'complete',
      },
      elapsedSeconds: 100,
      diffBytes: 10,
      validation: 'passed',
      quality: 'passed',
      evaluation: { score: 80 },
      goalMet: true,
      changedFiles: 1,
      phaseReached: {
        goal_setting: true,
        scouting: true,
        coding: true,
        validation: true,
        goal_check: true,
        run_evaluation: true,
      },
    });

    const config = normalizeConfig({} as NodeJS.ProcessEnv);
    const dims = buildDimensions(evidence, config);
    const scouting = dims.find(d => d.id === 'scouting_quality');
    expect(scouting).toBeDefined();
    expect(scouting.effective_weight).toBe(0);
    expect(scouting.status).toBe('not_applicable');
  });

  test('buildPhases marks validation failed and respects phase tokens availability', () => {
    const evidence = buildEvidence({
      validation: 'failed',
      evaluatorAvailable: false,
      phaseTokens: {
        validation: { input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, unknown_tokens: 0, unavailable: false, completeness: 'complete' },
      },
      phaseDurationsMs: { validation: 1500 },
      phaseReached: {
        goal_setting: false,
        scouting: false,
        coding: false,
        validation: true,
        goal_check: false,
        run_evaluation: true,
      },
    });

    const phases = buildPhases(evidence);
    expect(phases.validation.outcome).toBe('failed');
    expect(phases.validation.completeness).toBe('complete');
    expect(phases.validation.duration_ms).toBe(1500);
    // run_evaluation should be failed because evaluatorAvailable is false
    expect(phases.run_evaluation.outcome).toBe('failed');
    // a disabled phase should be marked not applicable if present
    const disabledEvidence = buildEvidence({ ...evidence, metadata: { disabled_phases: ['scouting'] } });
    const phases2 = buildPhases(disabledEvidence);
    expect(phases2.scouting.enabled).toBe(false);
    expect(phases2.scouting.outcome).toBe('skipped');
    expect(phases2.scouting.completeness).toBe('not_applicable');
  });

  test('buildPhases preserves an authoritative failed phase even when an artifact exists', () => {
    const evidence = buildEvidence({
      phaseFailures: { goal_setting: true },
      phaseReached: { goal_setting: true },
    });

    expect(buildPhases(evidence).goal_setting.outcome).toBe('failed');
  });

  describe('normalizeEvaluationScore', () => {
    it('uses 0–100 score directly', () => {
      const evidence = buildEvidence({ evaluation: { score: 75 } });
      expect(normalizeEvaluationScore(evidence)).toBe(75);
    });

    it('converts 1–5 completion scale to 0–100', () => {
      const evidence = buildEvidence({ evaluation: { task_completion_score: 3 } });
      expect(normalizeEvaluationScore(evidence)).toBe(60); // 3 * 20
    });

    it('prioritizes task_completion_score over score', () => {
      const evidence = buildEvidence({ evaluation: { task_completion_score: 4, score: 50 } });
      expect(normalizeEvaluationScore(evidence)).toBe(80); // 4 * 20
    });

    it('applies contradiction penalty (15 points each)', () => {
      const evidence = buildEvidence({ evaluation: { score: 90, contradictions: ['foo', 'bar'] } });
      expect(normalizeEvaluationScore(evidence)).toBe(60); // 90 - 15 - 15
    });

    it('uses 80 as default if evaluator is available but no score provided', () => {
      const evidence = buildEvidence({ evaluation: undefined, evaluatorAvailable: true });
      expect(normalizeEvaluationScore(evidence)).toBe(80);
    });

    it('uses 0 as default if evaluator is unavailable', () => {
      const evidence = buildEvidence({ evaluation: undefined, evaluatorAvailable: false });
      expect(normalizeEvaluationScore(evidence)).toBe(0);
    });

    it('clamps result to 0–100 range', () => {
      const evidence1 = buildEvidence({ evaluation: { score: 120 } });
      expect(normalizeEvaluationScore(evidence1)).toBe(100);

      const evidence2 = buildEvidence({ evaluation: { score: 10, contradictions: new Array(10).fill('x') } });
      expect(normalizeEvaluationScore(evidence2)).toBe(0); // Clamped to 0
    });
  });

  describe('computeImplementationQualityScore', () => {
    it('returns 100 if noChangeAccepted is true', () => {
      const evidence = buildEvidence({ noChangeAccepted: true });
      const config = normalizeConfig({} as NodeJS.ProcessEnv);
      expect(computeImplementationQualityScore(evidence, config)).toBe(100);
    });

    it('returns 0 if diffBytes is 0 and noChangeAccepted is false', () => {
      const evidence = buildEvidence({ diffBytes: 0, noChangeAccepted: false });
      const config = normalizeConfig({} as NodeJS.ProcessEnv);
      expect(computeImplementationQualityScore(evidence, config)).toBe(0);
    });

    it('calculates score based on efficiency metrics (time, tokens, retries)', () => {
      const evidence = buildEvidence({
        diffBytes: 100,
        elapsedSeconds: 100,
        retries: 0,
        tokenUsage: { input_tokens: 1000, output_tokens: 1000 },
      });
      const config = normalizeConfig({} as NodeJS.ProcessEnv);
      const score = computeImplementationQualityScore(evidence, config);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('returns higher score for efficient runs (low time, low tokens)', () => {
      const efficientEvidence = buildEvidence({
        diffBytes: 100,
        elapsedSeconds: 10,
        retries: 0,
        tokenUsage: { input_tokens: 100, output_tokens: 100 },
      });
      const inefficientEvidence = buildEvidence({
        diffBytes: 100,
        elapsedSeconds: 1000,
        retries: 5,
        tokenUsage: { input_tokens: 10000, output_tokens: 10000 },
      });
      const config = normalizeConfig({} as NodeJS.ProcessEnv);
      const efficientScore = computeImplementationQualityScore(efficientEvidence, config);
      const inefficientScore = computeImplementationQualityScore(inefficientEvidence, config);
      expect(efficientScore).toBeGreaterThan(inefficientScore);
    });
  });
});
