import {
  buildValidationRecoveryQuestions,
  decideValidationRetry,
  parseRetrySafeCommands,
  prepareValidationFailureState,
  resolveValidationRecoveryMode,
} from './validation-recovery';

function choice(choiceValue: string, confidence: number, keys: string[]) {
  const probability = 1 / keys.length;
  return {
    type: 'choice' as const,
    choice: choiceValue,
    confidence,
    probabilities: Object.fromEntries(keys.map((key) => [key, probability])),
  };
}

describe('validation recovery policy', () => {
  const answers = {
    validation_failure_cause: choice('timeout_or_flaky', 0.96, ['test_failure', 'dependency_or_environment', 'timeout_or_flaky', 'implementation_logic', 'unknown']),
    validation_recovery_action: choice('retry_validation_once', 0.95, ['fix_implementation', 'repair_environment', 'retry_validation_once', 'inspect_diagnostics']),
  };

  test('defaults to observe mode and rejects unknown modes to observe', () => {
    expect(resolveValidationRecoveryMode(undefined)).toBe('observe');
    expect(resolveValidationRecoveryMode('unknown')).toBe('observe');
    expect(resolveValidationRecoveryMode('auto')).toBe('auto');
    expect(resolveValidationRecoveryMode('off')).toBe('off');
  });

  test('parses only a JSON array of exact safe command strings', () => {
    expect(parseRetrySafeCommands('["npm test", "npm run typecheck"]')).toEqual(['npm test', 'npm run typecheck']);
    expect(parseRetrySafeCommands('npm test')).toEqual([]);
    expect(parseRetrySafeCommands('["npm test", "", 1]')).toEqual([]);
  });

  test('defines diagnostic questions for one failure cause and one recovery action', () => {
    expect(Object.keys(buildValidationRecoveryQuestions())).toEqual([
      'validation_failure_cause',
      'validation_recovery_action',
    ]);
  });

  test('authorizes one repeat only for a high-confidence transient failure and exact safe command', () => {
    const result = decideValidationRetry({
      mode: 'auto',
      command: 'npm test',
      safeCommands: ['npm test'],
      answers,
      confidenceThreshold: 0.9,
      alreadyRetried: false,
    });
    expect(result).toMatchObject({ shouldRetry: true, reason: 'approved' });
  });

  test.each([
    ['observe mode', { mode: 'observe' as const, alreadyRetried: false }, 'observe_only'],
    ['command is not allowlisted', { mode: 'auto' as const, safeCommands: ['npm run test'] }, 'command_not_allowlisted'],
    ['classifier confidence is below threshold', { mode: 'auto' as const, confidenceThreshold: 0.97 }, 'confidence_below_threshold'],
    ['cause is not transient', { mode: 'auto' as const, answers: { ...answers, validation_failure_cause: choice('test_failure', 0.99, ['test_failure', 'dependency_or_environment', 'timeout_or_flaky', 'implementation_logic', 'unknown']) } }, 'cause_not_transient'],
    ['action does not recommend a repeat', { mode: 'auto' as const, answers: { ...answers, validation_recovery_action: choice('fix_implementation', 0.99, ['fix_implementation', 'repair_environment', 'retry_validation_once', 'inspect_diagnostics']) } }, 'action_not_retry'],
    ['command was already retried', { mode: 'auto' as const, alreadyRetried: true }, 'retry_limit_reached'],
  ])('does not retry when %s', (_label, overrides, expectedReason) => {
    const result = decideValidationRetry({
      mode: 'auto',
      command: 'npm test',
      safeCommands: ['npm test'],
      answers,
      confidenceThreshold: 0.9,
      alreadyRetried: false,
      ...overrides,
    });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toBe(expectedReason);
  });

  test('bounds and redacts classifier evidence without persisting the raw output', () => {
    const state = prepareValidationFailureState({
      command: 'npm test',
      exitCode: 1,
      output: `${'x'.repeat(10000)} Authorization: Bearer abcdefghijklmnop`,
    });
    expect(state.command).toBe('npm test');
    expect(state.exit_code).toBe(1);
    expect(JSON.stringify(state)).not.toContain('abcdefghijklmnop');
    expect(JSON.stringify(state).length).toBeLessThan(7000);
    expect(JSON.stringify(state)).toContain('[REDACTED_CREDENTIAL]');
  });
});
