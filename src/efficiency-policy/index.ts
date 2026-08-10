import * as fs from 'fs';
import * as path from 'path';

export type PhaseName = 'goal-setting' | 'scouting' | 'coding' | 'goal-check' | 'run-evaluation' | string;

export interface PhaseEvidence {
  phase: PhaseName;
  model: string;
  tokens: number;
  elapsedMs: number;
  calls?: number;
  estimatedCostUsd?: number;
  usefulChanges?: number;
  requirementsCompleted?: number;
}

export interface ToolCallEvidence { tool: string; argumentsFingerprint: string; file?: string }

export interface RunEfficiencyEvidence {
  taskClass: string;
  model: string;
  phases: PhaseEvidence[];
  changedFiles: string[];
  scoutedFiles?: string[];
  changedLines?: number;
  requirementsBeforeGoalSetting?: string[];
  requirementsAfterGoalSetting?: string[];
  goalCheckRepairRequired?: boolean;
  validationPassed?: boolean;
  retries?: Array<{ phase: string; necessary: boolean; tokens: number; elapsedMs: number; estimatedCostUsd?: number }>;
  toolCalls?: ToolCallEvidence[];
  outcome: 'success' | 'failure';
}

export interface PhaseAggregate {
  samples: number;
  usefulSamples: number;
  repairSamples: number;
  tokens: number;
  elapsedMs: number;
  calls: number;
  estimatedCostUsd: number;
}

export interface AggregateBucket {
  taskClass: string;
  model: string;
  samples: number;
  phases: Record<string, PhaseAggregate>;
}

export interface EfficiencyPolicy {
  key: string;
  sampleSize: number;
  selected: Record<string, { enabled: boolean; model?: string; tokenCeiling?: number }>;
  recommendations: Array<{ phase: string; action: 'skip' | 'keep' | 'reduce-ceiling' | 'use-cheaper-model'; reason: string }>;
  counterfactual: { callsAvoided: number; tokensAvoided: number; latencyMsAvoided: number; estimatedCostUsdAvoided: number };
  metrics: {
    phases: Record<string, { tokens: number; elapsedMs: number; usefulChangeYieldPer1kTokens: number }>;
    scouting: { precision: number; recall: number };
    goalSettingMateriallyChangedRequirements: boolean;
    goalCheckCausedNecessaryRepair: boolean;
    repeatedReads: number;
    duplicateToolCalls: number;
    avoidableRetries: number;
    avoidableRetryTokens: number;
    avoidableEvaluatorCostUsd: number;
  };
}

export interface PolicyOptions {
  minimumSamples?: number;
  /** One-sided Wilson upper bound below this value permits skipping a phase. */
  lowValueUpperBound?: number;
  explicit?: Record<string, { enabled?: boolean; model?: string; tokenCeiling?: number }>;
  cheaperModels?: Record<string, string>;
}

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

export function emptyAggregate(taskClass: string, model: string): AggregateBucket {
  return { taskClass, model, samples: 0, phases: {} };
}

export function updateAggregate(bucket: AggregateBucket, run: RunEfficiencyEvidence): AggregateBucket {
  const next: AggregateBucket = JSON.parse(JSON.stringify(bucket)) as AggregateBucket;
  next.samples += 1;
  for (const phase of run.phases) {
    const current = next.phases[phase.phase] ?? { samples: 0, usefulSamples: 0, repairSamples: 0, tokens: 0, elapsedMs: 0, calls: 0, estimatedCostUsd: 0 };
    current.samples += 1;
    current.tokens += Math.max(0, phase.tokens);
    current.elapsedMs += Math.max(0, phase.elapsedMs);
    current.calls += Math.max(0, phase.calls ?? 1);
    current.estimatedCostUsd += Math.max(0, phase.estimatedCostUsd ?? 0);
    const useful = (phase.usefulChanges ?? 0) > 0 || (phase.requirementsCompleted ?? 0) > 0;
    if (useful) current.usefulSamples += 1;
    if (phase.phase === 'goal-check' && run.goalCheckRepairRequired) current.repairSamples += 1;
    next.phases[phase.phase] = current;
  }
  return next;
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

/** Stores only coarse class/model counters; prompts and requirement text are never persisted. */
export class EfficiencyPolicyStore {
  constructor(private readonly filePath: string) {}
  record(run: RunEfficiencyEvidence): AggregateBucket {
    let all: Record<string, AggregateBucket> = {};
    try {
      const stored: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      // JSON primitives and arrays are valid JSON, but not valid policy stores.
      // Treat them like a corrupt cache instead of dereferencing a null value below.
      if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
        all = stored as Record<string, AggregateBucket>;
      }
    } catch { /* first sample or corrupt cache */ }
    const key = `${run.taskClass}:${run.model}`;
    const updated = updateAggregate(all[key] ?? emptyAggregate(run.taskClass, run.model), run);
    all[key] = updated;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    return updated;
  }
}

export function renderEfficiencyMarkdown(policy: EfficiencyPolicy): string {
  const selected = Object.entries(policy.selected).sort(([a], [b]) => a.localeCompare(b)).map(([phase, value]) => `| ${phase} | ${value.enabled ? 'enabled' : 'skipped'} | ${value.model ?? 'unchanged'} |`).join('\n');
  return `## Efficiency policy\n\nAggregate key: \`${policy.key}\` (${policy.sampleSize} samples). Explicit operator settings take precedence.\n\n| Phase | Selection | Model |\n|---|---:|---|\n${selected}\n\nCounterfactual per run: ${policy.counterfactual.callsAvoided} calls, ${policy.counterfactual.tokensAvoided} tokens, ${policy.counterfactual.latencyMsAvoided} ms latency, and $${policy.counterfactual.estimatedCostUsdAvoided} estimated cost avoided.\n`;
}

/** Analyze one completed run, update its anonymous aggregate, and emit report artifacts. */
export function recordAndWriteEfficiencyPolicy(
  run: RunEfficiencyEvidence,
  aggregateFile: string,
  resultDirectory: string,
  options: PolicyOptions = {}
): EfficiencyPolicy {
  const aggregate = new EfficiencyPolicyStore(aggregateFile).record(run);
  const policy = analyzeEfficiency(run, aggregate, options);
  fs.mkdirSync(resultDirectory, { recursive: true });
  fs.writeFileSync(path.join(resultDirectory, 'efficiency-policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
  fs.writeFileSync(path.join(resultDirectory, 'efficiency-policy.md'), renderEfficiencyMarkdown(policy));
  return policy;
}
