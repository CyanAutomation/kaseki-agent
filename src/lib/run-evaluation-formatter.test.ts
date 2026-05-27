import {
  formatRunEvaluation,
  formatUtcTimestamp,
  hasItems,
  normalizeLabel,
  serializeRunEvaluationMarkdown,
} from './run-evaluation-formatter';

describe('run-evaluation-formatter', () => {
  it('normalizes labels', () => {
    expect(normalizeLabel('mixed')).toBe('Mixed');
    expect(normalizeLabel('review_needed')).toBe('Review Needed');
    expect(normalizeLabel(' high-risk_stage ')).toBe('High Risk Stage');
  });

  it('guards optional arrays', () => {
    expect(hasItems(undefined)).toBe(false);
    expect(hasItems([])).toBe(false);
    expect(hasItems(['x'])).toBe(true);
  });

  it('formats utc timestamp', () => {
    expect(formatUtcTimestamp('2026-05-27T01:02:03Z')).toBe('2026-05-27 01:02:03 UTC');
    expect(formatUtcTimestamp('not-a-date')).toBeNull();
  });

  it('formats structured report with optional sections skipped', () => {
    const report = formatRunEvaluation({
      overall_assessment: 'mixed',
      reviewer_confidence: 'high',
      evaluated_at: '2026-05-27T01:02:03Z',
      stage_value: [
        { key: 'code_quality', value: 'ok', score: 0.75, reasoning: 'Mostly consistent style' },
      ],
      warnings: [{ code: 'W1', message: 'Flaky test signal', stage: 'validation' }],
      strengths: ['Fast runtime'],
      improvements: [],
    });

    expect(report.generatedAtUtc).toBe('2026-05-27 01:02:03 UTC');
    expect(report.sections.map((s) => s.key)).toEqual(['summary', 'stage-values', 'warnings', 'strengths']);
  });

  it('preserves empty string values instead of coercing to N/A', () => {
    const report = formatRunEvaluation({
      overall_assessment: '',
      stage_value: [{ key: 'notes', value: '' }],
    });

    const summary = report.sections.find((s) => s.key === 'summary');
    expect(summary?.items[0].value).toBe('');

    const stageValues = report.sections.find((s) => s.key === 'stage-values');
    expect(stageValues?.items[0].value).toBe('Value: ');
  });

  it('serializes report to markdown', () => {
    const markdown = serializeRunEvaluationMarkdown(
      formatRunEvaluation({
        overall_assessment: 'pass',
        reviewer_confidence: 'medium',
        strengths: ['Clear output'],
      })
    );

    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('**Overall assessment:** Pass');
    expect(markdown).toContain('## Strengths');
  });
});
