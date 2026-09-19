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

    test('handles terminal_state that does not match known patterns', () => {
      // Terminal state is present but doesn't match 'cancel', 'timed out', or 'timeout'
      expect(lifecycle({ terminal_state: 'unknown error', exit_code: 0 })).toBe('completed');
      expect(lifecycle({ terminal_state: 'building...', exit_code: 1 })).toBe('failed');
    });

    test('uses current_stage as fallback for terminal state', () => {
      expect(lifecycle({ current_stage: 'CANCELLED' })).toBe('cancelled');
      expect(lifecycle({ current_stage: 'timeout detected' })).toBe('timed_out');
    });

    test('prefers terminal_state over current_stage', () => {
      expect(lifecycle({ terminal_state: 'timeout', current_stage: 'cancelled' })).toBe('timed_out');
    });

    test('converts non-string explicit status to string before checking', () => {
      // explicit lifecycle_status gets converted to string by the includes() check
      expect(lifecycle({ lifecycle_status: 123 as any })).toBe('running'); // '123' doesn't match, falls through
    });

    test('handles empty terminal_state', () => {
      expect(lifecycle({ terminal_state: '', exit_code: 0 })).toBe('completed');
      expect(lifecycle({ terminal_state: '', exit_code: 1 })).toBe('failed');
    });

    test('recognizes all explicit lifecycle values exactly', () => {
      expect(lifecycle({ lifecycle_status: 'queued' })).toBe('queued');
      expect(lifecycle({ status: 'running' })).toBe('running');
      expect(lifecycle({ run_status: 'completed' })).toBe('completed');
      expect(lifecycle({ lifecycle_status: 'failed' })).toBe('failed');
      expect(lifecycle({ lifecycle_status: 'cancelled' })).toBe('cancelled');
      expect(lifecycle({ lifecycle_status: 'timed_out' })).toBe('timed_out');
    });

    test('handles case-sensitive comparison for terminal states', () => {
      // terminal_state is converted to lowercase before pattern matching
      expect(lifecycle({ terminal_state: 'Timeout' })).toBe('timed_out');
      expect(lifecycle({ terminal_state: 'CANCELLED' })).toBe('cancelled');
      expect(lifecycle({ terminal_state: 'Cancel Cancel' })).toBe('cancelled');
    });

    test('distinguishes timed_out from timeout patterns', () => {
      // The function checks for 'timed out' (two words) and 'timeout' (one word)
      expect(lifecycle({ terminal_state: 'timed out' })).toBe('timed_out');
      expect(lifecycle({ terminal_state: 'timeout' })).toBe('timed_out');
      // 'timed_out' with underscore is not a recognized pattern, falls back to exit code
      expect(lifecycle({ terminal_state: 'timed_out', exit_code: 0 })).toBe('completed');
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

    test('stops at first matching key and does not check subsequent keys', () => {
      expect(statusFrom({ first: 0, second: 'failed' }, ['first', 'second'])).toBe('passed'); // first key wins
      expect(statusFrom({ first: 1, second: 0 }, ['first', 'second'])).toBe('failed'); // first key (1) is already a match
    });

    test('handles missing nested object gracefully', () => {
      expect(statusFrom({}, ['key'], null)).toBe('unknown');
      expect(statusFrom({}, ['key'], undefined)).toBe('unknown');
    });

    test('prioritizes recognized values over nested exit_code', () => {
      // If a key matches 'success', it returns immediately without checking nested
      expect(statusFrom({ explicit: 'success' }, ['explicit'], { exit_code: 1 })).toBe('passed');
    });

    test('uses only first matching key when multiple might apply', () => {
      // statusFrom should check keys in order and return on first match
      expect(statusFrom({ status: 'failed', result: 0 }, ['status', 'result'])).toBe('failed');
    });
  });
});
