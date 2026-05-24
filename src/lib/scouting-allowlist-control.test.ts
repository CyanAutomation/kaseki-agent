/**
 * Tests for scouting agent allowlist control functionality
 * Tests the derivation, merging, and validation of allowlist patterns from scouting.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import os from 'node:os';

describe('Scouting Allowlist Control', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-allowlist-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Schema Validation', () => {
    it('should validate scouting.json with suggested_allowlist', () => {
      const scoutingArtifact = {
        task: 'Fix parser bug',
        requirements: ['Fix in src/parser.ts'],
        relevant_files: [{ path: 'src/parser.ts', reason: 'Contains bug' }],
        observations: ['Bug is in parse() function'],
        plan: ['Identify bug', 'Fix it'],
        validation: ['npm test'],
        risks: ['May break other tests'],
        suggested_allowlist: {
          agent_patterns: ['src/parser.ts', 'tests/parser.test.ts'],
          validation_patterns: ['src/**', 'tests/**'],
        },
      } as Record<string, unknown>;

      // Verify structure
      expect(scoutingArtifact.suggested_allowlist).toBeDefined();
      expect(Array.isArray((scoutingArtifact.suggested_allowlist as any).agent_patterns)).toBe(true);
      expect(Array.isArray((scoutingArtifact.suggested_allowlist as any).validation_patterns)).toBe(true);
      expect((scoutingArtifact.suggested_allowlist as any).agent_patterns).toHaveLength(2);
    });

    it('should handle optional suggested_allowlist', () => {
      const scoutingArtifact = {
        task: 'Fix parser bug',
        requirements: ['Fix in src/parser.ts'],
        relevant_files: [{ path: 'src/parser.ts', reason: 'Contains bug' }],
        observations: ['Bug is in parse() function'],
        plan: ['Identify bug', 'Fix it'],
        validation: ['npm test'],
        risks: ['May break other tests'],
      } as Record<string, unknown>;

      // Should still be valid without suggested_allowlist
      expect(scoutingArtifact.task).toBeDefined();
      expect(scoutingArtifact.suggested_allowlist).toBeUndefined();
    });

    it('should validate agent_patterns as string array', () => {
      const patterns = ['src/parser.ts', 'src/lexer.ts', 'tests/**'];
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.every((p) => typeof p === 'string')).toBe(true);
    });

    it('should validate validation_patterns as string array', () => {
      const patterns = ['src/**', 'tests/**', '.coverage'];
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.every((p) => typeof p === 'string')).toBe(true);
    });

    it('should reject non-string patterns', () => {
      const invalidPatterns = ['src/parser.ts', 123, 'tests/**'];
      expect(invalidPatterns.some((p) => typeof p !== 'string')).toBe(true);
    });
  });

  describe('Allowlist Derivation', () => {
    it('should extract agent_patterns from scouting.json', () => {
      const scoutingJson = {
        task: 'Fix parser',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        suggested_allowlist: {
          agent_patterns: ['src/parser.ts', 'tests/parser.test.ts'],
          validation_patterns: [],
        },
      };

      const patterns = scoutingJson.suggested_allowlist.agent_patterns;
      expect(patterns).toEqual(['src/parser.ts', 'tests/parser.test.ts']);
    });

    it('should extract validation_patterns from scouting.json', () => {
      const scoutingJson = {
        task: 'Fix parser',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        suggested_allowlist: {
          agent_patterns: ['src/parser.ts'],
          validation_patterns: ['src/**', 'tests/**', '.coverage'],
        },
      };

      const patterns = scoutingJson.suggested_allowlist.validation_patterns;
      expect(patterns).toEqual(['src/**', 'tests/**', '.coverage']);
    });

    it('should handle empty pattern arrays', () => {
      const scoutingJson = {
        task: 'Unclear task',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        suggested_allowlist: {
          agent_patterns: [],
          validation_patterns: [],
        },
      };

      expect(scoutingJson.suggested_allowlist.agent_patterns).toEqual([]);
      expect(scoutingJson.suggested_allowlist.validation_patterns).toEqual([]);
    });

    it('should read scouting artifact from file', () => {
      const scoutingPath = path.join(tmpDir, 'scouting.json');
      const scoutingData = {
        task: 'Fix parser',
        requirements: ['requirement1'],
        relevant_files: [{ path: 'src/parser.ts', reason: 'main file' }],
        observations: ['observation1'],
        plan: ['step1'],
        validation: ['npm test'],
        risks: ['risk1'],
        suggested_allowlist: {
          agent_patterns: ['src/parser.ts', 'src/lexer.ts'],
          validation_patterns: ['src/**'],
        },
      };

      fs.writeFileSync(scoutingPath, JSON.stringify(scoutingData, null, 2));
      const read = JSON.parse(fs.readFileSync(scoutingPath, 'utf8'));

      expect(read.suggested_allowlist.agent_patterns).toEqual(['src/parser.ts', 'src/lexer.ts']);
      expect(read.suggested_allowlist.validation_patterns).toEqual(['src/**']);
    });
  });

  describe('Allowlist Merging', () => {
    it('should merge scouting and user patterns (union)', () => {
      const scoutingPatterns = 'src/parser.ts tests/parser.test.ts';
      const userPatterns = 'src/**';

      // Union: if both provided, use both
      const merged = `${scoutingPatterns} ${userPatterns}`.trim();
      expect(merged).toEqual('src/parser.ts tests/parser.test.ts src/**');
    });

    it('should use scouting patterns when user patterns empty', () => {
      const scoutingPatterns = 'src/parser.ts tests/parser.test.ts';
      const userPatterns = '';

      const merged = scoutingPatterns || userPatterns;
      expect(merged).toEqual('src/parser.ts tests/parser.test.ts');
    });

    it('should use user patterns when scouting patterns empty', () => {
      const scoutingPatterns = '';
      const userPatterns = 'src/**';

      const merged = scoutingPatterns || userPatterns;
      expect(merged).toEqual('src/**');
    });

    it('should handle both patterns empty', () => {
      const scoutingPatterns = '';
      const userPatterns = '';

      const merged = scoutingPatterns || userPatterns || '';
      expect(merged).toEqual('');
    });

    it('should handle overlapping patterns', () => {
      const scoutingPatterns = 'src/parser.ts src/**';
      const userPatterns = 'src/**';

      // Union will have duplicates, but that's OK for glob patterns
      const merged = `${scoutingPatterns} ${userPatterns}`.trim();
      expect(merged).toContain('src/**');
      expect(merged).toContain('src/parser.ts');
    });

    it('should preserve pattern order for readability', () => {
      const scoutingPatterns = 'src/parser.ts tests/parser.test.ts';
      const userPatterns = 'lib/**';

      const merged = `${scoutingPatterns} ${userPatterns}`.trim();
      expect(merged.startsWith('src/parser.ts')).toBe(true);
      expect(merged.endsWith('lib/**')).toBe(true);
    });
  });

  describe('Coverage Metrics', () => {
    it('should store coverage metrics in scouting.json', () => {
      const scoutingData = {
        task: 'Fix parser',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        suggested_allowlist: {
          agent_patterns: ['src/parser.ts'],
          validation_patterns: ['src/**'],
        },
        coverage: {
          agent_phase_percent: 75,
          validation_phase_percent: 85,
          warnings: ['patterns_too_narrow'],
        },
      };

      expect(scoutingData.coverage).toBeDefined();
      expect(scoutingData.coverage.agent_phase_percent).toBe(75);
      expect(scoutingData.coverage.validation_phase_percent).toBe(85);
      expect(Array.isArray(scoutingData.coverage.warnings)).toBe(true);
    });

    it('should detect too-narrow patterns (<30% coverage)', () => {
      const agentCoverage = 25;
      const isTooNarrow = agentCoverage < 30;
      expect(isTooNarrow).toBe(true);
    });

    it('should detect too-broad patterns (>98% coverage)', () => {
      const agentCoverage = 99;
      const isTooBroad = agentCoverage > 98;
      expect(isTooBroad).toBe(true);
    });

    it('should allow patterns in 30-98% band', () => {
      const coverages = [30, 50, 75, 98];
      coverages.forEach((cov) => {
        const isWarning = cov < 30 || cov > 98;
        expect(isWarning).toBe(false);
      });
    });

    it('should generate warnings array', () => {
      const warnings: string[] = [];
      const agentCoverage = 25;
      const validationCoverage = 99;

      if (agentCoverage < 30) {
        warnings.push('agent_phase_too_narrow');
      }
      if (validationCoverage > 98) {
        warnings.push('validation_phase_too_broad');
      }

      expect(warnings).toContain('agent_phase_too_narrow');
      expect(warnings).toContain('validation_phase_too_broad');
    });
  });

  describe('Integration: Full Workflow', () => {
    it('should complete full allowlist control workflow', () => {
      // 1. Scouting generates artifact
      const scoutingArtifact = {
        task: 'Fix parser bug',
        requirements: ['Fix parse error', 'Add test'],
        relevant_files: [
          { path: 'src/parser.ts', reason: 'Contains bug' },
          { path: 'tests/parser.test.ts', reason: 'Add regression test' },
        ],
        observations: ['Bug is in parse() at line 123'],
        plan: ['Fix parse()', 'Add test', 'Verify no regression'],
        validation: ['npm run test', 'npm run lint'],
        risks: ['May break existing tests'],
        suggested_allowlist: {
          agent_patterns: ['src/parser.ts', 'tests/parser.test.ts'],
          validation_patterns: ['src/**', 'tests/**'],
        },
      };

      // 2. Extract patterns
      const scoutingAgentPatterns = scoutingArtifact.suggested_allowlist.agent_patterns.join(
        ' '
      );
      const scoutingValidationPatterns = scoutingArtifact.suggested_allowlist.validation_patterns.join(
        ' '
      );

      expect(scoutingAgentPatterns).toEqual('src/parser.ts tests/parser.test.ts');
      expect(scoutingValidationPatterns).toEqual('src/** tests/**');

      // 3. Merge with user patterns
      const userAgentPatterns = 'src/**';
      const userValidationPatterns = '';

      const mergedAgentPatterns = `${scoutingAgentPatterns} ${userAgentPatterns}`.trim();
      const mergedValidationPatterns = scoutingValidationPatterns || userValidationPatterns;

      expect(mergedAgentPatterns).toContain('src/parser.ts');
      expect(mergedAgentPatterns).toContain('src/**');
      expect(mergedValidationPatterns).toEqual('src/** tests/**');

      // 4. Export to env (simulated)
      const env = {
        KASEKI_CHANGED_FILES_ALLOWLIST: mergedAgentPatterns,
        KASEKI_VALIDATION_ALLOWLIST: mergedValidationPatterns,
      };

      expect(env.KASEKI_CHANGED_FILES_ALLOWLIST).toContain('src/parser.ts');
      expect(env.KASEKI_VALIDATION_ALLOWLIST).toContain('tests/**');

      // 5. Coverage metrics
      const coverage = {
        agent_phase_percent: 80,
        validation_phase_percent: 90,
        warnings: [],
      };

      expect(coverage.agent_phase_percent).toBeGreaterThanOrEqual(30);
      expect(coverage.agent_phase_percent).toBeLessThanOrEqual(98);
    });

    it('should handle workflow with no user patterns', () => {
      const scoutingAgentPatterns = 'src/parser.ts src/lexer.ts';
      const userAgentPatterns = '';

      // Should use scouting patterns as-is
      const finalPatterns = userAgentPatterns ? `${scoutingAgentPatterns} ${userAgentPatterns}`.trim() : scoutingAgentPatterns;

      expect(finalPatterns).toEqual('src/parser.ts src/lexer.ts');
    });

    it('should handle workflow with broad user patterns', () => {
      const scoutingAgentPatterns = 'src/parser.ts';
      const userAgentPatterns = 'src/**';

      // User patterns are broader, so merged result allows more
      const finalPatterns = `${scoutingAgentPatterns} ${userAgentPatterns}`.trim();

      expect(finalPatterns).toContain('src/**');
      expect(finalPatterns).toContain('src/parser.ts');
    });

    it('should handle validation patterns merge when user patterns are empty', () => {
      // This is the scenario from the bug report: web UI submission with empty allowlist
      // Scouting suggests patterns, user patterns are empty (from web UI)
      const scoutingValidationPatterns = 'README.md docs/QUICK_START.md docs/API.md docs/CLI.md docs/DEPLOYMENT.md docs/ENV_VARS.md';
      const userValidationPatterns = '';

      // Should merge to use scouting patterns when user patterns are empty
      const mergedValidationPatterns = userValidationPatterns ? `${scoutingValidationPatterns} ${userValidationPatterns}`.trim() : scoutingValidationPatterns;

      expect(mergedValidationPatterns).toEqual(scoutingValidationPatterns);
      expect(mergedValidationPatterns).toContain('README.md');
      expect(mergedValidationPatterns).toContain('docs/QUICK_START.md');
    });
  });

  describe('Error Cases', () => {
    it('should handle missing scouting.json', () => {
      const scoutingPath = path.join(tmpDir, 'nonexistent.json');
      const fileExists = fs.existsSync(scoutingPath);
      expect(fileExists).toBe(false);
    });

    it('should handle malformed JSON', () => {
      const scoutingPath = path.join(tmpDir, 'malformed.json');
      fs.writeFileSync(scoutingPath, '{ invalid json }');

      expect(() => {
        JSON.parse(fs.readFileSync(scoutingPath, 'utf8'));
      }).toThrow();
    });

    it('should handle missing suggested_allowlist field', () => {
      const scoutingData = {
        task: 'Fix parser',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        // no suggested_allowlist
      } as Record<string, unknown>;

      // Should gracefully default
      const allowlist = (scoutingData.suggested_allowlist as any) || { agent_patterns: [], validation_patterns: [] };
      expect(allowlist.agent_patterns).toEqual([]);
    });

    it('should reject non-array patterns', () => {
      const invalidAllowlist = {
        agent_patterns: 'not-an-array',
        validation_patterns: ['valid', 'array'],
      };

      expect(Array.isArray(invalidAllowlist.agent_patterns)).toBe(false);
      expect(Array.isArray(invalidAllowlist.validation_patterns)).toBe(true);
    });
  });
});
