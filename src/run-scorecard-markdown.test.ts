import { buildScorecard, collectEvidence, normalizeConfig } from './run-scorecard';
import { formatRunScorecardMarkdown } from './run-scorecard-markdown';

const card = () => buildScorecard(collectEvidence({
  json: {
    'metadata.json': { instance: 'markdown', started_at: '2026-08-07T00:00:00Z', ended_at: '2026-08-07T00:01:00Z', exit_code: 0, quality_exit_code: 0 },
    'timings-manifest.json': { validation_timings: [{ exit_code: 0, elapsed_seconds: 2 }] },
    'goal-check.json': { met: true }, 'run-evaluation.json': { overall_assessment: 'good' },
  }, text: { 'changed-files.txt': 'src/a.ts\n', 'git.diff': '+change\n' },
  summaries: [{ phase: 'coding', request_id: 'one', usage: { input: 100, output: 20 } }],
}), normalizeConfig({}), new Date('2026-08-07T00:01:00Z'));

describe('run scorecard Markdown formatter', () => {
  test('renders required summary and per-phase table rows', () => {
    const markdown = formatRunScorecardMarkdown(card());

    expect(markdown).toContain('- **Overall:**');
    expect(markdown).toContain('- **Evidence coverage:**');
    expect(markdown).toContain('| Dimension | Weight | Score | Weighted points | Status |');
    for (const label of ['Goal quality', 'Scouting quality', 'Implementation quality', 'Validation quality', 'Goal attainment', 'Evaluation quality']) {
      expect(markdown).toContain(`| ${label} |`);
    }
    expect(markdown).toContain('<details><summary>Per-phase breakdown</summary>');
    expect(markdown).toContain('| Phase | Outcome | Elapsed | Tokens | Metrics | Completeness | Confidence |');
    for (const label of ['Scouting', 'Analysis / goal setting', 'Coding', 'Validation', 'Goal check', 'Run evaluation']) {
      expect(markdown).toContain(`| ${label} |`);
    }
  });

  test('renders stable, escaped, bounded reviewer content without raw evidence', () => {
    const fixture = card();
    fixture.phases.scouting.measurements = { z_raw_response: 'do not show', a_value: 'left|right', b_count: 2 };
    fixture.warnings = [`secret=hidden ${'x'.repeat(1000)}`, 'second', 'third', 'fourth'];
    const markdown = formatRunScorecardMarkdown(fixture);
    expect(markdown).toContain('| Goal quality |');
    expect(markdown).toContain('a value=left\\|right');
    expect(markdown).not.toContain('do not show');
    expect(markdown).not.toContain('hidden');
    expect(markdown).not.toContain('fourth');
    expect(markdown.length).toBeLessThan(12000);
  });

  test.each([undefined, null, {}, '{broken'])('degrades malformed or absent fixture %#', fixture => {
    expect(formatRunScorecardMarkdown(fixture)).toContain('Scorecard unavailable');
  });

  test('labels partial evidence as provisional', () => {
    const fixture = card();
    fixture.completeness = 'provisional';
    expect(formatRunScorecardMarkdown(fixture)).toContain('Provisional score');
  });

  test('does not present unavailable timing and token sentinels as measured zeroes', () => {
    const fixture = card();
    fixture.timing_totals.wall_clock_ms = 0;
    fixture.timing_totals.completeness = 'unavailable';
    fixture.token_totals.unavailable = true;
    fixture.token_totals.completeness = 'unavailable';
    fixture.phases.coding.token_usage.unavailable = true;
    fixture.phases.coding.token_usage.completeness = 'unavailable';

    const markdown = formatRunScorecardMarkdown(fixture);
    expect(markdown).toContain('- **Elapsed:** unavailable');
    expect(markdown).toContain('- **Tokens:** unavailable');
    expect(markdown).toContain('| Coding | succeeded | unavailable | unavailable |');
    expect(markdown).not.toContain('- **Tokens:** 0 total');
  });
});
