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
