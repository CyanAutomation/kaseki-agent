import { normalizeSuccessCriteria, validateGoalContract } from '../scripts/lib/goal-contract.cjs';

describe('goal contract', () => {
  test('normalizes string and structured criteria without serializing SMART metadata into the criterion', () => {
    expect(normalizeSuccessCriteria([
      'The parser handles null input',
      { criterion: 'Run focused tests', smart_score: 'high', reasoning: 'Binary result', applies_when: 'A parser change is needed' },
    ])).toEqual([
      { id: 'criterion_1', criterion: 'The parser handles null input' },
      { id: 'criterion_2', criterion: 'Run focused tests', appliesWhen: 'A parser change is needed' },
    ]);
  });

  test('rejects a required-change goal that also requires zero code changes', () => {
    const result = validateGoalContract({
      outcome_policy: 'change_required',
      success_criteria: [
        { criterion: 'Refactor validateTechniques to use the shared helper' },
        { criterion: 'Ship zero code changes if the candidate is accepted' },
      ],
    }, { requireOutcomePolicy: true });

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/conflicts with outcome_policy=change_required/i);
  });

  test('allows scoped preservation criteria that prohibit unrelated changes', () => {
    const result = validateGoalContract({
      outcome_policy: 'change_required',
      success_criteria: [{ criterion: 'Make no code changes outside the parser directory' }],
    }, { requireOutcomePolicy: true });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('requires explicit applicability for conditional criteria', () => {
    const result = validateGoalContract({
      outcome_policy: 'change_or_noop',
      success_criteria: [{ criterion: 'If the candidate is rejected, add a verified alternative' }],
    }, { requireOutcomePolicy: true });

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/applies_when/i);
  });

  test('accepts an explicit change-or-noop policy and conditionally scoped criterion', () => {
    const result = validateGoalContract({
      outcome_policy: 'change_or_noop',
      success_criteria: [
        { criterion: 'Add a verified alternative', applies_when: 'The proposed candidate is rejected' },
        { criterion: 'Preserve current behavior' },
      ],
    }, { requireOutcomePolicy: true });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
