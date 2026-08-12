import type { AggregateBucket, EfficiencyPolicy, PolicyOptions, RunEfficiencyEvidence } from './types';

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
const canonicalSet = (values: string[] = []): Set<string> => new Set(values.map(value => value.trim()).filter(Boolean));

function wilsonUpper(successes: number, total: number, z = 1.96): number {
  if (!total) return 1;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return (centre + margin) / denominator;
}

export function analyzeEfficiency(run: RunEfficiencyEvidence, aggregate: AggregateBucket, options: PolicyOptions = {}): EfficiencyPolicy {
  const changed = canonicalSet(run.changedFiles);
  const scouted = canonicalSet(run.scoutedFiles);
  const truePositive = [...scouted].filter(file => changed.has(file)).length;
  const duplicateKeys = (run.toolCalls ?? []).map(call => `${call.tool}\0${call.argumentsFingerprint}`);
  const duplicateToolCalls = duplicateKeys.length - new Set(duplicateKeys).size;
  const reads = (run.toolCalls ?? []).filter(call => /read|open|view/i.test(call.tool) && call.file).map(call => call.file!);
  const repeatedReads = reads.length - new Set(reads).size;
  const retries = run.retries ?? [];
  const avoidable = retries.filter(retry => !retry.necessary);
  const before = canonicalSet(run.requirementsBeforeGoalSetting);
  const after = canonicalSet(run.requirementsAfterGoalSetting);
  const materiallyChanged = before.size !== after.size || [...before].some(item => !after.has(item));
  const minimumSamples = options.minimumSamples ?? 20;
  const lowValueUpperBound = options.lowValueUpperBound ?? 0.2;
  const selected: EfficiencyPolicy['selected'] = {};
  const recommendations: EfficiencyPolicy['recommendations'] = [];
  const counterfactual = { callsAvoided: 0, tokensAvoided: 0, latencyMsAvoided: 0, estimatedCostUsdAvoided: 0 };

  for (const [name, stats] of Object.entries(aggregate.phases).sort(([a], [b]) => a.localeCompare(b))) {
    let enabled = true;
    const valuable = name === 'goal-check' ? stats.repairSamples : stats.usefulSamples;
    if (stats.samples >= minimumSamples && wilsonUpper(valuable, stats.samples) < lowValueUpperBound) {
      enabled = false;
      recommendations.push({ phase: name, action: 'skip', reason: `conservative value upper bound ${round(wilsonUpper(valuable, stats.samples))} is below ${lowValueUpperBound} across ${stats.samples} samples` });
      counterfactual.callsAvoided += stats.calls / stats.samples;
      counterfactual.tokensAvoided += stats.tokens / stats.samples;
      counterfactual.latencyMsAvoided += stats.elapsedMs / stats.samples;
      counterfactual.estimatedCostUsdAvoided += stats.estimatedCostUsd / stats.samples;
    } else {
      recommendations.push({ phase: name, action: 'keep', reason: stats.samples < minimumSamples ? `insufficient evidence (${stats.samples}/${minimumSamples} samples)` : `conservative evidence shows material value (${valuable}/${stats.samples})` });
    }
    selected[name] = { enabled };
  }

  for (const [phase, explicit] of Object.entries(options.explicit ?? {})) {
    selected[phase] = { ...selected[phase], ...explicit, enabled: explicit.enabled ?? selected[phase]?.enabled ?? true };
  }
  for (const [phase, model] of Object.entries(options.cheaperModels ?? {})) {
    if (!options.explicit?.[phase]?.model && selected[phase]?.enabled) selected[phase].model = model;
  }

  const phases = Object.fromEntries(run.phases.map(phase => [phase.phase, {
    tokens: phase.tokens,
    elapsedMs: phase.elapsedMs,
    usefulChangeYieldPer1kTokens: round((((phase.usefulChanges ?? 0) + (phase.requirementsCompleted ?? 0)) * 1000) / Math.max(1, phase.tokens)),
  }]));
  return {
    key: `${run.taskClass}:${run.model}`,
    sampleSize: aggregate.samples,
    selected,
    recommendations,
    counterfactual: Object.fromEntries(Object.entries(counterfactual).map(([key, value]) => [key, round(value)])) as EfficiencyPolicy['counterfactual'],
    metrics: {
      phases,
      scouting: { precision: round(truePositive / Math.max(1, scouted.size)), recall: round(truePositive / Math.max(1, changed.size)) },
      goalSettingMateriallyChangedRequirements: materiallyChanged,
      goalCheckCausedNecessaryRepair: Boolean(run.goalCheckRepairRequired),
      repeatedReads,
      duplicateToolCalls,
      avoidableRetries: avoidable.length,
      avoidableRetryTokens: avoidable.reduce((sum, retry) => sum + retry.tokens, 0),
      avoidableEvaluatorCostUsd: round(avoidable.reduce((sum, retry) => sum + (retry.estimatedCostUsd ?? 0), 0)),
    },
  };
}
