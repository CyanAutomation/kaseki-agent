import { aggregateStageDurations } from './stage-timings';

describe('aggregateStageDurations', () => {
  test('sums retry durations under the same phase and excludes baseline validation', () => {
    expect(aggregateStageDurations([
      'stage\texit_code\telapsed_seconds\tdetails',
      'pi coding agent\t0\t40\tattempt=1',
      'pi coding agent\t0\t28\tattempt=2',
      'validation\t0\t320\t',
      'validation retry after dependency repair\t0\t15\t',
      'pre-agent validation\t0\t100\t',
      'goal check\t0\t4\tattempt=1',
      'goal check\t0\t3\tattempt=2',
    ].join('\n'))).toEqual({
      coding: 68,
      validation: 335,
      'goal-check': 7,
    });
  });
});
