/**
 * Tests for instance-failure-extraction.ts
 *
 * Covers:
 * - Failure reason extraction (validation, quality, goal-check)
 * - Provider failure classification
 * - Failure type classification with exit code and command patterns
 * - Edge cases: undefined metadata, null values, empty strings
 */

import {
  extractValidationFailureReason,
  extractValidationAllowlistFailureReason,
  extractQualityFailureReason,
  extractGoalCheckFailureReason,
  classifyFailure,
} from './instance-failure-extraction';
import { Metadata } from './instance-metadata-reader';

describe('instance-failure-extraction', () => {
  // ===== extractValidationFailureReason Tests =====
  describe('extractValidationFailureReason', () => {
    test('should extract validation failure reason from metadata', () => {
      const metadata: Metadata = {
        validation_failure_reason: 'npm test failed: assertion error',
      };
      expect(extractValidationFailureReason(metadata)).toBe('npm test failed: assertion error');
    });

    test('should trim whitespace from validation failure reason', () => {
      const metadata: Metadata = {
        validation_failure_reason: '  npm test failed  ',
      };
      expect(extractValidationFailureReason(metadata)).toBe('npm test failed');
    });

    test('should return null for empty string validation failure reason', () => {
      const metadata: Metadata = {
        validation_failure_reason: '',
      };
      expect(extractValidationFailureReason(metadata)).toBeNull();
    });

    test('should return null when validation_failure_reason is undefined', () => {
      const metadata: Metadata = {};
      expect(extractValidationFailureReason(metadata)).toBeNull();
    });

    test('should fall back to allowlist reason when validation reason is empty', () => {
      const metadata: Metadata = {
        validation_failure_reason: '',
        validation_allowlist_failure_reason: 'file not in allowlist: src/new-file.ts',
      };
      expect(extractValidationFailureReason(metadata)).toBe('file not in allowlist: src/new-file.ts');
    });

    test('should prefer validation reason over allowlist reason', () => {
      const metadata: Metadata = {
        validation_failure_reason: 'test failed',
        validation_allowlist_failure_reason: 'allowlist violation',
      };
      expect(extractValidationFailureReason(metadata)).toBe('test failed');
    });

    test('should handle undefined metadata gracefully', () => {
      expect(extractValidationFailureReason(undefined)).toBeNull();
    });

    test('should ignore non-string validation_failure_reason values', () => {
      const metadata: any = {
        validation_failure_reason: 123, // Invalid type
      };
      expect(extractValidationFailureReason(metadata)).toBeNull();
    });
  });

  // ===== extractValidationAllowlistFailureReason Tests =====
  describe('extractValidationAllowlistFailureReason', () => {
    test('should extract allowlist failure reason from metadata', () => {
      const metadata: Metadata = {
        validation_allowlist_failure_reason: 'file src/new-file.ts not in allowlist',
      };
      expect(extractValidationAllowlistFailureReason(metadata)).toBe(
        'file src/new-file.ts not in allowlist'
      );
    });

    test('should return null for empty allowlist failure reason', () => {
      const metadata: Metadata = {
        validation_allowlist_failure_reason: '',
      };
      expect(extractValidationAllowlistFailureReason(metadata)).toBeNull();
    });

    test('should return null when field is undefined', () => {
      expect(extractValidationAllowlistFailureReason({})).toBeNull();
    });

    test('should trim whitespace', () => {
      const metadata: Metadata = {
        validation_allowlist_failure_reason: '  allowlist violation  ',
      };
      expect(extractValidationAllowlistFailureReason(metadata)).toBe('allowlist violation');
    });
  });

  // ===== extractQualityFailureReason Tests =====
  describe('extractQualityFailureReason', () => {
    test('should extract quality failure reason from metadata', () => {
      const metadata: Metadata = {
        quality_failure_reason: 'diff exceeded max size: 500KB > 400KB',
      };
      expect(extractQualityFailureReason(metadata)).toBe(
        'diff exceeded max size: 500KB > 400KB'
      );
    });

    test('should return null when reason is empty', () => {
      const metadata: Metadata = {
        quality_failure_reason: '',
      };
      expect(extractQualityFailureReason(metadata)).toBeNull();
    });

    test('should return null when field is undefined', () => {
      expect(extractQualityFailureReason({})).toBeNull();
    });

    test('should trim whitespace', () => {
      const metadata: Metadata = {
        quality_failure_reason: '  diff too large  ',
      };
      expect(extractQualityFailureReason(metadata)).toBe('diff too large');
    });
  });

  // ===== extractGoalCheckFailureReason Tests =====
  describe('extractGoalCheckFailureReason', () => {
    test('should extract goal check failure reason from metadata', () => {
      const metadata: Metadata = {
        goal_check_failure_reason: 'goal not met: expected 5 tests, found 3',
      };
      expect(extractGoalCheckFailureReason(metadata)).toBe(
        'goal not met: expected 5 tests, found 3'
      );
    });

    test('should return null when reason is empty', () => {
      const metadata: Metadata = {
        goal_check_failure_reason: '',
      };
      expect(extractGoalCheckFailureReason(metadata)).toBeNull();
    });

    test('should return null when field is undefined', () => {
      expect(extractGoalCheckFailureReason({})).toBeNull();
    });

    test('should trim whitespace', () => {
      const metadata: Metadata = {
        goal_check_failure_reason: '  goal validation failed  ',
      };
      expect(extractGoalCheckFailureReason(metadata)).toBe('goal validation failed');
    });
  });

  // ===== classifyFailure Tests =====
  describe('classifyFailure', () => {
    // Success cases
    test('should return "none" for exit code 0', () => {
      expect(classifyFailure({}, 0)).toBe('none');
    });

    test('should return "none" for exit code "0"', () => {
      expect(classifyFailure({}, '0')).toBe('none');
    });

    // Timeout
    test('should classify exit code 124 as timeout', () => {
      expect(classifyFailure({}, 124)).toBe('timeout');
    });

    test('should classify exit code "124" as timeout', () => {
      expect(classifyFailure({}, '124')).toBe('timeout');
    });

    // Goal unmet
    test('should classify exit code 8 as goal-unmet', () => {
      expect(classifyFailure({}, 8)).toBe('goal-unmet');
    });

    test('should classify "goal check" command as goal-unmet', () => {
      expect(classifyFailure({ failed_command: 'goal check' }, null)).toBe('goal-unmet');
    });

    // Empty diff
    test('should classify "empty git diff" command as empty-diff', () => {
      expect(classifyFailure({ failed_command: 'empty git diff' }, null)).toBe('empty-diff');
    });

    test('should classify exit code 3 as empty-diff', () => {
      expect(classifyFailure({}, 3)).toBe('empty-diff');
    });

    // Validation
    test('should classify "validation" command as validation', () => {
      expect(classifyFailure({ failed_command: 'validation' }, null)).toBe('validation');
    });

    // Quality
    test('should classify "quality checks" command as quality', () => {
      expect(classifyFailure({ failed_command: 'quality checks' }, null)).toBe('quality');
    });

    // Secret scan
    test('should classify "secret scan" command as secret-scan', () => {
      expect(classifyFailure({ failed_command: 'secret scan' }, null)).toBe('secret-scan');
    });

    // GitHub
    test('should classify commands starting with "github" as github', () => {
      expect(classifyFailure({ failed_command: 'github operations' }, null)).toBe('github');
    });

    test('should classify "github_operations" as github', () => {
      expect(classifyFailure({ failed_command: 'github_operations' }, null)).toBe('github');
    });

    // Credentials
    test('should classify failed command with "llm_gateway" as credentials', () => {
      expect(classifyFailure({ failed_command: 'llm_gateway error' }, null)).toBe('credentials');
    });

    test('should classify failed command with "gateway" as credentials', () => {
      expect(classifyFailure({ failed_command: 'gateway timeout' }, null)).toBe('credentials');
    });

    test('should classify failed command with "openrouter" as credentials', () => {
      expect(classifyFailure({ failed_command: 'openrouter api error' }, null)).toBe('credentials');
    });

    test('should classify failed command with "api_key" as credentials', () => {
      expect(classifyFailure({ failed_command: 'api_key invalid' }, null)).toBe('credentials');
    });

    // Provider errors
    test('should classify model_unavailable provider error', () => {
      const metadata: Metadata = {
        provider_error_type: 'model_unavailable',
        failed_command: 'pi coding agent',
      };
      expect(classifyFailure(metadata, 1)).toBe('model-unavailable');
    });

    test('should classify "model is unavailable" in provider message', () => {
      const metadata: Metadata = {
        provider_error_message: 'Model is unavailable for your region',
        failed_command: 'pi coding agent',
      };
      expect(classifyFailure(metadata, 1)).toBe('model-unavailable');
    });

    test('should classify "no endpoints found" as model-unavailable', () => {
      const metadata: Metadata = {
        provider_error_message: 'No endpoints found for this model',
        failed_command: 'pi coding agent',
      };
      expect(classifyFailure(metadata, 1)).toBe('model-unavailable');
    });

    test('should classify generic provider error', () => {
      const metadata: Metadata = {
        provider_error_type: 'provider_error',
        provider_error_message: 'Rate limit exceeded',
        failed_command: 'pi coding agent',
      };
      expect(classifyFailure(metadata, 1)).toBe('provider-error');
    });

    // Generic failed command
    test('should convert failed command to kebab-case for unknown commands', () => {
      expect(classifyFailure({ failed_command: 'custom task with spaces' }, null)).toBe(
        'custom-task-with-spaces'
      );
    });

    // Unknown classification
    test('should return "nonzero-exit" when exit code is non-zero and no other classifier matches', () => {
      expect(classifyFailure({}, 127)).toBe('nonzero-exit');
    });

    test('should return "unknown" when no classification matches', () => {
      expect(classifyFailure({}, null)).toBe('unknown');
    });

    test('should return "unknown" for undefined metadata', () => {
      expect(classifyFailure(undefined, null)).toBe('unknown');
    });

    // Case insensitivity
    test('should classify gateway errors case-insensitively', () => {
      expect(classifyFailure({ failed_command: 'GATEWAY_ERROR' }, null)).toBe('credentials');
    });

    // Edge cases
    test('should handle whitespace in failed_command', () => {
      expect(classifyFailure({ failed_command: '  goal check  ' }, null)).toBe('goal-unmet');
    });

    test('should handle numeric exit codes as strings', () => {
      expect(classifyFailure({}, '124')).toBe('timeout');
    });

    test('should handle invalid exit code strings gracefully', () => {
      expect(classifyFailure({}, 'invalid')).toBe('unknown');
    });

    // Provider error combinations
    test('should prioritize provider error classification over exit code', () => {
      const metadata: Metadata = {
        provider_error_type: 'model_unavailable',
        failed_command: 'pi coding agent',
      };
      // Even though exit code 124 normally means timeout, provider error should take precedence
      expect(classifyFailure(metadata, 124)).toBe('model-unavailable');
    });

    test('should use diagnostic reason as fallback in provider error check', () => {
      const metadata: Metadata = {
        diagnostic_reason: 'model unavailable for your region',
        failed_command: 'pi coding agent',
      };
      expect(classifyFailure(metadata, 1)).toBe('model-unavailable');
    });

    // Multi-space replacements
    test('should collapse multiple spaces in failed command names', () => {
      expect(classifyFailure({ failed_command: 'some   weird   task' }, null)).toBe(
        'some-weird-task'
      );
    });
  });
});
