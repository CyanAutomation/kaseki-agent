export const PHASE_METADATA = {
  goal_setting: { order: 0, aliases: /goal\s*[-_. ]?setting|goalsetting|goal.setting/i },
  scouting: { order: 1, aliases: /scouting/i },
  coding: { order: 2, aliases: /coding/i },
  validation: { order: 3, aliases: /validation/i },
  goal_check: { order: 4, aliases: /goal\s*[-_. ]?check|goalcheck/i },
  run_evaluation: { order: 5, aliases: /run\s*[-_. ]?evaluation|evaluation/i },
} as const;

export const PHASES = Object.keys(PHASE_METADATA) as Array<keyof typeof PHASE_METADATA>;
export const DIMENSIONS = ['goal_quality', 'scouting_quality', 'implementation_quality', 'validation_quality', 'goal_attainment', 'evaluation_quality'] as const;
export const WEIGHTS = [.15, .1, .3, .25, .15, .05] as const;

export function normalizePhase(value: string | undefined): typeof PHASES[number] {
  if (!value) return 'coding';
  const v = String(value);
  for (const phase of PHASES) {
    const meta = PHASE_METADATA[phase];
    if (meta.aliases.test(v)) return phase;
  }
  // Fallback to coding to be conservative
  return 'coding';
}

export default {
  PHASE_METADATA,
  PHASES,
  DIMENSIONS,
  WEIGHTS,
  normalizePhase,
};
