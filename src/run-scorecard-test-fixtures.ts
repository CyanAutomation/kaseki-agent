import type { Evidence } from './run-scorecard-evidence-types';
import type { PHASES } from './run-scorecard-phases';

type Phase = typeof PHASES[number];
type EvidenceOverrides = Omit<Partial<Evidence>, 'phaseReached'> & {
  phaseReached?: Partial<Record<Phase, boolean>>;
};

const defaultPhaseReached = {
  goal_setting: false,
  scouting: false,
  coding: false,
  validation: false,
  goal_check: false,
  run_evaluation: false,
} satisfies Record<Phase, boolean>;

export function buildEvidence(overrides: EvidenceOverrides = {}): Evidence {
  const { phaseReached, ...evidenceOverrides } = overrides;
  return {
    metadata: {},
    status: 'completed',
    elapsedSeconds: 0,
    tokens: 0,
    tokenUsage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      unknown_tokens: 0,
      unavailable: false,
      completeness: 'complete',
    },
    phaseTokens: {},
    unknownTokenRequests: 0,
    retries: 0,
    phaseRetries: {},
    phaseDurationsMs: {},
    phaseReached: { ...defaultPhaseReached, ...phaseReached },
    validation: 'unknown',
    quality: 'unknown',
    goalMet: undefined,
    goalCheckAvailable: true,
    goalCheckFailed: false,
    noChangeAccepted: false,
    changedFiles: 0,
    diffBytes: 0,
    evaluation: undefined,
    evaluatorAvailable: true,
    present: [],
    ...evidenceOverrides,
  };
}
