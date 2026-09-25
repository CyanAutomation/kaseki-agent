import { buildGoalCheckQuestions, buildGoalCriterionAssessments, buildGoalCheckOutcome, buildRunEvaluationQuestions, compactGoalSettingForEvaluation, failureDiagnosisFromAnswers, mapJevScoreToCompletion, selectConditionalHelper, selectCriterionEvidenceSources } from './jev-workflow-helpers';

describe('JEV workflow answer helpers', () => {
  test('compacts verbose goal-setting details while preserving the complete contract', () => {
    const goal = {
      original_prompt: 'Original request '.repeat(500),
      upgraded_goal: 'Consolidate duplicated positionOf helpers.',
      reasoning: 'Verbose explanation '.repeat(700),
      key_requirements: ['Keep behavior unchanged'],
      outcome_policy: 'change_required',
      success_criteria: [
        'One shared helper is used by all relevant call sites',
        { criterion: 'Focused tests pass', applies_when: 'The repository has a test command' },
      ],
    };

    const compacted = compactGoalSettingForEvaluation(goal, 8000);

    expect(compacted.compacted).toBe(true);
    expect(compacted.target_exceeded).toBe(false);
    expect(compacted.goal_setting.outcome_policy).toBe(goal.outcome_policy);
    expect(compacted.goal_setting.success_criteria).toEqual(goal.success_criteria);
    expect(JSON.stringify(compacted.goal_setting).length).toBeLessThanOrEqual(8000);
    expect(compacted.omitted_fields).toContain('reasoning');
  });

  test('never truncates success criteria when their required content exceeds the soft context target', () => {
    const goal = {
      outcome_policy: 'change_required',
      success_criteria: [`Criterion ${'detail '.repeat(1500)}`],
    };

    const compacted = compactGoalSettingForEvaluation(goal, 8000);

    expect(compacted.goal_setting.success_criteria).toEqual(goal.success_criteria);
    expect(compacted.target_exceeded).toBe(true);
  });

  test('maps JEV Score values from zero-based levels onto scorecard scale without rounding', () => {
    expect(mapJevScoreToCompletion(0)).toBe(1);
    expect(mapJevScoreToCompletion(1.05)).toBe(2.05);
    expect(mapJevScoreToCompletion(4)).toBe(5);
    expect(mapJevScoreToCompletion(4.5)).toBe(5);
  });

  test('distinguishes satisfied, uncertain, and clearly unmet success criteria', () => {
    expect(buildGoalCriterionAssessments(
      ['Adds a parser', 'Runs checks', 'Adds regression tests', 'Passes at the strict threshold', 'Fails at the unmet boundary'],
      {
        criterion_1: { type: 'noul', noul: 0.95 },
        criterion_2: { type: 'noul', noul: 0.62 },
        criterion_3: { type: 'noul', noul: 0.05 },
        criterion_4: { type: 'noul', noul: 0.8 },
        criterion_5: { type: 'noul', noul: 0.2 },
      },
      0.8,
    )).toEqual([
      { id: 'criterion_1', criterion: 'Adds a parser', probability: 0.95, threshold: 0.8, applicability: 'applicable', status: 'met', met: true },
      { id: 'criterion_2', criterion: 'Runs checks', probability: 0.62, threshold: 0.8, applicability: 'applicable', status: 'uncertain', met: false },
      { id: 'criterion_3', criterion: 'Adds regression tests', probability: 0.05, threshold: 0.8, applicability: 'applicable', status: 'unmet', met: false },
      { id: 'criterion_4', criterion: 'Passes at the strict threshold', probability: 0.8, threshold: 0.8, applicability: 'applicable', status: 'met', met: true },
      { id: 'criterion_5', criterion: 'Fails at the unmet boundary', probability: 0.2, threshold: 0.8, applicability: 'applicable', status: 'unmet', met: false },
    ]);
  });

  test('keeps the unmet boundary below the configured pass threshold for low custom thresholds', () => {
    const assessment = buildGoalCriterionAssessments(['A criterion'], {
      criterion_1: { type: 'noul', noul: 0.39 },
    }, 0.4)[0];
    expect(assessment.status).toBe('unmet');
  });

  test('keeps unresolved criteria separate from confirmed unmet criteria in the overall outcome', () => {
    expect(buildGoalCheckOutcome([
      { id: 'criterion_1', criterion: 'A', probability: 0.95, threshold: 0.8, applicability: 'applicable', status: 'met', met: true },
      { id: 'criterion_2', criterion: 'B', probability: 0.53, threshold: 0.8, applicability: 'applicable', status: 'uncertain', met: false },
    ])).toBe('uncertain');
    expect(buildGoalCheckOutcome([
      { id: 'criterion_1', criterion: 'A', probability: 0.95, threshold: 0.8, applicability: 'applicable', status: 'met', met: true },
      { id: 'criterion_2', criterion: 'B', probability: 0.13, threshold: 0.8, applicability: 'applicable', status: 'unmet', met: false },
    ])).toBe('unmet');
    expect(buildGoalCheckOutcome([
      { id: 'criterion_1', criterion: 'A', probability: null, threshold: 0.8, applicability: 'not_applicable', status: 'not_applicable', met: true },
    ])).toBe('met');
  });

  test('attaches available artifact references relevant to each criterion', () => {
    const sources = ['goal-setting.json', 'scouting.json', 'git.diff', 'changed-files.txt', 'validation.log', 'stderr.log'];
    expect(selectCriterionEvidenceSources('Existing unit tests pass and make vet is clean', sources)).toEqual(['validation.log']);
    expect(selectCriterionEvidenceSources('The documentation diff only changes approved files', sources)).toEqual(['git.diff', 'changed-files.txt']);
    expect(selectCriterionEvidenceSources('Rank the strongest duplication candidate with rationale', sources)).toEqual(['goal-setting.json', 'scouting.json']);
    expect(selectCriterionEvidenceSources('Consolidation reuses an existing exported abstraction and typecheck passes', sources)).toEqual([
      'git.diff', 'changed-files.txt', 'validation.log',
    ]);
    expect(selectCriterionEvidenceSources({
      id: 'criterion_1', criterion: 'A directly verifiable criterion',
      verificationSources: ['git.diff', 'validation.log', 'missing-artifact.json'],
    }, sources)).toEqual(['git.diff', 'validation.log']);
  });

  test('includes criterion provenance and verification sources in the classifier question', () => {
    const questions = buildGoalCheckQuestions([{
      id: 'criterion_1', criterion: 'The shared normalizer is reused',
      sourceRequirement: 'Prefer reusing an existing abstraction',
      verificationSources: ['git.diff', 'changed-files.txt'],
    }]);
    expect(questions.criterion_1?.instructions).toContain('Source requirement: Prefer reusing an existing abstraction');
    expect(questions.criterion_1?.instructions).toContain('Verify with: git.diff, changed-files.txt');
  });

  test('selects conditional helpers in index order', () => {
    expect(selectConditionalHelper('first', 'second', 0)).toBe('first');
    expect(selectConditionalHelper('first', 'second', 1)).toBe('second');
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
