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
});
