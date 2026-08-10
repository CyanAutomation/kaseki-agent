import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeEfficiency, EfficiencyPolicyStore, emptyAggregate, renderEfficiencyMarkdown, updateAggregate, type RunEfficiencyEvidence } from './index';

const fixture = (repair: boolean): RunEfficiencyEvidence => ({
  taskClass: 'typescript-fix', model: 'large-model', outcome: 'success',
  changedFiles: ['src/fixed.ts'], scoutedFiles: ['src/fixed.ts', 'src/noise.ts'], changedLines: 12,
  requirementsBeforeGoalSetting: ['fix bug'], requirementsAfterGoalSetting: ['fix bug'], goalCheckRepairRequired: repair,
  phases: [
    { phase: 'goal-setting', model: 'large-model', tokens: 1_000, elapsedMs: 2_000, calls: 1, estimatedCostUsd: 0.02 },
    { phase: 'goal-check', model: 'large-model', tokens: 500, elapsedMs: 1_000, calls: 1, estimatedCostUsd: 0.01, usefulChanges: repair ? 1 : 0 },
  ],
  retries: [{ phase: 'scouting', necessary: false, tokens: 100, elapsedMs: 50, estimatedCostUsd: 0.001 }],
  toolCalls: [
    { tool: 'read_file', file: 'src/fixed.ts', argumentsFingerprint: 'fixed' },
    { tool: 'read_file', file: 'src/fixed.ts', argumentsFingerprint: 'fixed' },
  ], validationPassed: true,
});

test('removes consistently low-value goal-setting but retains omission-catching goal-check', () => {
  let aggregate = emptyAggregate('typescript-fix', 'large-model');
  for (let index = 0; index < 100; index += 1) aggregate = updateAggregate(aggregate, fixture(index < 35));
  const policy = analyzeEfficiency(fixture(true), aggregate, { minimumSamples: 20, lowValueUpperBound: 0.2 });
  expect(policy.selected['goal-setting'].enabled).toBe(false);
  expect(policy.selected['goal-check'].enabled).toBe(true);
  expect(policy.counterfactual).toMatchObject({ callsAvoided: 1, tokensAvoided: 1000, latencyMsAvoided: 2000 });
  expect(policy.metrics).toMatchObject({ repeatedReads: 1, duplicateToolCalls: 1, avoidableRetries: 1 });
  expect(renderEfficiencyMarkdown(policy)).toContain('estimated cost avoided');
});

test('explicit operator phase configuration always wins', () => {
  let aggregate = emptyAggregate('typescript-fix', 'large-model');
  for (let index = 0; index < 100; index += 1) aggregate = updateAggregate(aggregate, fixture(false));
  const policy = analyzeEfficiency(fixture(false), aggregate, { explicit: { 'goal-setting': { enabled: true, model: 'operator-model', tokenCeiling: 9000 } } });
  expect(policy.selected['goal-setting']).toEqual({ enabled: true, model: 'operator-model', tokenCeiling: 9000 });
});

test.each(['null', '[]'])('replaces a non-object aggregate store without crashing (%s)', stored => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'efficiency-policy-'));
  const storePath = path.join(directory, 'aggregate.json');
  fs.writeFileSync(storePath, stored);

  try {
    const aggregate = new EfficiencyPolicyStore(storePath).record(fixture(false));
    expect(aggregate.samples).toBe(1);
    expect(JSON.parse(fs.readFileSync(storePath, 'utf8'))).toEqual({
      'typescript-fix:large-model': aggregate,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
