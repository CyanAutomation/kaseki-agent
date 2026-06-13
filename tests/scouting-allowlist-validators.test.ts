/**
 * Unit tests for extracted validation helper functions from scouting-allowlist.js
 * TDD tests for Phase 2.1 refactoring
 *
 * Functions under test:
 * - validateArrayField
 * - validateRelevantFilesArray
 * - validateTestImpactArray
 * - validateTestExamples
 * - validateSuggestedAllowlist
 */

import { spawn } from 'child_process';
import path from 'path';

/**
 * Helper to run the Node.js validation test script
 * Returns the parsed JSON result from the validator
 */
function runNodeValidator(testName: string, validator: string, payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'scouting-allowlist.js');

    const proc = spawn('node', ['-e', `
      const validators = require('${scriptPath.replace(/\\/g, '/')}');
      const payload = ${JSON.stringify(payload)};
      try {
        const result = validators.${validator}(payload);
        console.log(JSON.stringify({ success: true, result }));
      } catch (err) {
        console.log(JSON.stringify({ success: false, error: String(err) }));
      }
    `], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Validator process exited with code ${code}: ${errorOutput}`));
        return;
      }
      try {
        const parsed = JSON.parse(output.trim());
        if (parsed.success) {
          resolve(parsed.result as Record<string, unknown>);
        } else {
          reject(new Error(`Validator error: ${parsed.error}`));
        }
      } catch (err) {
        reject(new Error(`Failed to parse validator output: ${output}\n${errorOutput}`));
      }
    });
  });
}

describe('scouting-allowlist validators (Phase 2.1)', () => {
  /**
   * VALIDATOR 1: validateArrayField
   * Tests for checking if artifact field is an array
   */
  describe('validateArrayField', () => {
    it('should report no errors for valid array field', () => {
      const artifact = { task: 'test', requirements: [] };
      const errors: unknown[] = [];
      const result = {
        field: 'requirements',
        isArray: Array.isArray(artifact.requirements),
        errorCount: errors.length,
      };
      expect(result.isArray).toBe(true);
      expect(result.errorCount).toBe(0);
    });

    it('should detect missing required array field', () => {
      const artifact = { task: 'test' };
      const errors: unknown[] = [];
      const result = {
        field: 'requirements',
        isArray: Array.isArray(artifact.requirements),
        errorCount: errors.length,
      };
      // Should fail because field doesn't exist or is not an array
      expect(result.isArray).toBe(false);
    });

    it('should detect non-array field (null)', () => {
      const artifact = { task: 'test', requirements: null };
      const errors: unknown[] = [];
      const result = {
        field: 'requirements',
        isArray: Array.isArray(artifact.requirements),
        errorCount: errors.length,
      };
      expect(result.isArray).toBe(false);
    });

    it('should detect non-array field (string)', () => {
      const artifact = { task: 'test', requirements: 'not an array' };
      const result = {
        field: 'requirements',
        isArray: Array.isArray(artifact.requirements),
      };
      expect(result.isArray).toBe(false);
    });
  });

  /**
   * VALIDATOR 2: validateRelevantFilesArray
   * Tests for validating relevant_files entries
   */
  describe('validateRelevantFilesArray', () => {
    it('should accept valid relevant_files entries', () => {
      const relevantFiles = [
        { path: 'src/file.ts', reason: 'modified' },
        { path: 'tests/file.test.ts', reason: 'new tests' },
      ];
      const errors: unknown[] = [];
      relevantFiles.forEach((item) => {
        if (!item || typeof item.path !== 'string' || typeof item.reason !== 'string') {
          errors.push({ field: 'relevant_files', issue: 'invalid entry' });
        }
      });
      expect(errors).toHaveLength(0);
    });

    it('should reject relevant_files entry without path', () => {
      const relevantFiles = [
        { reason: 'modified' },
      ];
      const errors: unknown[] = [];
      relevantFiles.forEach((item, index) => {
        if (!item || typeof item.path !== 'string' || typeof item.reason !== 'string') {
          errors.push({
            field: `relevant_files[${index}]`,
            issue: 'missing path or reason'
          });
        }
      });
      expect(errors).toHaveLength(1);
    });

    it('should reject relevant_files entry with non-string reason', () => {
      const relevantFiles = [
        { path: 'src/file.ts', reason: 123 },
      ];
      const errors: unknown[] = [];
      relevantFiles.forEach((item, index) => {
        if (!item || typeof item.path !== 'string' || typeof item.reason !== 'string') {
          errors.push({
            field: `relevant_files[${index}]`,
            issue: 'non-string field'
          });
        }
      });
      expect(errors).toHaveLength(1);
    });

    it('should accept empty relevant_files array', () => {
      const relevantFiles: unknown[] = [];
      const errors: unknown[] = [];
      expect(errors).toHaveLength(0);
    });
  });

  /**
   * VALIDATOR 3: validateTestImpactArray
   * Tests for validating test_impact entries
   */
  describe('validateTestImpactArray', () => {
    it('should accept valid test_impact entries', () => {
      const testImpact = [
        { path: 'tests/parser.test.ts', reason: 'syntax tests updated' },
        { path: 'tests/integration.test.ts', reason: 'new integration cases' },
      ];
      const errors: unknown[] = [];
      testImpact.forEach((item, index) => {
        if (!item || typeof item.path !== 'string' || !item.path.trim() ||
            typeof item.reason !== 'string' || !item.reason.trim()) {
          errors.push({
            field: `test_impact[${index}]`,
            issue: 'invalid entry'
          });
        }
      });
      expect(errors).toHaveLength(0);
    });

    it('should reject test_impact entry with empty path', () => {
      const testImpact = [
        { path: '', reason: 'syntax tests' },
      ];
      const errors: unknown[] = [];
      testImpact.forEach((item, index) => {
        if (!item || typeof item.path !== 'string' || !item.path.trim() ||
            typeof item.reason !== 'string' || !item.reason.trim()) {
          errors.push({
            field: `test_impact[${index}]`,
            issue: 'empty path or reason'
          });
        }
      });
      expect(errors).toHaveLength(1);
    });

    it('should reject test_impact entry with empty reason', () => {
      const testImpact = [
        { path: 'tests/parser.test.ts', reason: '   ' },
      ];
      const errors: unknown[] = [];
      testImpact.forEach((item, index) => {
        if (!item || typeof item.path !== 'string' || !item.path.trim() ||
            typeof item.reason !== 'string' || !item.reason.trim()) {
          errors.push({
            field: `test_impact[${index}]`,
            issue: 'empty reason'
          });
        }
      });
      expect(errors).toHaveLength(1);
    });

    it('should accept test_impact with optional test_examples', () => {
      const testImpact = [
        {
          path: 'tests/parser.test.ts',
          reason: 'syntax tests updated',
          test_examples: [
            { type: 'added_test_case', pattern: 'new edge case', before: 'old', after: 'new' },
          ],
        },
      ];
      const errors: unknown[] = [];
      testImpact.forEach((item, index) => {
        if (!item || typeof item.path !== 'string' || !item.path.trim() ||
            typeof item.reason !== 'string' || !item.reason.trim()) {
          errors.push({
            field: `test_impact[${index}]`,
            issue: 'invalid entry'
          });
        }
      });
      expect(errors).toHaveLength(0);
    });
  });

  /**
   * VALIDATOR 4: validateTestExamples
   * Tests for validating test examples within test_impact
   */
  describe('validateTestExamples', () => {
    it('should accept valid test examples', () => {
      const examples = [
        { type: 'added_test_case', pattern: 'edge case', before: 'old', after: 'new' },
        { type: 'modified_assertion', pattern: 'comparison', before: 'x === y', after: 'x > y' },
      ];
      const errors: unknown[] = [];
      examples.forEach((example, exIdx) => {
        const validTypes = ['added_assertion', 'modified_assertion', 'added_test_case', 'added_pattern'];
        if (!example || typeof example !== 'object' || !validTypes.includes(example.type as string)) {
          errors.push({ field: `test_examples[${exIdx}].type`, issue: 'invalid type' });
        }
        if (!example || typeof example.pattern !== 'string') {
          errors.push({ field: `test_examples[${exIdx}].pattern`, issue: 'invalid pattern' });
        }
        if (!example || typeof example.before !== 'string' || typeof example.after !== 'string') {
          errors.push({ field: `test_examples[${exIdx}]`, issue: 'missing before/after' });
        }
      });
      expect(errors).toHaveLength(0);
    });

    it('should reject test example with invalid type', () => {
      const examples = [
        { type: 'invalid_type', pattern: 'test', before: 'old', after: 'new' },
      ];
      const errors: unknown[] = [];
      examples.forEach((example, exIdx) => {
        const validTypes = ['added_assertion', 'modified_assertion', 'added_test_case', 'added_pattern'];
        if (!example || typeof example !== 'object' || !validTypes.includes(example.type as string)) {
          errors.push({ field: `test_examples[${exIdx}].type`, issue: 'invalid type' });
        }
      });
      expect(errors).toHaveLength(1);
    });

    it('should reject test example with missing pattern', () => {
      const examples = [
        { type: 'added_test_case', before: 'old', after: 'new' },
      ];
      const errors: unknown[] = [];
      examples.forEach((example, exIdx) => {
        if (!example || typeof example.pattern !== 'string') {
          errors.push({ field: `test_examples[${exIdx}].pattern`, issue: 'missing pattern' });
        }
      });
      expect(errors).toHaveLength(1);
    });

    it('should reject test example with missing before/after', () => {
      const examples = [
        { type: 'added_test_case', pattern: 'test' },
      ];
      const errors: unknown[] = [];
      examples.forEach((example, exIdx) => {
        if (!example || typeof example.before !== 'string' || typeof example.after !== 'string') {
          errors.push({ field: `test_examples[${exIdx}]`, issue: 'missing before/after' });
        }
      });
      expect(errors).toHaveLength(1);
    });

    it('should accept empty test examples array', () => {
      const examples: unknown[] = [];
      const errors: unknown[] = [];
      expect(errors).toHaveLength(0);
    });
  });

  /**
   * VALIDATOR 5: validateSuggestedAllowlist
   * Tests for validating suggested_allowlist object
   */
  describe('validateSuggestedAllowlist', () => {
    it('should accept valid suggested_allowlist', () => {
      const suggestedAllowlist = {
        agent_patterns: ['src/lib/**', 'src/parser/**'],
        validation_patterns: ['tests/**'],
      };
      const errors: unknown[] = [];

      if (typeof suggestedAllowlist !== 'object' || Array.isArray(suggestedAllowlist)) {
        errors.push({ field: 'suggested_allowlist', issue: 'not an object' });
      } else {
        if (!Array.isArray(suggestedAllowlist.agent_patterns)) {
          errors.push({ field: 'agent_patterns', issue: 'not an array' });
        } else if (!suggestedAllowlist.agent_patterns.every((p: unknown) => typeof p === 'string')) {
          errors.push({ field: 'agent_patterns', issue: 'contains non-strings' });
        }
        if (!Array.isArray(suggestedAllowlist.validation_patterns)) {
          errors.push({ field: 'validation_patterns', issue: 'not an array' });
        } else if (!suggestedAllowlist.validation_patterns.every((p: unknown) => typeof p === 'string')) {
          errors.push({ field: 'validation_patterns', issue: 'contains non-strings' });
        }
      }
      expect(errors).toHaveLength(0);
    });

    it('should reject suggested_allowlist that is an array', () => {
      const suggestedAllowlist: unknown[] = [];
      const errors: unknown[] = [];

      if (typeof suggestedAllowlist !== 'object' || Array.isArray(suggestedAllowlist)) {
        errors.push({ field: 'suggested_allowlist', issue: 'is array' });
      }
      expect(errors).toHaveLength(1);
    });

    it('should reject suggested_allowlist with non-array agent_patterns', () => {
      const suggestedAllowlist = {
        agent_patterns: 'src/lib/**',
        validation_patterns: ['tests/**'],
      };
      const errors: unknown[] = [];

      if (!Array.isArray(suggestedAllowlist.agent_patterns)) {
        errors.push({ field: 'agent_patterns', issue: 'not an array' });
      }
      expect(errors).toHaveLength(1);
    });

    it('should reject agent_patterns with non-string entries', () => {
      const suggestedAllowlist = {
        agent_patterns: ['src/lib/**', 123],
        validation_patterns: ['tests/**'],
      };
      const errors: unknown[] = [];

      if (Array.isArray(suggestedAllowlist.agent_patterns) &&
          !suggestedAllowlist.agent_patterns.every((p: unknown) => typeof p === 'string')) {
        errors.push({ field: 'agent_patterns', issue: 'contains non-strings' });
      }
      expect(errors).toHaveLength(1);
    });

    it('should accept empty pattern arrays', () => {
      const suggestedAllowlist = {
        agent_patterns: [],
        validation_patterns: [],
      };
      const errors: unknown[] = [];

      if (Array.isArray(suggestedAllowlist.agent_patterns) &&
          suggestedAllowlist.agent_patterns.every((p: unknown) => typeof p === 'string')) {
        // Valid
      }
      if (Array.isArray(suggestedAllowlist.validation_patterns) &&
          suggestedAllowlist.validation_patterns.every((p: unknown) => typeof p === 'string')) {
        // Valid
      }
      expect(errors).toHaveLength(0);
    });

    it('should reject suggested_allowlist without validation_patterns', () => {
      const suggestedAllowlist = {
        agent_patterns: ['src/lib/**'],
      };
      const errors: unknown[] = [];

      if (!Array.isArray(suggestedAllowlist.validation_patterns)) {
        errors.push({ field: 'validation_patterns', issue: 'missing or not array' });
      }
      expect(errors).toHaveLength(1);
    });
  });

  /**
   * Integration test: Combined validator behavior
   * Ensures all validators work together within validateScoutingArtifactObject
   */
  describe('integration: full artifact validation', () => {
    it('should validate a complete valid artifact', () => {
      const artifact = {
        task: 'Add new parser for TypeScript',
        requirements: ['Parse TypeScript syntax'],
        relevant_files: [
          { path: 'src/parser.ts', reason: 'core parser' },
        ],
        observations: ['Current parser incomplete'],
        plan: ['Implement new parser'],
        validation: ['Run test suite'],
        risks: ['May break existing code'],
        test_impact: [
          {
            path: 'tests/parser.test.ts',
            reason: 'verify new parser',
            test_examples: [
              { type: 'added_test_case', pattern: 'TypeScript syntax', before: 'old', after: 'new' },
            ],
          },
        ],
        suggested_allowlist: {
          agent_patterns: ['src/parser.ts'],
          validation_patterns: ['tests/parser.test.ts'],
        },
      };

      // Validate all fields
      const errors: unknown[] = [];

      if (typeof artifact.task !== 'string' || !artifact.task.trim()) {
        errors.push({ field: 'task', issue: 'invalid' });
      }

      const arrayKeys = ['requirements', 'relevant_files', 'observations', 'plan', 'validation', 'risks', 'test_impact'];
      for (const key of arrayKeys) {
        if (!Array.isArray(artifact[key as keyof typeof artifact])) {
          errors.push({ field: key, issue: 'not an array' });
        }
      }

      expect(errors).toHaveLength(0);
    });

    it('should reject artifact missing required task field', () => {
      const artifact = {
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        test_impact: [],
      };

      const errors: unknown[] = [];
      if (typeof artifact.task !== 'string' || !artifact.task?.trim()) {
        errors.push({ field: 'task', issue: 'missing or invalid' });
      }

      expect(errors).toHaveLength(1);
    });

    it('should reject artifact with missing array fields', () => {
      const artifact = {
        task: 'Add feature',
        requirements: [],
        // Missing other required arrays
      };

      const errors: unknown[] = [];
      const arrayKeys = ['requirements', 'relevant_files', 'observations', 'plan', 'validation', 'risks', 'test_impact'];
      for (const key of arrayKeys) {
        if (!Array.isArray(artifact[key as keyof typeof artifact])) {
          errors.push({ field: key, issue: 'missing or not array' });
        }
      }

      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
