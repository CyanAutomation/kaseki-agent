import type { ClassificationAnswer, QuestionDefinition } from './types/openrouter-decisions';
import { normalizeSuccessCriteria } from '../scripts/lib/goal-contract.cjs';
import type { GoalCriterion } from '../scripts/lib/goal-contract.cjs';

export interface RunEvaluationFailureDiagnosis {
  cause: string;
  recommendedAction: string;
  confidence: number;
  causeProbabilities: Record<string, number>;
  actionProbabilities: Record<string, number>;
}

export interface GoalCriterionAssessment {
  id: string;
  criterion: string;
  applies_when?: string;
  probability: number | null;
  threshold: number;
  applicability: 'applicable' | 'not_applicable' | 'unknown';
  status: 'met' | 'unmet' | 'not_applicable' | 'unknown';
  met: boolean;
}

export interface GoalSettingCompaction {
  goal_setting: Record<string, unknown>;
  compacted: boolean;
  target_chars: number;
  actual_chars: number;
  target_exceeded: boolean;
  omitted_fields: string[];
}

/**
 * Keep the machine-checked goal contract intact while dropping verbose,
 * lower-value context to meet the evaluator's advisory payload target.
 */
export function compactGoalSettingForEvaluation(
  goal: Record<string, unknown>,
  targetChars = 8000,
): GoalSettingCompaction {
  const compactedGoal = { ...goal };
  const omittedFields: string[] = [];
  const protectedFields = new Set(['outcome_policy', 'success_criteria', 'upgraded_goal']);
  const preferredOmissionOrder = [
    'reasoning', 'original_prompt', 'constraints', 'anti_patterns', 'confidence',
    'key_requirements', 'assumptions', 'notes', 'context',
  ];
  const serializedLength = () => JSON.stringify(compactedGoal).length;
  const omit = (field: string) => {
    if (protectedFields.has(field) || !(field in compactedGoal)) return;
    delete compactedGoal[field];
    omittedFields.push(field);
  };

  for (const field of preferredOmissionOrder) {
    if (serializedLength() <= targetChars) break;
    omit(field);
  }
  if (serializedLength() > targetChars) {
    for (const field of Object.keys(compactedGoal)) {
      if (serializedLength() <= targetChars) break;
      omit(field);
    }
  }

  const actualChars = serializedLength();
  return {
    goal_setting: compactedGoal,
    compacted: omittedFields.length > 0,
    target_chars: targetChars,
    actual_chars: actualChars,
    target_exceeded: actualChars > targetChars,
    omitted_fields: omittedFields,
  };
}

export function mapJevScoreToCompletion(score: number, levelCount = 5): number {
  if (!Number.isFinite(score) || !Number.isInteger(levelCount) || levelCount < 1) return 1;
  return Math.min(levelCount, Math.max(1, score + 1));
}

export function buildGoalCriterionAssessments(
  criteriaInput: Array<string | GoalCriterion>,
  answers: Record<string, ClassificationAnswer>,
  threshold: number,
): GoalCriterionAssessment[] {
  const criteria = normalizeSuccessCriteria(criteriaInput);
  return criteria.map(({ id, criterion, appliesWhen }) => {
    const applicabilityAnswer = answers[`${id}_applicability`];
    const applicability = !appliesWhen
      ? 'applicable'
      : applicabilityAnswer?.type === 'choice' && ['applicable', 'not_applicable', 'unknown'].includes(applicabilityAnswer.choice)
        ? applicabilityAnswer.choice as GoalCriterionAssessment['applicability']
        : 'unknown';
    if (applicability === 'not_applicable') {
      return {
        id, criterion, ...(appliesWhen ? { applies_when: appliesWhen } : {}), probability: null, threshold,
        applicability, status: 'not_applicable', met: true,
      };
    }
    const answer = answers[id];
    const probability = answer?.type === 'noul' ? answer.noul : null;
    const status = applicability === 'unknown'
      ? 'unknown'
      : probability === null ? 'unknown' : probability >= threshold ? 'met' : 'unmet';
    return {
      id, criterion, ...(appliesWhen ? { applies_when: appliesWhen } : {}), probability, threshold,
      applicability, status, met: status === 'met',
    };
  });
}

