import { buildGoalCheckQuestions, buildGoalCriterionAssessments, buildRunEvaluationQuestions, failureDiagnosisFromAnswers, mapJevScoreToCompletion } from './jev-workflow-helpers';

describe('JEV workflow answer helpers', () => {
  test('maps JEV Score values from zero-based levels onto scorecard scale without rounding', () => {
    expect(mapJevScoreToCompletion(0)).toBe(1);
    expect(mapJevScoreToCompletion(1.05)).toBe(2.05);
    expect(mapJevScoreToCompletion(4)).toBe(5);
    expect(mapJevScoreToCompletion(4.5)).toBe(5);
  });

  test('preserves each success criterion probability and its threshold decision', () => {
    expect(buildGoalCriterionAssessments(
      ['Adds a parser', 'Runs checks'],
      {
        criterion_1: { type: 'noul', noul: 0.95 },
        criterion_2: { type: 'noul', noul: 0.62 },
      },
      0.8,
    )).toEqual([
      { id: 'criterion_1', criterion: 'Adds a parser', probability: 0.95, threshold: 0.8, applicability: 'applicable', status: 'met', met: true },
      { id: 'criterion_2', criterion: 'Runs checks', probability: 0.62, threshold: 0.8, applicability: 'applicable', status: 'unmet', met: false },
    ]);
  });

  test('marks a conditional criterion not applicable without treating it as unmet', () => {
    const criteria = [{ id: 'criterion_1', criterion: 'Add a verified alternative', appliesWhen: 'The candidate was rejected' }];
    const questions = buildGoalCheckQuestions(criteria);
    expect(questions.criterion_1_applicability?.type).toBe('choice');
    expect(questions.criterion_1?.type).toBe('noul');

    expect(buildGoalCriterionAssessments(criteria, {
      criterion_1_applicability: { type: 'choice', choice: 'not_applicable', probabilities: { not_applicable: 0.97, applicable: 0.02, unknown: 0.01 }, confidence: 0.97 },
    }, 0.8)).toEqual([{
      id: 'criterion_1', criterion: 'Add a verified alternative', applies_when: 'The candidate was rejected',
      probability: null, threshold: 0.8, applicability: 'not_applicable', status: 'not_applicable', met: true,
    }]);
  });

  test('leaves an uncertain conditional criterion unresolved for review', () => {
    const assessment = buildGoalCriterionAssessments([
      { id: 'criterion_1', criterion: 'Add an alternative', appliesWhen: 'The candidate was rejected' },
    ], {
      criterion_1_applicability: { type: 'choice', choice: 'unknown', probabilities: { unknown: 1 }, confidence: 1 },
    }, 0.8)[0];
    expect(assessment.status).toBe('unknown');
    expect(assessment.met).toBe(false);
  });

  test('asks for failure triage only when failure evidence exists and marks it advisory', () => {
    const regularQuestions = buildRunEvaluationQuestions(false);
    const failureQuestions = buildRunEvaluationQuestions(true);
    expect(regularQuestions.validation_failure_cause).toBeUndefined();
    expect(failureQuestions.validation_failure_cause?.type).toBe('choice');
    expect(failureQuestions.validation_recovery_action?.instructions).toMatch(/advisory/i);
    expect(failureQuestions.validation_recovery_action?.instructions).toMatch(/pausing for human input/i);
  });

  test('turns failure answers into an advisory diagnostic carrying both distributions', () => {
    expect(failureDiagnosisFromAnswers({
      validation_failure_cause: { type: 'choice', choice: 'timeout_or_flaky', probabilities: { timeout_or_flaky: 0.9, test_failure: 0.1 }, confidence: 0.9 },
      validation_recovery_action: { type: 'choice', choice: 'retry_validation_once', probabilities: { retry_validation_once: 0.92, inspect_diagnostics: 0.08 }, confidence: 0.92 },
    })).toEqual({
      cause: 'timeout_or_flaky',
      recommendedAction: 'retry_validation_once',
      confidence: 0.9,
      causeProbabilities: { timeout_or_flaky: 0.9, test_failure: 0.1 },
      actionProbabilities: { retry_validation_once: 0.92, inspect_diagnostics: 0.08 },
    });
  });
});
