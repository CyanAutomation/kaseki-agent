import { bool, object } from './run-scorecard-evidence-utils';

export interface GoalCheckEvidence {
  goalCheckAvailable: boolean;
  goalCheckFailed: boolean;
  goalMet?: boolean;
}

export function collectGoalCheckEvidence(snapshot: any): GoalCheckEvidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  const goal = object(snapshot.json['goal-check.json']) ?? {};
  const goalCheckWarning = String(metadata.goal_check_evaluation_warning ?? '').trim();
  const goalCheckAvailable = Boolean(goal) && goal.evaluation_unavailable !== true
    && (!goalCheckWarning || goalCheckWarning.startsWith('goal_check_deterministic_fallback:'));
  return {
    goalCheckAvailable,
    goalCheckFailed: !goalCheckAvailable || String(metadata.failed_command ?? '').toLowerCase() === 'goal check'
      || String(metadata.goal_check_failure_reason ?? '').trim().length > 0,
    goalMet: goalCheckAvailable ? (bool(goal.met) ?? bool(metadata.goal_check_met)) : undefined,
  };
}
