import { collectEvidence } from './run-scorecard';

describe('collectEvidence additional cases', () => {
  test('failure.json overrides metadata validation status', () => {
    const evidence = collectEvidence({
      json: {
        'metadata.json': { validation_exit_code: 0 },
        'failure.json': { validation_exit_code: 1 },
      },
      text: {},
      summaries: [],
    });
    expect(evidence.validation).toBe('failed');
  });

  test('aggregates phase durations from stage_timings correctly', () => {
    const evidence = collectEvidence({
      json: {
        'metadata.json': { instance: 'run-phases' },
        'timings-manifest.json': { stage_timings: [
          { stage: 'pi goal-setting agent', elapsed_seconds: 5 },
          { stage: 'pi coding agent', elapsed_seconds: 10 },
        ] },
      },
      text: {},
      summaries: [],
    });

    expect(evidence.phaseDurationsMs.goal_setting).toBe(5000);
    expect(evidence.phaseDurationsMs.coding).toBe(10000);
  });

  test('present includes keys from json and text snapshots', () => {
    const evidence = collectEvidence({
      json: { 'metadata.json': { instance: 'present-test' }, 'run-evaluation.json': {} },
      text: { 'git.diff': '+a\n' },
      summaries: [],
    });
    expect(evidence.present).toEqual(expect.arrayContaining(['metadata.json', 'run-evaluation.json', 'git.diff']));
  });

  test('counts unknown token requests when summaries lack usage', () => {
    const evidence = collectEvidence({
      json: { 'metadata.json': { instance: 'token-test', exit_code: 0 } },
      text: {},
      summaries: [
        { phase: 'coding', request_id: 'one', usage: { input: 10, output: 2 } },
        { phase: 'coding', request_id: 'two' }, // unknown
      ],
    });
    expect(evidence.unknownTokenRequests).toBeGreaterThanOrEqual(1);
  });
});
