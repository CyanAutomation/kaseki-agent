import type { ClassificationAnswer } from './types/openrouter-decisions';
import { answerConfidence } from './decision-answers';
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
  source_requirement?: string;
  verification_sources?: string[];
  probability: number | null;
  threshold: number;
  applicability: 'applicable' | 'not_applicable' | 'unknown';
  status: 'met' | 'unmet' | 'not_applicable' | 'uncertain' | 'unknown';
  met: boolean;
  evidence_sources?: string[];
}

export type GoalCheckOutcome = 'met' | 'unmet' | 'uncertain';

export function goalCheckUnmetThreshold(threshold: number): number {
  return Math.min(1 - threshold, threshold);
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
  return criteria.map(({ id, criterion, appliesWhen, sourceRequirement, verificationSources }) => {
    const applicabilityAnswer = answers[`${id}_applicability`];
    const applicability = !appliesWhen
      ? 'applicable'
      : applicabilityAnswer?.type === 'choice'
        && answerConfidence(applicabilityAnswer) >= threshold
        && ['applicable', 'not_applicable', 'unknown'].includes(applicabilityAnswer.choice)
        ? applicabilityAnswer.choice as GoalCriterionAssessment['applicability']
        : 'unknown';
    if (applicability === 'not_applicable') {
      return {
        id, criterion, ...(appliesWhen ? { applies_when: appliesWhen } : {}),
        ...(sourceRequirement ? { source_requirement: sourceRequirement } : {}),
        ...(verificationSources?.length ? { verification_sources: verificationSources } : {}), probability: null, threshold,
        applicability, status: 'not_applicable', met: true,
      };
    }
    const answer = answers[id];
    const probability = answer?.type === 'noul' ? answer.noul : null;
    const unmetThreshold = goalCheckUnmetThreshold(threshold);
    const status = applicability === 'unknown'
      ? 'unknown'
      : probability === null ? 'unknown'
        : probability >= threshold ? 'met'
          : probability <= unmetThreshold || Math.abs(probability - unmetThreshold) <= Number.EPSILON * 4 ? 'unmet' : 'uncertain';
    return {
      id, criterion, ...(appliesWhen ? { applies_when: appliesWhen } : {}),
      ...(sourceRequirement ? { source_requirement: sourceRequirement } : {}),
      ...(verificationSources?.length ? { verification_sources: verificationSources } : {}), probability, threshold,
      applicability, status, met: status === 'met',
    };
  });
}

export function buildGoalCheckOutcome(assessments: GoalCriterionAssessment[]): GoalCheckOutcome {
  if (assessments.some((assessment) => assessment.status === 'unmet')) return 'unmet';
  if (assessments.some((assessment) => assessment.status === 'uncertain' || assessment.status === 'unknown')) return 'uncertain';
  return 'met';
}

export function selectCriterionEvidenceSources(criterionInput: string | GoalCriterion, availableSources: string[]): string[] {
  const criterion = normalizeSuccessCriteria([criterionInput])[0];
  if (!criterion) return [];
  const text = criterion.criterion.toLowerCase();
  const relevant = new Set<string>();
  criterion.verificationSources?.forEach((source) => relevant.add(source));
  if (/test|validation|validated|verify|verification|vet|lint|build|command|check/.test(text)) {
    ['validation.log', 'validation-timings.tsv', 'pre-validation.log', 'pre-validation-timings.tsv'].forEach((source) => relevant.add(source));
  }
  if (/diff|file|changed|change|refactor|code|edit|documentation|docs|scope|consolidat|normaliz|import|reus|implement|function|helper|deduplicat/.test(text)) {
    ['git.diff', 'changed-files.txt'].forEach((source) => relevant.add(source));
  }
  if (/inventory|candidate|rank|rationale|plan|observation|requirement|success criterion/.test(text)) {
    ['goal-setting.json', 'scouting.json'].forEach((source) => relevant.add(source));
  }
  if (relevant.size === 0) {
    ['goal-setting.json', 'scouting.json', 'git.diff', 'validation.log'].forEach((source) => relevant.add(source));
  }
  return availableSources.filter((source) => relevant.has(source));
}

export function selectConditionalHelper(condition1: string, condition2: string, conditionIndex: number): string {
  return conditionIndex === 0 ? condition1 : condition2;
}


export function failureDiagnosisFromAnswers(answers: Record<string, ClassificationAnswer>): RunEvaluationFailureDiagnosis | undefined {
  const cause = answers.validation_failure_cause;
  const action = answers.validation_recovery_action;
  if (cause?.type !== 'choice' || action?.type !== 'choice') return undefined;
  return {
    cause: cause.choice,
    recommendedAction: action.choice,
    confidence: Math.min(cause.confidence ?? 0, action.confidence ?? 0),
    causeProbabilities: cause.probabilities,
    actionProbabilities: action.probabilities,
  };
}
