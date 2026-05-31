/**
 * Tests for src/routes/artifact-content-helpers.ts
 *
 * Coverage targets:
 * - renderRunEvaluationPayload: field extraction, markdown generation, type handling
 * - Field extraction: overall assessment, problems, solutions, human review, opportunities
 * - Type coercion: string arrays, object arrays, null/undefined handling
 * - Markdown generation: formatting, empty sections, multi-section output
 */

import { renderRunEvaluationPayload, getArtifactContentType } from './artifact-content-helpers';

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
});
