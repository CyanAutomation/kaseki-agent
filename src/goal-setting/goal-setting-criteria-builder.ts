/**
 * Goal-setting criteria builder
 *
 * Enhances goal-setting success criteria with:
 * - Compilation gates (if build capability detected)
 * - Async-awareness criteria (if async impact detected)
 * - Language-appropriate anti-patterns
 */

import type { SmartCriterion, AntiPatterns, GoalSettingOutput } from '../types/goal-setting';
import type { BuildCapabilityInfo } from '../build-capability-detector';
import type { AsyncImpactAnalysis } from './async-impact-analyzer';

/**
 * Enhance goal-setting output with build and async criteria
 *
 * @param goal - Base goal-setting output
 * @param buildCapability - Detected build capability (if any)
 * @param asyncImpact - Detected async impact (if any)
 * @returns Enhanced goal-setting output
 */
export function enhanceGoalWithBuildAndAsyncCriteria(
  goal: GoalSettingOutput,
  buildCapability: BuildCapabilityInfo | null,
  asyncImpact: AsyncImpactAnalysis | null,
): GoalSettingOutput {
  const enhanced = { ...goal };
  const newCriteria: SmartCriterion[] = [];

  // Add build criterion if build capability detected
  if (buildCapability?.detected && buildCapability.command) {
    newCriteria.push({
      criterion: `Compilation succeeds with '${buildCapability.command}' (exit code 0)`,
      smart_score: 'high',
      reasoning: `Language-specific build must succeed for changes to be valid. Detected ${buildCapability.language} project with build command: ${buildCapability.command}`,
    });
  }

  // Add async criteria if async impact detected
  if (asyncImpact?.hasAsyncChanges && asyncImpact.asyncKeywords.length > 0) {
    // Criterion for mock compatibility
    if (asyncImpact.mockFiles.length > 0) {
      newCriteria.push({
        criterion: `All ${asyncImpact.mockFiles.length} affected mock files remain type-compatible and reflect async method signatures`,
        smart_score: 'high',
        reasoning: `Async conversions affect mock implementations. Mock files: ${asyncImpact.mockFiles.slice(0, 3).join(', ')}${asyncImpact.mockFiles.length > 3 ? `, +${asyncImpact.mockFiles.length - 3} more` : ''}`,
      });
    }

    // Criterion for test updates
    if (asyncImpact.testFiles.length > 0) {
      newCriteria.push({
        criterion: `All ${asyncImpact.testFiles.length} affected test files are updated to handle async/await behavior correctly`,
        smart_score: 'high',
        reasoning: `Async signature changes require updated test assertions and callbacks. Test files affected: ${asyncImpact.testFiles.slice(0, 3).join(', ')}${asyncImpact.testFiles.length > 3 ? `, +${asyncImpact.testFiles.length - 3} more` : ''}`,
      });
    }

    // Criterion for interface compatibility
    if (asyncImpact.interfaceFiles.length > 0) {
      newCriteria.push({
        criterion: 'All interface/type definitions correctly reflect async method signatures and return types',
        smart_score: 'high',
        reasoning: `Interface files affected: ${asyncImpact.interfaceFiles.slice(0, 3).join(', ')}${asyncImpact.interfaceFiles.length > 3 ? `, +${asyncImpact.interfaceFiles.length - 3} more` : ''}`,
      });
    }
  }

  // Add new criteria to existing success_criteria
  enhanced.success_criteria = [...(goal.success_criteria || []), ...newCriteria];

  // Enhance anti-patterns with build and async-specific rules
  const enhancedAntiPatterns: AntiPatterns = {
    ...goal.anti_patterns,
  };

  if (buildCapability?.detected) {
    enhancedAntiPatterns.do_not_break = [
      ...(enhancedAntiPatterns.do_not_break || []),
      'Compilation steps (must compile successfully)',
      'Build-time type checking (TypeScript, etc.)',
    ];
  }

  if (asyncImpact?.hasAsyncChanges) {
    enhancedAntiPatterns.do_not_modify = [
      ...(enhancedAntiPatterns.do_not_modify || []),
      'Async function signatures without updating dependent mocks',
      'Promise return types without updating test expectations',
    ];

    enhancedAntiPatterns.do_not_break = [
      ...(enhancedAntiPatterns.do_not_break || []),
      `Mock compatibility (${asyncImpact.mockFiles.length} mock files)`,
      `Test assertions (${asyncImpact.testFiles.length} test files)`,
      `Interface contracts (${asyncImpact.interfaceFiles.length} interface files)`,
    ];

    enhancedAntiPatterns.must_preserve = [
      ...(enhancedAntiPatterns.must_preserve || []),
      'Async method signatures (must match updated mocks)',
      'Promise-based return types (must align with test assertions)',
    ];
  }

  enhanced.anti_patterns = enhancedAntiPatterns;

  // Add requirement about the build and async changes to key_requirements
  const enhancedRequirements = [...(goal.key_requirements || [])];

  if (buildCapability?.detected) {
    enhancedRequirements.unshift(
      `Build with '${buildCapability.command}' must pass (${buildCapability.language} project)`,
    );
  }

  if (asyncImpact?.hasAsyncChanges && asyncImpact.summary) {
    enhancedRequirements.unshift(`Async changes: ${asyncImpact.summary}`);
  }

  enhanced.key_requirements = enhancedRequirements;

  return enhanced;
}

