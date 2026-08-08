import type {
  GoalSettingOutput,
  QualityMetrics,
  SuccessCriterion,
} from './goal-setting';

const QUALITY_LEVEL_SCORES: Record<QualityMetrics[keyof QualityMetrics], number> = {
  high: 25,
  medium: 12.5,
  low: 0,
};

function qualityMetricsFrom(goal: GoalSettingOutput | QualityMetrics): QualityMetrics | undefined {
  if ('quality_metrics' in goal && goal.quality_metrics) return goal.quality_metrics;
  if ('clarity' in goal && !('original_prompt' in goal)) return goal;
  return undefined;
}

function hasEntries(value: string[] | undefined): boolean {
  return Boolean(value?.length);
}

export function calculateGoalQualityScore(goal: GoalSettingOutput | QualityMetrics): number {
  const metrics = qualityMetricsFrom(goal);
  if (!metrics) return 50;

  const levels: Array<QualityMetrics[keyof QualityMetrics]> = [
    metrics.clarity,
    metrics.measurability,
    metrics.specificity,
    metrics.scope_clarity,
    metrics.constraint_strength,
  ];
  return levels.reduce((score, level) => score + QUALITY_LEVEL_SCORES[level], 0);
}

export function hasQualityWarnings(goal: GoalSettingOutput): string[] {
  const warnings: string[] = [];

  if (!goal.anti_patterns || ![
    goal.anti_patterns.do_not_modify,
    goal.anti_patterns.do_not_break,
    goal.anti_patterns.must_preserve,
  ].some(hasEntries)) {
    warnings.push('No explicit anti-patterns defined - recommended for safety');
  }
  if (!goal.examples || !goal.examples.before && !goal.examples.after) {
    warnings.push('No examples provided - recommended for clarity');
  }
  if (!goal.constraints || ![
    goal.constraints.operational,
    goal.constraints.architectural,
    goal.constraints.technical,
    goal.constraints.business,
  ].some(hasEntries)) {
    warnings.push('No constraints provided - recommended for architectural safety');
  }
  if (goal.success_criteria.some((criterion) =>
    typeof criterion !== 'string' && criterion.smart_score === 'low')) {
    warnings.push('Success criteria not measurable (low smart_score)');
  }
  if (goal.quality_metrics) {
    const metrics = goal.quality_metrics;
    if (metrics.clarity === 'low') warnings.push('Goal clarity is low');
    if (metrics.measurability === 'low') warnings.push('Success criteria not measurable');
    if (metrics.specificity === 'low') warnings.push('Goal specificity is low');
    if (metrics.scope_clarity === 'low') warnings.push('Scope boundaries are unclear');
    if (metrics.constraint_strength === 'low') warnings.push('Constraint strength is low');
  }
  return warnings;
}

export function getCriterionText(criterion: SuccessCriterion): string {
  return typeof criterion === 'string' ? criterion : criterion.criterion;
}
