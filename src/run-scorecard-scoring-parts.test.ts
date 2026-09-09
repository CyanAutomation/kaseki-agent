import { buildDimensions, buildPhases } from './run-scorecard-scoring-parts';
import { normalizeConfig } from './run-scorecard-config';
import type { Evidence } from './run-scorecard-evidence-types';

describe('run-scorecard-scoring-parts', () => {
  test('disabled phases produce not_applicable dimensions and zero weight', () => {
    const evidence: Evidence = {
      metadata: { disabled_phases: ['scouting'] },
      present: [],
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
      unknownTokenRequests: 0,
      retries: 0,
      elapsedSeconds: 100,
      diffBytes: 10,
      validation: 'passed',
      quality: 'passed',
      evaluation: { score: 80 },
      evaluatorAvailable: true,
      phaseTokens: {},
      phaseDurationsMs: {},
      phaseRetries: {},
      status: 'completed',
      goalMet: true,
      goalCheckAvailable: true,
      goalCheckFailed: false,
      noChangeAccepted: false,
      changedFiles: 1,
    };

    const config = normalizeConfig({} as NodeJS.ProcessEnv);
    const dims = buildDimensions(evidence, config);
    const scouting = dims.find(d => d.id === 'scouting_quality');
    expect(scouting).toBeDefined();
    expect(scouting.effective_weight).toBe(0);
    expect(scouting.status).toBe('not_applicable');
  });

  test('buildPhases marks validation failed and respects phase tokens availability', () => {
    const evidence = {
      metadata: {},
      status: 'completed',
      validation: 'failed',
      goalCheckFailed: false,
      evaluatorAvailable: false,
      phaseTokens: {
        validation: { input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, unknown_tokens: 0, unavailable: false, completeness: 'complete' },
      },
      phaseDurationsMs: { validation: 1500 },
      phaseRetries: {},
    } as unknown as any;

    const phases = buildPhases(evidence);
    expect(phases.validation.outcome).toBe('failed');
    expect(phases.validation.completeness).toBe('complete');
    expect(phases.validation.duration_ms).toBe(1500);
    // run_evaluation should be failed because evaluatorAvailable is false
    expect(phases.run_evaluation.outcome).toBe('failed');
    // a disabled phase should be marked not applicable if present
    const disabledEvidence = { ...evidence, metadata: { disabled_phases: ['scouting'] } } as unknown as any;
    const phases2 = buildPhases(disabledEvidence);
    expect(phases2.scouting.enabled).toBe(false);
    expect(phases2.scouting.outcome).toBe('skipped');
    expect(phases2.scouting.completeness).toBe('not_applicable');
  });
});
