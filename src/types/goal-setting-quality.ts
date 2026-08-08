import type {
  GoalSettingOutput,
  QualityMetrics,
  SuccessCriterion,
} from './goal-setting';

export function calculateGoalQualityScore(goal: GoalSettingOutput | QualityMetrics): number {
  const metrics: QualityMetrics | undefined =
    'quality_metrics' in goal && goal.quality_metrics
      ? goal.quality_metrics
      : 'clarity' in goal && !('original_prompt' in goal)
        ? goal
        : undefined;

  if (!metrics) return 50;

  const scoreMap: Record<QualityMetrics[keyof QualityMetrics], number> = {
    high: 25,
    medium: 12.5,
    low: 0,
  };

  const levels: Array<QualityMetrics[keyof QualityMetrics]> = [
    metrics.clarity,
    metrics.measurability,
    metrics.specificity,
    metrics.scope_clarity,
    metrics.constraint_strength,
  ];
  return levels.reduce((score, level) => score + scoreMap[level], 0);
}

export function hasQualityWarnings(goal: GoalSettingOutput): string[] {
  const warnings: string[] = [];

  if (!goal.anti_patterns ||
      (!goal.anti_patterns.do_not_modify?.length &&
       !goal.anti_patterns.do_not_break?.length &&
       !goal.anti_patterns.must_preserve?.length)) {
    warnings.push('No explicit anti-patterns defined - recommended for safety');
  }
  if (!goal.examples || (!goal.examples.before && !goal.examples.after)) {
    warnings.push('No examples provided - recommended for clarity');
  }
  if (!goal.constraints ||
      (!goal.constraints.operational?.length &&
       !goal.constraints.architectural?.length &&
       !goal.constraints.technical?.length &&
       !goal.constraints.business?.length)) {
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
