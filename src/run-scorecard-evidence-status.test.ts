import { lifecycle, statusFrom } from './run-scorecard-evidence-status';

describe('run scorecard evidence status normalization', () => {
  describe('lifecycle', () => {
    test.each(['queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out'] as const)(
      'preserves explicit lifecycle status %s', status => {
        expect(lifecycle({ lifecycle_status: status })).toBe(status);
      },
    );

    test('uses status and run_status aliases when lifecycle_status is absent', () => {
      expect(lifecycle({ status: 'completed' })).toBe('completed');
      expect(lifecycle({ run_status: 'failed' })).toBe('failed');
    });

    test('prefers lifecycle_status over the other explicit aliases', () => {
      expect(lifecycle({ lifecycle_status: 'running', status: 'failed', run_status: 'completed' })).toBe('running');
    });

    test.each([
      ['cancelled', 'CANCELLED by operator'],
      ['timed_out', 'The run timed out'],
      ['timed_out', 'provider timeout'],
    ] as const)('normalizes terminal state %s from %s', (expected, terminal_state) => {
      expect(lifecycle({ terminal_state })).toBe(expected);
    });

    test('prefers cancellation and timeout terminal states over exit code', () => {
      expect(lifecycle({ terminal_state: 'cancelled', exit_code: 0 })).toBe('cancelled');
      expect(lifecycle({ current_stage: 'timed out', exit_code: 0 })).toBe('timed_out');
    });

    test.each([
      [{ exit_code: 0 }, 'completed'],
      [{ exit_code: 1 }, 'failed'],
      [{ exit_code: -1 }, 'failed'],
      [{}, 'running'],
    ] as const)('falls back to exit code or running state for %j', (metadata, expected) => {
      expect(lifecycle(metadata)).toBe(expected);
    });
  });

  describe('statusFrom', () => {
    test.each([
      [0, 'passed'],
      [true, 'passed'],
      ['passed', 'passed'],
      ['success', 'passed'],
    ] as const)('recognizes %j as passed', value => {
      expect(statusFrom({ result: value }, ['result'])).toBe('passed');
    });

    test.each([1, -1, 2, false, 'failed'] as const)('recognizes %j as failed', value => {
      expect(statusFrom({ result: value }, ['result'])).toBe('failed');
    });

    test('checks metadata keys in order and uses nested exit_code as a fallback', () => {
      expect(statusFrom({ first: 'unknown', second: 'success' }, ['first', 'second'])).toBe('passed');
      expect(statusFrom({}, ['result'], { exit_code: 0 })).toBe('passed');
      expect(statusFrom({}, ['result'], { exit_code: 1 })).toBe('failed');
    });

    test.each([undefined, null, 'pending', {}, []])('returns unknown for unsupported value %j', value => {
      expect(statusFrom({ result: value }, ['result'])).toBe('unknown');
    });

    test('returns unknown when no configured key or nested status is present', () => {
      expect(statusFrom({}, ['missing'], { state: 'pending' })).toBe('unknown');
    });
  });
});
