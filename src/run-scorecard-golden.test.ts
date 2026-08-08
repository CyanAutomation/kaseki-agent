import { buildScorecard, collectEvidence, normalizeConfig, type ArtifactSnapshot } from './run-scorecard';

const NOW = new Date('2026-08-07T12:00:00.000Z');
function bundle(overrides: Partial<ArtifactSnapshot> = {}): ArtifactSnapshot {
  return {
    json: {
      'metadata.json': { instance: 'synthetic-run', started_at: '2026-08-07T11:30:00.000Z', ended_at: NOW.toISOString(), exit_code: 0, quality_exit_code: 0 },
      'timings-manifest.json': { stage_timings: [{ elapsed_seconds: 600 }], validation_timings: [{ exit_code: 0 }] },
      'goal-check.json': { met: true }, 'scouting.json': { relevant_files: ['src/a.ts'] },
      'run-evaluation.json': { task_completion_score: 90, contradictions: [] },
    },
    text: { 'changed-files.txt': 'src/a.ts\n', 'git.diff': '+export const answer = 42;\n' },
    summaries: [{ phase: 'coding', request_id: 'coding-1', usage: { input: 8000, output: 2000, cacheRead: 1000 } }],
    ...overrides,
  };
}

describe('scorecard dimension tables and invariants', () => {
  test.each([
    ['missing data', bundle({ json: { 'metadata.json': { exit_code: 0 } }, text: {}, summaries: [] })],
    ['disabled optional phase', bundle({ json: { ...bundle().json, 'metadata.json': { ...(bundle().json['metadata.json'] as object), disabled_phases: ['scouting'] } } })],
    ['retries', bundle({ text: { ...bundle().text, 'provider-attempts.jsonl': 'attempt retry\nattempt retry\n' } })],
    ['cached tokens', bundle({ summaries: [{ phase: 'coding', request_id: 'cached', usage: { input: 20, output: 5, cacheRead: 5000, cacheWrite: 100 } }] })],
    ['malformed summaries', bundle({ summaries: [null, 'bad', { phase: 'coding', request_id: 'bad' }] })],
    ['zero-change inspect run', bundle({ text: { 'changed-files.txt': '', 'git.diff': '' } })],
    ['empty patch-mode diff', bundle({ text: { 'git.diff': '', 'changed-files.txt': '' } })],
    ['validation failure', bundle({ json: { ...bundle().json, 'timings-manifest.json': { validation_timings: [{ exit_code: 1 }], stage_timings: [{ elapsed_seconds: 600 }] } } })],
    ['contradictory evaluators', bundle({ json: { ...bundle().json, 'run-evaluation.json': { task_completion_score: 95, contradictions: ['A', 'B'] } } })],
    ['cancelled run', bundle({ json: { ...bundle().json, 'metadata.json': { instance: 'cancelled', lifecycle_status: 'cancelled', started_at: '2026-08-07T11:30:00.000Z', ended_at: NOW.toISOString() } } })],
  ])('%s produces a bounded score for every dimension', (_name, artifacts) => {
    const card = buildScorecard(collectEvidence(artifacts), normalizeConfig({}), NOW);
    expect(card.dimensions.map(d => d.id)).toEqual(['goal_quality','scouting_quality','implementation_quality','validation_quality','goal_attainment','evaluation_quality']);
    expect(card.dimensions.every(d => d.normalized_score >= 0 && d.normalized_score <= 100)).toBe(true);
    expect(card.overall_score).toBeGreaterThanOrEqual(0); expect(card.overall_score).toBeLessThanOrEqual(100);
    expect(card.evidence_coverage.ratio).toBeLessThanOrEqual(1);
    expect(Number(card.dimensions.reduce((n,d) => n+d.weighted_points, 0).toFixed(2))).toBe(card.overall_score);
  });

  test('missing critical evidence cannot increase confidence', () => {
    const complete = buildScorecard(collectEvidence(bundle()), normalizeConfig({}), NOW);
    const missing = buildScorecard(collectEvidence(bundle({ text: {} })), normalizeConfig({}), NOW);
    expect(missing.confidence.score).toBeLessThanOrEqual(complete.confidence.score);
  });

  test('more retries or tokens cannot improve efficiency with other inputs equal', () => {
    const base = collectEvidence(bundle());
    const costly = collectEvidence(bundle({ text: { ...bundle().text, 'provider-attempts.jsonl': 'retry retry retry' }, summaries: [{ phase:'coding', request_id:'large', usage:{ input:80000, output:20000 } }] }));
    const config = normalizeConfig({ KASEKI_SCORECARD_TASK_SIZE:'small' });
    expect(buildScorecard(costly, config, NOW).dimensions[2].normalized_score).toBeLessThanOrEqual(buildScorecard(base, config, NOW).dimensions[2].normalized_score);
  });

  test('failed required validation cannot receive top solution quality', () => {
    const failed = bundle({ json: { ...bundle().json, 'timings-manifest.json': { validation_timings: [{ exit_code: 1 }] } } });
    expect(buildScorecard(collectEvidence(failed), normalizeConfig({}), NOW).dimensions.find(d=>d.id==='validation_quality')?.normalized_score).toBe(0);
  });

  test('artifact ordering does not affect output', () => {
    const artifacts=bundle({summaries:[{phase:'coding',request_id:'a',usage:{input:10,output:2}},{phase:'validation',request_id:'b',usage:{input:5,output:1}}]});
    const reversed={...artifacts,summaries:[...artifacts.summaries].reverse()};
    const strip=(value: ReturnType<typeof buildScorecard>)=>({...value,scored_at:'stable'});
    expect(strip(buildScorecard(collectEvidence(artifacts),normalizeConfig({}),NOW))).toEqual(strip(buildScorecard(collectEvidence(reversed),normalizeConfig({}),NOW)));
  });
});

