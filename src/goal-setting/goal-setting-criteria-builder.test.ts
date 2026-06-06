/**
 * Goal-setting criteria builder tests
 */

import {
  enhanceGoalWithBuildAndAsyncCriteria,
  createCompilationCriterion,
  createAsyncMockCriterion,
  createAsyncTestCriterion,
  validateGoalCriteria,
} from './goal-setting-criteria-builder';
import type { GoalSettingOutput } from '../types/goal-setting';
import type { BuildCapabilityInfo } from '../build-capability-detector';
import type { AsyncImpactAnalysis } from '../scouting/async-impact-analyzer';

describe('goal-setting-criteria-builder', () => {
  const baseGoal: GoalSettingOutput = {
    original_prompt: 'Fix the parser',
    upgraded_goal: 'Fix the parser to handle edge cases',
    key_requirements: ['Parse edge cases correctly'],
    success_criteria: ['Parser tests pass', 'No regressions'],
    reasoning: 'Parser needs robustness',
    confidence: 'high',
  };

  const mockBuildCapability: BuildCapabilityInfo = {
    language: 'typescript',
    command: 'npm run build',
    detected: true,
    detectedAt: Date.now(),
  };

  const mockAsyncImpact: AsyncImpactAnalysis = {
    hasAsyncChanges: true,
    asyncKeywords: ['async', 'await'],
    mockFiles: ['src/__mocks__/api.ts', 'src/mocks/http.ts'],
    testFiles: ['src/api.test.ts', 'src/http.test.ts', 'src/client.test.ts'],
    interfaceFiles: ['src/types/api.interface.ts'],
    consumerFiles: ['src/services/userService.ts'],
    summary: 'Async changes: 2 mocks, 3 tests, 1 interface affected',
  };

  describe('enhanceGoalWithBuildAndAsyncCriteria', () => {
    it('should add compilation criterion when build capability detected', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, mockBuildCapability, null);

      expect(enhanced.success_criteria.length).toBeGreaterThan(baseGoal.success_criteria?.length || 0);

      const compilationCriterion = enhanced.success_criteria?.find(
        c => (typeof c === 'object' && c.criterion.includes('Compilation')),
      );

      expect(compilationCriterion).toBeDefined();
      expect(typeof compilationCriterion === 'object' && compilationCriterion.criterion).toContain(
        'npm run build',
      );
    });

    it('should add async mock criterion when async impact detected', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, null, mockAsyncImpact);

      const mockCriterion = enhanced.success_criteria?.find(
        c => (typeof c === 'object' && c.criterion.toLowerCase().includes('mock')),
      );

      expect(mockCriterion).toBeDefined();
      if (typeof mockCriterion === 'object') {
        expect(mockCriterion.criterion).toContain('2 affected mock files');
      }
    });

    it('should add async test criterion when async impact detected', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, null, mockAsyncImpact);

      const testCriterion = enhanced.success_criteria?.find(
        c =>
          typeof c === 'object'
          && c.criterion.toLowerCase().includes('test')
          && c.criterion.toLowerCase().includes('async'),
      );

      expect(testCriterion).toBeDefined();
      if (typeof testCriterion === 'object') {
        expect(testCriterion.criterion).toContain('3');
        expect(testCriterion.criterion).toContain('test');
      }
    });

    it('should add interface criterion when async impact with interfaces detected', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, null, mockAsyncImpact);

      const interfaceCriterion = enhanced.success_criteria?.find(
        c => (typeof c === 'object' && c.criterion.toLowerCase().includes('interface')),
      );

      expect(interfaceCriterion).toBeDefined();
    });

    it('should combine build and async criteria together', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(
        baseGoal,
        mockBuildCapability,
        mockAsyncImpact,
      );

      expect(enhanced.success_criteria.length).toBeGreaterThanOrEqual(3);

      const compilationCriterion = enhanced.success_criteria?.some(
        c => (typeof c === 'object' && c.criterion.includes('Compilation')),
      );
      const mockCriterion = enhanced.success_criteria?.some(
        c => (typeof c === 'object' && c.criterion.toLowerCase().includes('mock')),
      );

      expect(compilationCriterion).toBe(true);
      expect(mockCriterion).toBe(true);
    });

    it('should enhance anti-patterns with build rules', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, mockBuildCapability, null);

      expect(enhanced.anti_patterns?.do_not_break).toBeDefined();
      expect(
        enhanced.anti_patterns?.do_not_break?.some(rule => rule.includes('Compilation')),
      ).toBe(true);
    });

    it('should enhance anti-patterns with async rules', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, null, mockAsyncImpact);

      expect(enhanced.anti_patterns?.do_not_modify).toBeDefined();
      expect(enhanced.anti_patterns?.do_not_break).toBeDefined();
      expect(enhanced.anti_patterns?.must_preserve).toBeDefined();

      expect(
        enhanced.anti_patterns?.do_not_modify?.some(rule => rule.includes('Async')),
      ).toBe(true);
      expect(
        enhanced.anti_patterns?.do_not_break?.some(rule => rule.includes('Mock')),
      ).toBe(true);
    });

    it('should prepend build requirement to key_requirements', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, mockBuildCapability, null);

      expect(enhanced.key_requirements[0]).toContain('npm run build');
    });

    it('should prepend async requirement to key_requirements', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, null, mockAsyncImpact);

      expect(enhanced.key_requirements[0]).toContain('Async changes:');
    });

    it('should not modify when neither build nor async detected', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(
        baseGoal,
        { language: null, command: null, detected: false, detectedAt: Date.now() },
        { hasAsyncChanges: false, asyncKeywords: [], mockFiles: [], testFiles: [], interfaceFiles: [], consumerFiles: [], summary: '' },
      );

      expect(enhanced.success_criteria.length).toBe(baseGoal.success_criteria?.length || 0);
    });

    it('should preserve existing criteria', () => {
      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, mockBuildCapability, null);

      const originalCriteria = baseGoal.success_criteria || [];
      const enhancedCriteria = enhanced.success_criteria || [];

      for (const original of originalCriteria) {
        expect(enhancedCriteria).toContain(original);
      }
    });
  });

  describe('createCompilationCriterion', () => {
    it('should create valid SMART criterion for compilation', () => {
      const criterion = createCompilationCriterion('typescript', 'npm run build');

      expect(criterion.criterion).toContain('npm run build');
      expect(criterion.smart_score).toBe('high');
      expect(criterion.reasoning).toBeDefined();
      expect(criterion.reasoning).toContain('typescript');
    });

    it('should handle different languages', () => {
      const ts = createCompilationCriterion('typescript', 'npm run build');
      const go = createCompilationCriterion('go', 'go build');
      const rust = createCompilationCriterion('rust', 'cargo build');

      expect(ts.criterion).toContain('npm run build');
      expect(go.criterion).toContain('go build');
      expect(rust.criterion).toContain('cargo build');
    });
  });

  describe('createAsyncMockCriterion', () => {
    it('should create valid SMART criterion for async mock compatibility', () => {
      const criterion = createAsyncMockCriterion(3, [
        'src/__mocks__/api.ts',
        'src/mocks/http.ts',
        'src/mocks/db.ts',
      ]);

      expect(criterion.criterion).toContain('3 affected mock files');
      expect(criterion.smart_score).toBe('high');
      expect(criterion.reasoning).toBeDefined();
      expect(criterion.reasoning).toContain('src/__mocks__/api.ts');
    });

    it('should limit examples in reasoning', () => {
      const criterion = createAsyncMockCriterion(10, [
        'file1.ts',
        'file2.ts',
        'file3.ts',
        'file4.ts',
        'file5.ts',
      ]);

      // Should include first 3 examples
      expect(criterion.reasoning).toContain('file1.ts');
      expect(criterion.reasoning).toContain('file2.ts');
      expect(criterion.reasoning).toContain('file3.ts');
      // Might not include file4 due to limit
    });
  });

  describe('createAsyncTestCriterion', () => {
    it('should create valid SMART criterion for async test updates', () => {
      const criterion = createAsyncTestCriterion(5, [
        'src/api.test.ts',
        'src/http.test.ts',
        'src/client.test.ts',
      ]);

      expect(criterion.criterion).toContain('5 affected test files');
      expect(criterion.smart_score).toBe('high');
      expect(criterion.reasoning).toBeDefined();
      expect(criterion.reasoning).toContain('src/api.test.ts');
    });
  });

  describe('validateGoalCriteria', () => {
    it('should pass when build criterion exists and build detected', () => {
      const goalWithBuild: GoalSettingOutput = {
        ...baseGoal,
        success_criteria: [
          'Parser tests pass',
          { criterion: 'Compilation succeeds with npm run build', smart_score: 'high' },
        ],
      };

      const errors = validateGoalCriteria(goalWithBuild, true, false);
      expect(errors.length).toBe(0);
    });

    it('should fail when build criterion missing but build detected', () => {
      const errors = validateGoalCriteria(baseGoal, true, false);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Compilation');
    });

    it('should pass when async criteria exist', () => {
      const goalWithAsync: GoalSettingOutput = {
        ...baseGoal,
        success_criteria: [
          'Parser tests pass',
          { criterion: 'Mock files updated', smart_score: 'high' },
          { criterion: 'Test assertions updated for async', smart_score: 'high' },
        ],
      };

      const errors = validateGoalCriteria(goalWithAsync, false, true);
      expect(errors.length).toBe(0);
    });

    it('should fail when async mock criterion missing', () => {
      const errors = validateGoalCriteria(baseGoal, false, true);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('mock'))).toBe(true);
    });

    it('should fail when async test criterion missing', () => {
      const goalWithMockOnly: GoalSettingOutput = {
        original_prompt: 'Fix async',
        upgraded_goal: 'Fix async properly',
        key_requirements: ['Fix it'],
        success_criteria: [
          'Code compiles',
          { criterion: 'Mock files updated', smart_score: 'high' },
        ],
        reasoning: 'Need mock fixes',
        confidence: 'high',
      };

      const errors = validateGoalCriteria(goalWithMockOnly, false, true);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.toLowerCase().includes('test'))).toBe(true);
    });

    it('should pass when nothing is detected', () => {
      const errors = validateGoalCriteria(baseGoal, false, false);
      expect(errors.length).toBe(0);
    });

    it('should handle case-insensitive criterion matching', () => {
      const goalWithCapsCriterion: GoalSettingOutput = {
        ...baseGoal,
        success_criteria: [
          'Parser tests pass',
          { criterion: 'BUILD MUST COMPILE SUCCESSFULLY', smart_score: 'high' },
        ],
      };

      const errors = validateGoalCriteria(goalWithCapsCriterion, true, false);
      expect(errors.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle goal with no success_criteria', () => {
      const emptyGoal: GoalSettingOutput = {
        original_prompt: 'Fix it',
        upgraded_goal: 'Fix the issue',
        key_requirements: [],
        success_criteria: [],
        reasoning: 'No criteria',
        confidence: 'low',
      };

      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(
        emptyGoal,
        mockBuildCapability,
        mockAsyncImpact,
      );

      expect(enhanced.success_criteria.length).toBeGreaterThan(0);
    });

    it('should handle goal with no anti_patterns', () => {
      const goalNoPatterns: GoalSettingOutput = {
        ...baseGoal,
        anti_patterns: undefined,
      };

      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(
        goalNoPatterns,
        mockBuildCapability,
        null,
      );

      expect(enhanced.anti_patterns?.do_not_break).toBeDefined();
    });

    it('should handle async impact with no mock files', () => {
      const noMockImpact: AsyncImpactAnalysis = {
        hasAsyncChanges: true,
        asyncKeywords: ['async'],
        mockFiles: [],
        testFiles: ['test.ts'],
        interfaceFiles: [],
        consumerFiles: [],
        summary: 'Only tests affected',
      };

      const enhanced = enhanceGoalWithBuildAndAsyncCriteria(baseGoal, null, noMockImpact);

      const mockCriterion = enhanced.success_criteria?.find(
        c => (typeof c === 'object' && c.criterion.toLowerCase().includes('mock')),
      );

      // Should not have mock criterion if no mock files
      expect(mockCriterion).toBeUndefined();
    });
  });
});
