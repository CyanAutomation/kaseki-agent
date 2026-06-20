/**
 * Tests for src/routes/artifact-content-helpers.ts
 *
 * Coverage targets:
 * - renderRunEvaluationPayload: field extraction, markdown generation, type handling
 * - Field extraction: overall assessment, problems, solutions, human review, opportunities
 * - Type coercion: string arrays, object arrays, null/undefined handling
 * - Markdown generation: formatting, empty sections, multi-section output
 */

import {
  renderRunEvaluationPayload,
  getArtifactContentType,
  extractOverallAssessment,
  extractProblems,
  extractSolutions,
  extractHumanReviewRecommendations,
  artifactContentType,
  asStringArray,
  asObjectArray,
  extractOpportunities,
  buildMarkdownContent,
} from './artifact-content-helpers';

describe('artifact-content-helpers', () => {
  // ===== getArtifactContentType Tests =====
  describe('getArtifactContentType', () => {
    test('should return content type from metadata registry', () => {
      // Mock metadata - test with a known artifact
      const contentType = getArtifactContentType('metadata.json');
      expect(contentType).toBeDefined();
      expect(typeof contentType).toBe('string');
    });

    test('should return application/json for .json files', () => {
      const contentType = getArtifactContentType('unknown.json');
      expect(contentType).toBe('application/json');
    });

    test('should return text/markdown for .md files', () => {
      const contentType = getArtifactContentType('README.md');
      expect(contentType).toBe('text/markdown');
    });

    test('should return application/x-jsonl for .jsonl files', () => {
      const contentType = getArtifactContentType('events.jsonl');
      expect(contentType).toBe('application/x-jsonl');
    });

    test('should return text/tab-separated-values for .tsv files', () => {
      const contentType = getArtifactContentType('data.tsv');
      expect(contentType).toBe('text/tab-separated-values');
    });

    test('should return text/plain as fallback', () => {
      const contentType = getArtifactContentType('unknown.txt');
      expect(contentType).toBe('text/plain');
    });
  });

  // ===== renderRunEvaluationPayload Tests =====
  describe('renderRunEvaluationPayload', () => {
    test('should render complete evaluation with all sections', () => {
      const parsed = {
        overall: { assessment: 'Successful refactor with improved tests' },
        summary: ['Cleaned up codebase', 'Added test coverage'],
        problem: ['Type safety issues'],
        solution: ['Implemented stricter types'],
        human_review_recommendations: ['Review type definitions'],
        stages: [{ name: 'testing', duration: 5 }],
        efficiency: [{ metric: 'coverage', value: 85 }],
        validation: [{ check: 'lint', passed: true }],
        opportunities: [{ improvement: 'Add benchmarks' }],
        warnings: [{ level: 'info', message: 'All tests passed' }],
        metadata: { version: '1.0', timestamp: 1234567890 },
      };

      const result = renderRunEvaluationPayload(parsed, true);

      expect(result.format).toBe('rendered');
      expect(result.file).toBe('run-evaluation.json');
      expect(result.sections).toBeDefined();
      expect((result.sections.overall as any)?.assessment?.assessment).toEqual('Successful refactor with improved tests');
      expect(result.sections.summary).toEqual(['Cleaned up codebase', 'Added test coverage']);
      expect(result.sections.problem).toEqual(['Type safety issues']);
      expect(result.sections.solution).toEqual(['Implemented stricter types']);
      expect(result.sections.humanReview).toEqual(['Review type definitions']);
      expect(result.sections.stages).toEqual([{ name: 'testing', duration: 5 }]);
      expect(result.sections.efficiency).toEqual([{ metric: 'coverage', value: 85 }]);
      expect(result.sections.validation).toEqual([{ check: 'lint', passed: true }]);
      expect(result.sections.opportunities).toEqual([{ improvement: 'Add benchmarks' }]);
      expect(result.sections.warnings).toEqual([{ level: 'info', message: 'All tests passed' }]);
      expect(result.sections.metadata).toEqual({ version: '1.0', timestamp: 1234567890 });
      expect(result.raw).toEqual(parsed);
    });

    test('should handle snake_case field variants', () => {
      const parsed = {
        overall_assessment: { assessment: 'Good progress' },
        stage_by_stage_evaluation: [{ phase: 'unit_tests', duration: 10 }],
        efficiency_findings: [{ issue: 'slow_query' }],
        validation_outcome: [{ result: 'passed' }],
        kaseki_improvement_opportunities: [{ suggestion: 'Refactor cache' }],
      };

      const result = renderRunEvaluationPayload(parsed, false);

      expect(result.sections.overall).toEqual({ assessment: { assessment: 'Good progress' } });
      expect(result.sections.stages).toEqual([{ phase: 'unit_tests', duration: 10 }]);
      expect(result.sections.efficiency).toEqual([{ issue: 'slow_query' }]);
      expect(result.sections.validation).toEqual([{ result: 'passed' }]);
      expect(result.sections.opportunities).toEqual([{ suggestion: 'Refactor cache' }]);
    });

    test('should handle camelCase field variants', () => {
      const parsed = {
        overallAssessment: { note: 'Great!' },
        stageByStageEvaluation: [{ stage: 'integration' }],
        efficiencyFindings: [{ finding: 'Need optimization' }],
        validationOutcome: [{ outcome: 'success' }],
        improvementOpportunities: [{ op: 'Add caching' }],
      };

      const result = renderRunEvaluationPayload(parsed, false);

      expect(result.sections.overall).toEqual({ assessment: { note: 'Great!' } });
      expect(result.sections.stages).toEqual([{ stage: 'integration' }]);
      expect(result.sections.efficiency).toEqual([{ finding: 'Need optimization' }]);
      expect(result.sections.validation).toEqual([{ outcome: 'success' }]);
      expect(result.sections.opportunities).toEqual([{ op: 'Add caching' }]);
    });

    test('should generate markdown when includeMarkdown is true', () => {
      const parsed = {
        summary: ['Added new feature', 'Improved performance'],
        problem: ['Memory leak detected'],
        solution: ['Fixed memory leak'],
        human_review_recommendations: ['Test edge cases'],
      };

      const result = renderRunEvaluationPayload(parsed, true);

      expect(result.markdown).toBeDefined();
      expect(result.markdown).toContain('## Summary');
      expect(result.markdown).toContain('Added new feature');
      expect(result.markdown).toContain('## Problem');
      expect(result.markdown).toContain('Memory leak detected');
      expect(result.markdown).toContain('## Solution');
      expect(result.markdown).toContain('Fixed memory leak');
      expect(result.markdown).toContain('## Human review');
      expect(result.markdown).toContain('Test edge cases');
    });

    test('should not generate markdown when includeMarkdown is false', () => {
      const parsed = {
        summary: ['Added new feature'],
        problem: ['Memory leak detected'],
      };

      const result = renderRunEvaluationPayload(parsed, false);

      expect(result.markdown).toBeUndefined();
    });

    test('should handle empty sections gracefully', () => {
      const parsed = {
        summary: [],
        problem: [],
        solution: [],
        human_review_recommendations: [],
      };

      const result = renderRunEvaluationPayload(parsed, true);

      expect(result.sections.summary).toEqual([]);
      expect(result.sections.problem).toEqual([]);
      expect(result.markdown).toBeUndefined(); // All sections empty
    });

    test('should handle mixed empty and populated sections in markdown', () => {
      const parsed = {
        summary: ['System working well'],
        problem: [],
        solution: ['No issues to fix'],
        human_review_recommendations: [],
      };

      const result = renderRunEvaluationPayload(parsed, true);

      expect(result.markdown).toContain('## Summary');
      expect(result.markdown).toContain('System working well');
      expect(result.markdown).toContain('## Solution');
      expect(result.markdown).not.toContain('## Problem');
      expect(result.markdown).not.toContain('## Human review');
    });

    test('should convert non-array values to arrays with string conversion', () => {
      const parsed = {
        summary: 'Single summary string',
        problem: { issue: 'complex object' },
        solution: null,
        human_review_recommendations: 42,
      };

      const result = renderRunEvaluationPayload(parsed, false);

      expect(Array.isArray(result.sections.summary)).toBe(true);
      expect(result.sections.summary).toEqual(['Single summary string']);
      expect(Array.isArray(result.sections.problem)).toBe(true);
      expect(result.sections.problem).toEqual(['[object Object]']);
      expect(result.sections.solution).toEqual([]);
      expect(result.sections.humanReview).toEqual(['42']);
    });

    test('should handle metadata as object or ignore non-objects', () => {
      const parsed1 = {
        metadata: { version: '1.0', author: 'kaseki' },
      };
      const result1 = renderRunEvaluationPayload(parsed1, false);
      expect(result1.sections.metadata).toEqual({ version: '1.0', author: 'kaseki' });

      const parsed2 = {
        metadata: 'not an object',
      };
      const result2 = renderRunEvaluationPayload(parsed2, false);
      expect(result2.sections.metadata).toBeUndefined();

      const parsed3 = {
        metadata: [{ item: 1 }],
      };
      const result3 = renderRunEvaluationPayload(parsed3, false);
      expect(result3.sections.metadata).toBeUndefined(); // Arrays are filtered out
    });

    test('should convert object arrays and maintain structure', () => {
      const parsed = {
        stages: [
          { name: 'test', duration: 5 },
          { name: 'build', duration: 10 },
        ],
        opportunities: [
          { area: 'performance', priority: 'high' },
          'String opportunity', // Non-object in array
          42, // Non-object in array
        ],
      };

      const result = renderRunEvaluationPayload(parsed, false);

      expect(result.sections.stages).toEqual([
        { name: 'test', duration: 5 },
        { name: 'build', duration: 10 },
      ]);
      expect(result.sections.opportunities).toHaveLength(3);
      expect(result.sections.opportunities[0]).toEqual({ area: 'performance', priority: 'high' });
      expect(result.sections.opportunities[1]).toEqual({ value: 'String opportunity' });
      expect(result.sections.opportunities[2]).toEqual({ value: 42 });
    });

    test('should prefer specific field names in hierarchy', () => {
      // Test that specific names take precedence
      const parsed1 = {
        problem: ['Specific problem'],
        issues: ['Generic issue'],
        problems: ['Plural form'],
      };
      const result1 = renderRunEvaluationPayload(parsed1, false);
      expect(result1.sections.problem).toEqual(['Specific problem']);

      const parsed2 = {
        issues: ['Generic issue'],
        problems: ['Plural form'],
      };
      const result2 = renderRunEvaluationPayload(parsed2, false);
      expect(result2.sections.problem).toEqual(['Generic issue']);

      const parsed3 = {
        problems: ['Plural form'],
      };
      const result3 = renderRunEvaluationPayload(parsed3, false);
      expect(result3.sections.problem).toEqual(['Plural form']);
    });

    test('should maintain raw copy of parsed input', () => {
      const parsed = {
        custom_field: 'value',
        nested: { data: [1, 2, 3] },
        summary: 'test',
      };

      const result = renderRunEvaluationPayload(parsed, false);

      expect(result.raw).toEqual(parsed);
      expect(result.raw.custom_field).toBe('value');
      expect(result.raw.nested).toEqual({ data: [1, 2, 3] });
    });

    test('should handle completely empty parsed object', () => {
      const parsed = {};
      const result = renderRunEvaluationPayload(parsed, true);

      expect(result.sections.overall).toBeUndefined();
      expect(result.sections.summary).toEqual([]);
      expect(result.sections.problem).toEqual([]);
      expect(result.sections.solution).toEqual([]);
      expect(result.sections.humanReview).toEqual([]);
      expect(result.sections.stages).toEqual([]);
      expect(result.sections.efficiency).toEqual([]);
      expect(result.sections.validation).toEqual([]);
      expect(result.sections.opportunities).toEqual([]);
      expect(result.sections.warnings).toEqual([]);
      expect(result.sections.metadata).toBeUndefined();
      expect(result.markdown).toBeUndefined();
    });

    test('should format markdown with proper bullet points and sections', () => {
      const parsed = {
        summary: ['First item', 'Second item', 'Third item'],
        problem: ['Critical bug'],
        solution: ['Hotfix applied'],
        human_review_recommendations: ['Verify fix'],
      };

      const result = renderRunEvaluationPayload(parsed, true);

      expect(result.markdown).toContain('- First item');
      expect(result.markdown).toContain('- Second item');
      expect(result.markdown).toContain('- Third item');
      expect(result.markdown).toContain('- Critical bug');
      expect(result.markdown).toContain('- Hotfix applied');
      expect(result.markdown).toContain('- Verify fix');
    });
  });

  // ===== extractOverallAssessment Tests =====
  describe('extractOverallAssessment', () => {
    test('should extract overall field variant', () => {
      const parsed = { overall: { summary: 'Great work' } };
      const result = extractOverallAssessment(parsed);
      expect(result).toEqual({ assessment: { summary: 'Great work' } });
    });

    test('should extract overall_assessment field variant (snake_case)', () => {
      const parsed = { overall_assessment: { score: 85 } };
      const result = extractOverallAssessment(parsed);
      expect(result).toEqual({ assessment: { score: 85 } });
    });

    test('should extract overallAssessment field variant (camelCase)', () => {
      const parsed = { overallAssessment: { rating: 'excellent' } };
      const result = extractOverallAssessment(parsed);
      expect(result).toEqual({ assessment: { rating: 'excellent' } });
    });

    test('should prefer overall over other variants', () => {
      const parsed = {
        overall: { primary: true },
        overall_assessment: { secondary: true },
        overallAssessment: { tertiary: true },
      };
      const result = extractOverallAssessment(parsed);
      expect(result).toEqual({ assessment: { primary: true } });
    });

    test('should prefer overall_assessment over overallAssessment', () => {
      const parsed = {
        overall_assessment: { primary: true },
        overallAssessment: { secondary: true },
      };
      const result = extractOverallAssessment(parsed);
      expect(result).toEqual({ assessment: { primary: true } });
    });

    test('should return undefined when no assessment field exists', () => {
      const parsed = { other_field: { data: 'value' } };
      const result = extractOverallAssessment(parsed);
      expect(result).toBeUndefined();
    });

    test('should return undefined for null assessment value', () => {
      const parsed = { overall: null };
      const result = extractOverallAssessment(parsed);
      expect(result).toBeUndefined();
    });

    test('should return undefined for undefined assessment value', () => {
      const parsed = { overall: undefined };
      const result = extractOverallAssessment(parsed);
      expect(result).toBeUndefined();
    });

    test('should handle complex nested assessment objects', () => {
      const parsed = {
        overall: {
          quality_score: 92,
          metrics: { coverage: 85, performance: 95 },
          notes: ['Well structured', 'Good test coverage'],
        },
      };
      const result = extractOverallAssessment(parsed);
      expect(result?.assessment).toEqual(parsed.overall);
    });

    test('should handle assessment as primitive value', () => {
      const parsed = { overall: 'Excellent' };
      const result = extractOverallAssessment(parsed);
      expect(result).toEqual({ assessment: 'Excellent' });
    });
  });

  // ===== extractProblems Tests =====
  describe('extractProblems', () => {
    test('should extract problem field variant', () => {
      const parsed = { problem: ['Type safety issue'] };
      const result = extractProblems(parsed);
      expect(result).toEqual(['Type safety issue']);
    });

    test('should extract issues field variant', () => {
      const parsed = { issues: ['Memory leak', 'Race condition'] };
      const result = extractProblems(parsed);
      expect(result).toEqual(['Memory leak', 'Race condition']);
    });

    test('should extract problems field variant', () => {
      const parsed = { problems: ['Performance degradation'] };
      const result = extractProblems(parsed);
      expect(result).toEqual(['Performance degradation']);
    });

    test('should prefer problem over issues and problems', () => {
      const parsed = {
        problem: ['Primary issue'],
        issues: ['Secondary issue'],
        problems: ['Tertiary issue'],
      };
      const result = extractProblems(parsed);
      expect(result).toEqual(['Primary issue']);
    });

    test('should prefer issues over problems', () => {
      const parsed = {
        issues: ['Primary issue'],
        problems: ['Secondary issue'],
      };
      const result = extractProblems(parsed);
      expect(result).toEqual(['Primary issue']);
    });

    test('should return empty array when no problem field exists', () => {
      const parsed = { other_field: 'value' };
      const result = extractProblems(parsed);
      expect(result).toEqual([]);
    });

    test('should convert non-array problem to array', () => {
      const parsed = { problem: 'Single issue' };
      const result = extractProblems(parsed);
      expect(result).toEqual(['Single issue']);
    });

    test('should convert null/undefined to empty array', () => {
      const parsed1 = { problem: null };
      const result1 = extractProblems(parsed1);
      expect(result1).toEqual([]);

      const parsed2 = { problem: undefined };
      const result2 = extractProblems(parsed2);
      expect(result2).toEqual([]);
    });

    test('should convert object values to string representation', () => {
      const parsed = { problem: [{ error: 'type error' }, { error: 'runtime error' }] };
      const result = extractProblems(parsed);
      expect(result).toHaveLength(2);
      expect(typeof result[0]).toBe('string');
      expect(typeof result[1]).toBe('string');
    });
  });

  // ===== extractSolutions Tests =====
  describe('extractSolutions', () => {
    test('should extract solution field variant', () => {
      const parsed = { solution: ['Refactored code'] };
      const result = extractSolutions(parsed);
      expect(result).toEqual(['Refactored code']);
    });

    test('should extract what_was_fixed field variant (snake_case)', () => {
      const parsed = { what_was_fixed: ['Memory leak patched'] };
      const result = extractSolutions(parsed);
      expect(result).toEqual(['Memory leak patched']);
    });

    test('should extract whatWasFixed field variant (camelCase)', () => {
      const parsed = { whatWasFixed: ['Cache optimized'] };
      const result = extractSolutions(parsed);
      expect(result).toEqual(['Cache optimized']);
    });

    test('should extract fixes field variant', () => {
      const parsed = { fixes: ['Applied hotfix'] };
      const result = extractSolutions(parsed);
      expect(result).toEqual(['Applied hotfix']);
    });

    test('should prefer solution over other variants', () => {
      const parsed = {
        solution: ['Primary fix'],
        what_was_fixed: ['Secondary fix'],
        whatWasFixed: ['Tertiary fix'],
        fixes: ['Quaternary fix'],
      };
      const result = extractSolutions(parsed);
      expect(result).toEqual(['Primary fix']);
    });

    test('should prefer what_was_fixed over whatWasFixed and fixes', () => {
      const parsed = {
        what_was_fixed: ['Snake case fix'],
        whatWasFixed: ['Camel case fix'],
        fixes: ['Generic fix'],
      };
      const result = extractSolutions(parsed);
      expect(result).toEqual(['Snake case fix']);
    });

    test('should prefer whatWasFixed over fixes', () => {
      const parsed = {
        whatWasFixed: ['Camel case fix'],
        fixes: ['Generic fix'],
      };
      const result = extractSolutions(parsed);
      expect(result).toEqual(['Camel case fix']);
    });

    test('should return empty array when no solution field exists', () => {
      const parsed = { other_field: 'value' };
      const result = extractSolutions(parsed);
      expect(result).toEqual([]);
    });

    test('should handle empty string solution', () => {
      const parsed = { solution: '' };
      const result = extractSolutions(parsed);
      expect(result).toEqual([]);
    });
  });

  // ===== extractHumanReviewRecommendations Tests =====
  describe('extractHumanReviewRecommendations', () => {
    test('should extract human_review_recommendations field variant (snake_case)', () => {
      const parsed = { human_review_recommendations: ['Review type definitions'] };
      const result = extractHumanReviewRecommendations(parsed);
      expect(result).toEqual(['Review type definitions']);
    });

    test('should extract humanReviewRecommendations field variant (camelCase)', () => {
      const parsed = { humanReviewRecommendations: ['Check edge cases'] };
      const result = extractHumanReviewRecommendations(parsed);
      expect(result).toEqual(['Check edge cases']);
    });

    test('should extract human_review_focus field variant', () => {
      const parsed = { human_review_focus: ['Performance critical sections'] };
      const result = extractHumanReviewRecommendations(parsed);
      expect(result).toEqual(['Performance critical sections']);
    });

    test('should prefer human_review_recommendations over other variants', () => {
      const parsed = {
        human_review_recommendations: ['Primary review'],
        humanReviewRecommendations: ['Secondary review'],
        human_review_focus: ['Tertiary review'],
      };
      const result = extractHumanReviewRecommendations(parsed);
      expect(result).toEqual(['Primary review']);
    });

    test('should prefer humanReviewRecommendations over human_review_focus', () => {
      const parsed = {
        humanReviewRecommendations: ['Primary review'],
        human_review_focus: ['Secondary review'],
      };
      const result = extractHumanReviewRecommendations(parsed);
      expect(result).toEqual(['Primary review']);
    });

    test('should return empty array when no review field exists', () => {
      const parsed = { other_field: 'value' };
      const result = extractHumanReviewRecommendations(parsed);
      expect(result).toEqual([]);
    });

    test('should handle multiple review recommendations', () => {
      const parsed = {
        human_review_recommendations: [
          'Verify algorithm correctness',
          'Check for edge cases',
          'Review error handling',
        ],
      };
      const result = extractHumanReviewRecommendations(parsed);
      expect(result).toHaveLength(3);
      expect(result).toContain('Verify algorithm correctness');
      expect(result).toContain('Check for edge cases');
      expect(result).toContain('Review error handling');
    });

    test('should convert non-array recommendations to array', () => {
      const parsed = { human_review_recommendations: 'Single recommendation' };
      const result = extractHumanReviewRecommendations(parsed);
      expect(result).toEqual(['Single recommendation']);
    });

    test('should handle null/undefined recommendations', () => {
      const parsed1 = { human_review_recommendations: null };
      const result1 = extractHumanReviewRecommendations(parsed1);
      expect(result1).toEqual([]);

      const parsed2 = { human_review_recommendations: undefined };
      const result2 = extractHumanReviewRecommendations(parsed2);
      expect(result2).toEqual([]);
    });
  });

  // ===== asStringArray Tests =====
  describe('asStringArray', () => {
    test('should convert array of values to string array', () => {
      const result = asStringArray([1, 2, 3, 'test']);
      expect(result).toEqual(['1', '2', '3', 'test']);
    });

    test('should convert single string to array', () => {
      const result = asStringArray('hello');
      expect(result).toEqual(['hello']);
    });

    test('should convert number to array with string', () => {
      const result = asStringArray(42);
      expect(result).toEqual(['42']);
    });

    test('should convert object to array with string representation', () => {
      const obj = { key: 'value' };
      const result = asStringArray(obj);
      expect(result).toHaveLength(1);
      expect(typeof result[0]).toBe('string');
    });

    test('should return empty array for undefined', () => {
      const result = asStringArray(undefined);
      expect(result).toEqual([]);
    });

    test('should return empty array for null', () => {
      const result = asStringArray(null);
      expect(result).toEqual([]);
    });

    test('should return empty array for empty string', () => {
      const result = asStringArray('');
      expect(result).toEqual([]);
    });

    test('should preserve array order', () => {
      const result = asStringArray(['z', 'a', 'm', 'b']);
      expect(result).toEqual(['z', 'a', 'm', 'b']);
    });
  });

  // ===== asObjectArray Tests =====
  describe('asObjectArray', () => {
    test('should return empty array for non-array input', () => {
      const result = asObjectArray('not an array');
      expect(result).toEqual([]);
    });

    test('should return empty array for null', () => {
      const result = asObjectArray(null);
      expect(result).toEqual([]);
    });

    test('should return empty array for undefined', () => {
      const result = asObjectArray(undefined);
      expect(result).toEqual([]);
    });

    test('should preserve objects in array', () => {
      const obj1 = { id: 1, name: 'test' };
      const obj2 = { id: 2, name: 'test2' };
      const result = asObjectArray([obj1, obj2]);
      expect(result).toEqual([obj1, obj2]);
    });

    test('should wrap non-object array values in { value } object', () => {
      const result = asObjectArray(['string', 42, true]);
      expect(result).toEqual([{ value: 'string' }, { value: 42 }, { value: true }]);
    });

    test('should wrap null/undefined in array as { value } objects', () => {
      const result = asObjectArray([null, undefined, 'test']);
      expect(result).toEqual([{ value: null }, { value: undefined }, { value: 'test' }]);
    });

    test('should skip nested arrays without wrapping', () => {
      const result = asObjectArray([[1, 2, 3], { key: 'val' }]);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ value: [1, 2, 3] });
      expect(result[1]).toEqual({ key: 'val' });
    });
  });

  // ===== extractOpportunities Tests =====
  describe('extractOpportunities', () => {
    test('should extract opportunities field variant', () => {
      const parsed = { opportunities: [{ area: 'performance', priority: 'high' }] };
      const result = extractOpportunities(parsed);
      expect(result).toEqual([{ area: 'performance', priority: 'high' }]);
    });

    test('should extract kaseki_improvement_opportunities field variant', () => {
      const parsed = { kaseki_improvement_opportunities: [{ suggestion: 'Add caching' }] };
      const result = extractOpportunities(parsed);
      expect(result).toEqual([{ suggestion: 'Add caching' }]);
    });

    test('should extract improvement_opportunities field variant', () => {
      const parsed = { improvement_opportunities: [{ idea: 'Refactor utils' }] };
      const result = extractOpportunities(parsed);
      expect(result).toEqual([{ idea: 'Refactor utils' }]);
    });

    test('should extract improvementOpportunities field variant (camelCase)', () => {
      const parsed = { improvementOpportunities: [{ change: 'Optimize queries' }] };
      const result = extractOpportunities(parsed);
      expect(result).toEqual([{ change: 'Optimize queries' }]);
    });

    test('should prefer opportunities over other variants', () => {
      const parsed = {
        opportunities: [{ primary: true }],
        kaseki_improvement_opportunities: [{ secondary: true }],
        improvement_opportunities: [{ tertiary: true }],
        improvementOpportunities: [{ quaternary: true }],
      };
      const result = extractOpportunities(parsed);
      expect(result).toEqual([{ primary: true }]);
    });

    test('should return empty array when no opportunities exist', () => {
      const parsed = { other_field: 'value' };
      const result = extractOpportunities(parsed);
      expect(result).toEqual([]);
    });

    test('should handle multiple opportunities', () => {
      const parsed = {
        opportunities: [
          { id: 1, area: 'perf' },
          { id: 2, area: 'security' },
          { id: 3, area: 'UX' },
        ],
      };
      const result = extractOpportunities(parsed);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(1);
      expect(result[2].id).toBe(3);
    });
  });

  // ===== buildMarkdownContent Tests =====
  describe('buildMarkdownContent', () => {
    test('should build markdown with all sections populated', () => {
      const sections = {
        summary: ['Item 1', 'Item 2'],
        problem: ['Problem 1'],
        solution: ['Solution 1', 'Solution 2'],
        humanReview: ['Review 1'],
      };
      const result = buildMarkdownContent(sections);
      expect(result).toContain('## Summary');
      expect(result).toContain('- Item 1');
      expect(result).toContain('- Item 2');
      expect(result).toContain('## Problem');
      expect(result).toContain('- Problem 1');
      expect(result).toContain('## Solution');
      expect(result).toContain('- Solution 1');
      expect(result).toContain('- Solution 2');
      expect(result).toContain('## Human review');
      expect(result).toContain('- Review 1');
    });

    test('should return undefined when all sections are empty', () => {
      const sections = {
        summary: [],
        problem: [],
        solution: [],
        humanReview: [],
      };
      const result = buildMarkdownContent(sections);
      expect(result).toBeUndefined();
    });

    test('should skip empty sections', () => {
      const sections = {
        summary: ['Summary 1'],
        problem: [],
        solution: ['Solution 1'],
        humanReview: [],
      };
      const result = buildMarkdownContent(sections);
      expect(result).toContain('## Summary');
      expect(result).toContain('## Solution');
      expect(result).not.toContain('## Problem');
      expect(result).not.toContain('## Human review');
    });

    test('should include only summary section', () => {
      const sections = {
        summary: ['Only summary'],
        problem: [],
        solution: [],
        humanReview: [],
      };
      const result = buildMarkdownContent(sections);
      expect(result).toBe('## Summary\n- Only summary');
    });

    test('should format multiple items with proper line breaks', () => {
      const sections = {
        summary: ['First', 'Second', 'Third'],
        problem: [],
        solution: [],
        humanReview: [],
      };
      const result = buildMarkdownContent(sections);
      expect(result).toContain('- First\n- Second\n- Third');
    });

    test('should separate sections with double newlines', () => {
      const sections = {
        summary: ['Summary item'],
        problem: ['Problem item'],
        solution: [],
        humanReview: [],
      };
      const result = buildMarkdownContent(sections);
      expect(result).toMatch(/## Summary\n- Summary item\n\n## Problem\n- Problem item/);
    });

    test('should handle section with single item', () => {
      const sections = {
        summary: ['One item'],
        problem: [],
        solution: [],
        humanReview: [],
      };
      const result = buildMarkdownContent(sections);
      expect(result).toBe('## Summary\n- One item');
    });

    test('should preserve item text exactly', () => {
      const sections = {
        summary: [
          'Item with special chars: !@#$%',
          'Item with spaces   and   tabs',
          'Item with line content',
        ],
        problem: [],
        solution: [],
        humanReview: [],
      };
      const result = buildMarkdownContent(sections);
      expect(result).toContain('Item with special chars: !@#$%');
      expect(result).toContain('Item with spaces   and   tabs');
    });
  });

  // ===== artifactContentType Tests =====
  describe('artifactContentType', () => {
    test('should return application/json for .json files', () => {
      const result = artifactContentType('file.json');
      expect(result).toBe('application/json');
    });

    test('should return text/markdown for .md files', () => {
      const result = artifactContentType('README.md');
      expect(result).toBe('text/markdown');
    });

    test('should return application/x-jsonl for .jsonl files', () => {
      const result = artifactContentType('events.jsonl');
      expect(result).toBe('application/x-jsonl');
    });

    test('should return text/tab-separated-values for .tsv files', () => {
      const result = artifactContentType('data.tsv');
      expect(result).toBe('text/tab-separated-values');
    });

    test('should return text/plain as fallback for unknown extensions', () => {
      const result = artifactContentType('file.txt');
      expect(result).toBe('text/plain');
    });

    test('should return text/plain for files without extension', () => {
      const result = artifactContentType('noextension');
      expect(result).toBe('text/plain');
    });

    test('should check ARTIFACT_METADATA_REGISTRY first', () => {
      // metadata.json has a specific type in the registry
      const result = artifactContentType('metadata.json');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    test('should handle case-sensitive extension matching', () => {
      const result1 = artifactContentType('file.JSON');
      // Uppercase extension won't match .json pattern
      expect(result1).toBe('text/plain');

      const result2 = artifactContentType('file.json');
      expect(result2).toBe('application/json');
    });

    test('should handle multiple dots in filename', () => {
      const result = artifactContentType('my.file.name.json');
      expect(result).toBe('application/json');
    });
  });
});