export function buildGoalCheckQuestions(criteriaInput: Array<string | GoalCriterion>): Record<string, QuestionDefinition> {
  const criteria = normalizeSuccessCriteria(criteriaInput);
  return Object.fromEntries(criteria.flatMap(({ id, criterion, appliesWhen }) => [
    ...(appliesWhen ? [[`${id}_applicability`, {
      type: 'choice' as const,
      instructions: `Does this condition apply based on the supplied repository and run evidence? Condition: ${appliesWhen}`,
      criteria: {
        applicable: 'The condition applies, so assess the criterion.',
        not_applicable: 'The condition does not apply; do not require this criterion.',
        unknown: 'The evidence cannot establish whether the condition applies.',
      },
    } as QuestionDefinition]] : []),
    [id, {
      type: 'noul' as const,
      instructions: `Is this success criterion satisfied by the supplied repository and validation evidence? Criterion: ${criterion}${appliesWhen ? ` Applies when: ${appliesWhen}` : ''}`,
    } as QuestionDefinition],
  ]));
}

export function buildRunEvaluationQuestions(includeFailureDiagnosis: boolean): Record<string, QuestionDefinition> {
  return {
    overall_assessment: { type: 'choice', instructions: 'What is the overall quality of this completed coding run?', criteria: { excellent: 'Strong evidence and low review risk', good: 'Acceptable evidence with limited review risk', mixed: 'Material uncertainty or mixed signals', poor: 'Major evidence or process problems' } },
    reviewer_confidence: { type: 'choice', instructions: 'How much confidence should a human PR reviewer place in this run evidence?', criteria: { high: 'Validation and evidence strongly support the result', medium: 'Evidence is mixed and merits closer PR review', low: 'Evidence is weak and the PR needs careful review' } },
    task_completion_score: { type: 'score', instructions: 'How completely did the run satisfy its objective?', criteria: ['Largely unrealized', 'Major requirements unmet', 'Partially complete', 'Nearly complete', 'All requirements verified'] },
    ...(includeFailureDiagnosis ? {
      validation_failure_cause: { type: 'choice' as const, instructions: 'Based on the retained validation and failure evidence, what is the most likely cause? Treat this as a diagnostic hypothesis.', criteria: {
        test_failure: 'A test assertion or behavioral check failed.',
        type_or_lint_failure: 'Type checking, linting, or formatting failed.',
        build_failure: 'Compilation, bundling, or build failed.',
        dependency_or_environment: 'A dependency, service, platform, or environment problem caused the failure.',
        timeout_or_flaky: 'The evidence points to a timeout or intermittent failure.',
        implementation_logic: 'The code change appears to cause incorrect behavior.',
        unknown: 'The available evidence does not support a more specific cause.',
      } },
      validation_recovery_action: { type: 'choice' as const, instructions: 'What is the safest next diagnostic action for the coding workflow? This is advisory and does not authorize skipping user-specified validation or pausing for human input.', criteria: {
        fix_implementation: 'Correct the implementation, then rerun the requested checks.',
        repair_environment: 'Repair the dependency or environment issue, then rerun the requested checks.',
        retry_validation_once: 'Retry the same validation once to confirm a likely transient failure.',
        inspect_diagnostics: 'Use the retained logs and failure artifact to narrow the cause before changing code.',
      } },
    } : {}),
  };
}

export function failureDiagnosisFromAnswers(answers: Record<string, ClassificationAnswer>): RunEvaluationFailureDiagnosis | undefined {
  const cause = answers.validation_failure_cause;
  const action = answers.validation_recovery_action;
  if (cause?.type !== 'choice' || action?.type !== 'choice') return undefined;
  return {
    cause: cause.choice,
    recommendedAction: action.choice,
    confidence: Math.min(cause.confidence, action.confidence),
    causeProbabilities: cause.probabilities,
    actionProbabilities: action.probabilities,
  };
}
