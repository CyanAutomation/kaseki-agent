import {
  formatRunEvaluation,
  formatUtcTimestamp,
  hasItems,
  normalizeLabel,
  serializeRunEvaluationMarkdown,
} from './run-evaluation-formatter';

describe('run-evaluation-formatter', () => {
  describe('label normalization', () => {
    // Spec: Labels are normalized to Title Case for markdown display
    // Expected behavior: Convert snake_case to Title Case, trim whitespace
    test.each([
      ['mixed', 'Mixed'],
      ['review_needed', 'Review Needed'],
      [' high-risk_stage ', 'High Risk Stage'],
      ['all_caps_text', 'All Caps Text'],
    ])('should normalize label %s to %s', (input, expected) => {
      expect(normalizeLabel(input)).toBe(expected);
    });
  });

  describe('utility helpers', () => {
    // Spec: Optional array guards protect against undefined/empty arrays
    test.each([
      [undefined, false],
      [[], false],
      [['x'], true],
      [['a', 'b'], true],
    ])('should guard array: %j -> %s', (input, expected) => {
      expect(hasItems(input)).toBe(expected);
    });

    // Spec: UTC timestamps are formatted for consistent display
    test.each([
      ['2026-05-27T01:02:03Z', '2026-05-27 01:02:03 UTC'],
      ['not-a-date', null],
      ['2026-01-01T00:00:00.000Z', '2026-01-01 00:00:00 UTC'],
    ])('should format timestamp %s to %s', (input, expected) => {
      expect(formatUtcTimestamp(input)).toBe(expected);
    });
  });

  describe('report formatting', () => {
    // Spec: Evaluation reports format structured data with optional sections
    // Expected behavior: Skip empty sections, render present sections with data
    test('should format report with optional sections (skipping empty improvements)', () => {
      const report = formatRunEvaluation({
        overall_assessment: 'mixed',
        reviewer_confidence: 'high',
        evaluated_at: '2026-05-27T01:02:03Z',
        stage_value: [
          { key: 'code_quality', value: 'ok', score: 0.75, reasoning: 'Mostly consistent style' },
        ],
        warnings: [{ code: 'W1', message: 'Flaky test signal', stage: 'validation' }],
        strengths: ['Fast runtime'],
        improvements: [], // Empty — should be skipped
      });

      expect(report.generatedAtUtc).toBe('2026-05-27 01:02:03 UTC');
      expect(report.sections.map((s) => s.key)).toEqual([
        'summary',
        'stage-values',
        'warnings',
        'strengths',
        // improvements not included because array is empty
      ]);
    });

    // Regression: GH#5678 — Preserve empty strings in values, don't coerce to N/A
    test('should preserve empty string values in stage_value items', () => {
      const report = formatRunEvaluation({
        overall_assessment: '',
        stage_value: [{ key: 'notes', value: '' }],
      });

      const summary = report.sections.find((s) => s.key === 'summary');
      expect(summary?.items[0].value).toBe(''); // Empty string preserved

      const stageValues = report.sections.find((s) => s.key === 'stage-values');
      expect(stageValues?.items[0].value).toBe('Value: '); // Empty value still shows label
    });

    // Spec: Markdown serialization renders report sections with proper formatting
    test('should serialize report to markdown with headers and formatting', () => {
      const markdown = serializeRunEvaluationMarkdown(
        formatRunEvaluation({
          overall_assessment: 'pass',
          reviewer_confidence: 'medium',
          strengths: ['Clear output'],
        })
      );

      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('**Overall assessment:** Pass');
      expect(markdown).toContain('**Reviewer confidence:** Medium');
      expect(markdown).toContain('## Strengths');
      expect(markdown).toContain('Clear output');
    });
  });
});
