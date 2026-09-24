import { applyScoringCap } from './run-scorecard-scoring-calculation';

describe('run scorecard deterministic score caps', () => {
  const reliable = { evaluatorReliabilityAvailable: true, diffBytes: 10, noChangeAccepted: false, validation: 'passed' as const, lifecycleStatus: 'completed' as const };

  test('applies the published cap when the diff is missing', () => {
    expect(applyScoringCap(100, { ...reliable, diffBytes: 0 })).toBe(69);
  });

  test('applies the published cap when validation is unknown', () => {
    expect(applyScoringCap(100, { ...reliable, validation: 'unknown' })).toBe(59);
  });

  test('applies the stricter cap when both diff and validation are missing', () => {
    expect(applyScoringCap(100, { ...reliable, diffBytes: 0, validation: 'unknown' })).toBe(49);
  });

  test('does not cap an explicitly accepted no-change run for a missing diff', () => {
    expect(applyScoringCap(100, { ...reliable, diffBytes: 0, noChangeAccepted: true })).toBe(100);
  });

  test('caps a failed run below a passing grade', () => {
    expect(applyScoringCap(100, { ...reliable, lifecycleStatus: 'failed' })).toBe(59);
  });

  test('caps a cancelled or timed out run below a passing grade', () => {
    expect(applyScoringCap(100, { ...reliable, lifecycleStatus: 'cancelled' })).toBe(59);
    expect(applyScoringCap(100, { ...reliable, lifecycleStatus: 'timed_out' })).toBe(59);
  });

  test('retains the evaluator reliability cap when evaluator evidence is unavailable', () => {
    expect(applyScoringCap(100, { ...reliable, evaluatorReliabilityAvailable: false })).toBe(89);
  });
});
