import { normalizeSuccessCriteria, validateGoalContract } from './goal-contract.cjs';

describe('goal contract normalization', () => {
  it('normalizes string and structured criteria while preserving original indexes', () => {
    expect(normalizeSuccessCriteria([
      '  Verify the build  ',
      '',
      {
        criterion: ' Confirm the release ',
        applies_when: ' a release is requested ',
        source_requirement: ' changelog ',
        verification_sources: [' tests ', 1, '', ' build '],
      },
      { criterion: '   ' },
      { criterion: 'Keep the API stable', appliesWhen: 'the API is public', verificationSources: ['type tests'] },
    ])).toEqual([
      { id: 'criterion_1', criterion: 'Verify the build' },
      {
        id: 'criterion_3',
        criterion: 'Confirm the release',
        appliesWhen: 'a release is requested',
        sourceRequirement: 'changelog',
        verificationSources: ['tests', 'build'],
      },
      {
        id: 'criterion_5',
        criterion: 'Keep the API stable',
        appliesWhen: 'the API is public',
        verificationSources: ['type tests'],
      },
    ]);
  });

  it('requires valid criteria and an explicit outcome policy when requested', () => {
    expect(validateGoalContract({ success_criteria: ['Complete the change'] })).toMatchObject({
      valid: true,
      warnings: ['outcome_policy is missing; downstream checks will use the task-mode default'],
    });

    expect(validateGoalContract({ success_criteria: ['Complete the change'] }, { requireOutcomePolicy: true })).toMatchObject({
      valid: false,
      errors: ['outcome_policy must be change_required or change_or_noop'],
    });

    expect(validateGoalContract({ outcome_policy: 'unknown', success_criteria: [] })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        'outcome_policy must be change_required or change_or_noop',
        'success_criteria must contain at least one non-empty criterion',
      ]),
    });
  });

  it('rejects conditional criteria without applicability and no-change criteria under change-required policy', () => {
    const invalid = validateGoalContract({
      outcome_policy: 'change_required',
      success_criteria: [
        'If a release is requested, update the changelog',
        'No code changes are required',
      ],
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual([
      'success_criteria[0] is conditional and must declare applies_when',
      'success_criteria[1] conflicts with outcome_policy=change_required because it requires no code changes',
    ]);
  });
});
