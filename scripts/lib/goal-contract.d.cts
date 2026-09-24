export interface GoalCriterion {
  id: string;
  criterion: string;
  appliesWhen?: string;
}

export interface GoalContractValidation {
  valid: boolean;
  outcomePolicy?: 'change_required' | 'change_or_noop';
  criteria: GoalCriterion[];
  errors: string[];
  warnings: string[];
}

export function normalizeSuccessCriteria(criteria: unknown): GoalCriterion[];
export function validateGoalContract(
  goal: unknown,
  options?: { requireOutcomePolicy?: boolean },
): GoalContractValidation;
