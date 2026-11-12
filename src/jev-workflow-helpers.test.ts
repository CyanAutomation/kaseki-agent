import { buildGoalCriterionAssessments, buildGoalCheckOutcome, compactGoalSettingForEvaluation, failureDiagnosisFromAnswers, mapJevScoreToCompletion, selectConditionalHelper, selectCriterionEvidenceSources } from './jev-workflow-helpers';
import type { NoulAnswer } from './types/openrouter-decisions';

const noulAnswer = (noul: number): NoulAnswer => ({
  type: 'noul', noul, probabilities: { false: 1 - noul, true: noul }, confidence: null,
});

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
        criterion_1: noulAnswer(0.95),
        criterion_2: noulAnswer(0.62),
        criterion_3: noulAnswer(0.05),
        criterion_4: noulAnswer(0.8),
        criterion_5: noulAnswer(0.2),
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
      criterion_1: noulAnswer(0.39),
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

  test('selects conditional helpers in index order', () => {
    expect(selectConditionalHelper('first', 'second', 0)).toBe('first');
    expect(selectConditionalHelper('first', 'second', 1)).toBe('second');
  });

  test('marks a conditional criterion not applicable without treating it as unmet', () => {
    const criteria = [{ id: 'criterion_1', criterion: 'Add a verified alternative', appliesWhen: 'The candidate was rejected' }];
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

  test('does not accept a not-applicable choice when confidence is null', () => {
    const assessment = buildGoalCriterionAssessments([
      { id: 'criterion_1', criterion: 'Add an alternative', appliesWhen: 'The candidate was rejected' },
    ], {
      criterion_1_applicability: { type: 'choice', choice: 'not_applicable', probabilities: { not_applicable: 1, applicable: 0, unknown: 0 }, confidence: null },
    }, 0.8)[0];
    expect(assessment).toMatchObject({ applicability: 'unknown', status: 'unknown', met: false });
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
