import type { ClassificationAnswer, QuestionDefinition } from './types/openrouter-decisions';

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
  probability: number | null;
  threshold: number;
  met: boolean;
}

export function mapJevScoreToCompletion(score: number, levelCount = 5): number {
  if (!Number.isFinite(score) || !Number.isInteger(levelCount) || levelCount < 1) return 1;
  return Math.min(levelCount, Math.max(1, score + 1));
}

export function buildGoalCriterionAssessments(
  criteria: string[],
  answers: Record<string, ClassificationAnswer>,
  threshold: number,
): GoalCriterionAssessment[] {
  return criteria.map((criterion, index) => {
    const id = `criterion_${index + 1}`;
    const answer = answers[id];
    const probability = answer?.type === 'noul' ? answer.noul : null;
    return { id, criterion, probability, threshold, met: probability !== null && probability >= threshold };
  });
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