/**
 * Create a SMART compilation criterion
 */
export function createCompilationCriterion(
  language: string,
  command: string,
): SmartCriterion {
  return {
    criterion: `Compilation succeeds with '${command}' (exit code 0)`,
    smart_score: 'high',
    reasoning: `Project uses ${language}; build command must succeed to validate changes`,
  };
}

/**
 * Create a SMART async mock compatibility criterion
 */
export function createAsyncMockCriterion(mockFileCount: number, mockFileExamples: string[]): SmartCriterion {
  return {
    criterion: `All ${mockFileCount} affected mock files remain type-compatible with async method signatures`,
    smart_score: 'high',
    reasoning: `Async conversions require mock implementations to reflect new signatures. Examples: ${mockFileExamples.slice(0, 3).join(', ')}`,
  };
}

/**
 * Create a SMART async test updates criterion
 */
export function createAsyncTestCriterion(testFileCount: number, testFileExamples: string[]): SmartCriterion {
  return {
    criterion: `All ${testFileCount} affected test files are updated for async/await behavior`,
    smart_score: 'high',
    reasoning: `Test assertions and expectations must align with async method signatures. Examples: ${testFileExamples.slice(0, 3).join(', ')}`,
  };
}

/**
 * Validate that a goal has required compilation and async criteria
 *
 * @param goal - Goal to validate
 * @param buildCapabilityDetected - Whether build capability was detected
 * @param asyncImpactDetected - Whether async impact was detected
 * @returns Array of validation errors (empty if valid)
 */
export function validateGoalCriteria(
  goal: GoalSettingOutput,
  buildCapabilityDetected: boolean,
  asyncImpactDetected: boolean,
): string[] {
  const errors: string[] = [];

  // Check for compilation criterion if build detected
  if (buildCapabilityDetected) {
    const hasCompilationCriterion = goal.success_criteria?.some(
      c =>
        (typeof c === 'string' && c.toLowerCase().includes('compil'))
        || (typeof c === 'object' && c.criterion.toLowerCase().includes('compil')),
    );

    if (!hasCompilationCriterion) {
      errors.push('Goal must include "Compilation success" criterion for detected build system');
    }
  }

  // Check for async criteria if async impact detected
  if (asyncImpactDetected) {
    const hasMockCriterion = goal.success_criteria?.some(
      c =>
        (typeof c === 'string' && c.toLowerCase().includes('mock'))
        || (typeof c === 'object' && c.criterion.toLowerCase().includes('mock')),
    );

    if (!hasMockCriterion) {
      errors.push('Goal must include async mock compatibility criterion when async changes detected');
    }

    const hasAsyncCriterion = goal.success_criteria?.some(
      c =>
        (typeof c === 'string' && (c.toLowerCase().includes('async') || c.toLowerCase().includes('test')))
        || (typeof c === 'object'
          && (c.criterion.toLowerCase().includes('async') || c.criterion.toLowerCase().includes('test'))),
    );

    if (!hasAsyncCriterion) {
      errors.push('Goal must include async test update criterion when async changes detected');
    }
  }

  return errors;
}