describe.each([
  ['small', 30_000, 900_000, 90],
  ['medium', 90_000, 2_700_000, 98],
  ['large', 200_000, 7_200_000, 100],
] as const)('%s scorecard semantics', (taskSize, tokenBudget, wallClockMs, implementationScore) => {
  test('uses task-size thresholds and produces a complete, bounded scorecard', () => {
    const artifacts = bundle({
      json: {
        ...bundle().json,
        'timings-manifest.json': { stage_timings: [{ elapsed_seconds: 3600 }], validation_timings: [{ exit_code: 0 }] },
      },
      summaries: [{ phase: 'coding', request_id: 'coding-1', usage: { input: 80_000, output: 20_000 } }],
    });
    const card = buildScorecard(collectEvidence(artifacts), normalizeConfig({ KASEKI_SCORECARD_TASK_SIZE: taskSize }), NOW);

    expect(card.scoring_config.task_size).toBe(taskSize);
    expect(card.scoring_config.selected_targets).toMatchObject({ token_budget: tokenBudget, wall_clock_ms: wallClockMs });
    expect(card.dimensions.map(dimension => dimension.id)).toEqual([
      'goal_quality', 'scouting_quality', 'implementation_quality', 'validation_quality', 'goal_attainment', 'evaluation_quality',
    ]);
    expect(card.dimensions.find(dimension => dimension.id === 'implementation_quality')?.normalized_score).toBe(implementationScore);
    expect(card.dimensions.every(dimension => dimension.normalized_score >= 0 && dimension.normalized_score <= 100)).toBe(true);
    expect(card.overall_score).toBeGreaterThanOrEqual(0);
    expect(card.overall_score).toBeLessThanOrEqual(100);
    expect(card.confidence).toEqual({ score: 100, rationale: '8 of 8 evidence categories are available.' });
    expect(Object.values(card.phases).every(phase => phase.confidence >= 0 && phase.confidence <= 100)).toBe(true);
    expect(card.phases.coding).toMatchObject({ confidence: 100, completeness: 'complete' });
    expect(card.phases.validation).toMatchObject({ confidence: 50, completeness: 'provisional' });
  });
});
