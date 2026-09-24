import { buildRunEvaluationArtifact, buildRunEvaluationEvidenceSources } from './jev-run-evaluation-artifact';

const classifier = {
  provider: 'openrouter-decisions',
  model: 'test-model',
  responseTime: 25,
  usage: { input_tokens: 100 },
};

const completeFacts = {
  metadata: { exit_code: 0, validation_commands_attempted: 2, validation_exit_code: 0, task_mode: 'patch' },
  failure: {},
  goalSetting: { success_criteria: ['Tests pass'], confidence: 'high' },
  scouting: { relevant_files: [{ path: 'src/a.ts' }] },
  goalCheck: { met: true, confidence: 'high' },
  validation: 'npm test: passed\nnpm run type-check: passed',
  validationSources: ['validation.log'],
  changedFiles: 'src/a.ts\n',
  diff: '+export const answer = 42;\n',
  taskMode: 'patch',
  presentSources: ['goal-setting.json', 'scouting.json', 'goal-check.json', 'validation.log', 'changed-files.txt', 'git.diff'],
  stageDurations: { scouting: 12, coding: 45, validation: 10 },
};

describe('JEV run evaluation artifact', () => {
  test('builds evidence-backed stage scores, review focus, and run summary', () => {
    const result = buildRunEvaluationArtifact(completeFacts, {
      overallAssessment: 'good', reviewerConfidence: 'high', taskCompletionScore: 5,
    }, classifier);

    expect(result.stage_value).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'scouting', value: 'high' }),
      expect.objectContaining({ stage: 'validation', value: 'high' }),
      expect.objectContaining({ stage: 'coding', value: 'high' }),
    ]));
    expect(result.phase_scorecard).toMatchObject({
      scouting: { outcome: 'succeeded', relevant_files_identified: 1 },
      validation: { outcome: 'succeeded', commands_attempted: 2 },
      coding: { outcome: 'succeeded', changed_files: 1 },
    });
    expect(result.evidence_sources_inspected).toEqual(completeFacts.presentSources);
    expect(result.summary).toContain('2 validation commands passed');
    expect(result.summary).toContain('1 changed file');
    expect(result.pr_changes).toEqual([]);
    expect(result.human_review_focus).toEqual([]);
    expect(result.kaseki_improvement_opportunities).toEqual([]);
  });

  test('surfaces fallbacks, missing validation, failed lifecycle, and contradictory evidence', () => {
    const result = buildRunEvaluationArtifact({
      ...completeFacts,
      metadata: { exit_code: 8, validation_commands_attempted: 0, validation_exit_code: 0, task_mode: 'patch', scouting_fallback_used: true },
      failure: { worker_error_type: 'metadata_write_invalid', failed_command: 'run evaluation' },
      goalSetting: { confidence: 'low', reasoning: 'Fallback goal-setting artifact generated because the agent failed.' },
      scouting: { fallback: true, fallback_reason: 'missing_scouting_candidate_for_patch_mode' },
      goalCheck: { met: true },
      validation: '',
      validationSources: [],
      changedFiles: '',
      diff: '',
      presentSources: ['goal-setting.json', 'scouting.json', 'goal-check.json'],
      stageDurations: {},
    }, { overallAssessment: 'excellent', reviewerConfidence: 'high', taskCompletionScore: 5 }, classifier);

    expect(result.overall_assessment).toBe('poor');
    expect(result.reviewer_confidence).toBe('low');
    expect(result.task_completion_score).toBeLessThanOrEqual(2);
    expect(result.phase_scorecard.scouting).toMatchObject({ outcome: 'completed_with_fallback' });
    expect(result.phase_scorecard.validation).toMatchObject({ outcome: 'not_run', commands_attempted: 0 });
    expect(result.contradictions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sources: expect.arrayContaining(['goal-check.json', 'git.diff']) }),
    ]));
    expect(result.human_review_focus.join(' ')).toMatch(/scouting fallback/i);
    expect(result.human_review_focus.join(' ')).toMatch(/validation was not run/i);
    expect(result.kaseki_improvement_opportunities.map(item => item.category)).toEqual(
      expect.arrayContaining(['scouting', 'validation', 'metadata']),
    );
  });

  test('lists only evidence files that actually exist', () => {
    expect(buildRunEvaluationEvidenceSources({
      presentSources: ['scouting.json', 'git.diff'],
      validationSources: [],
    })).toEqual(['scouting.json', 'git.diff']);
  });

  test('reports measured cold installs without treating unknown timings as zero', () => {
    const result = buildRunEvaluationArtifact({
      ...completeFacts,
      cacheMetrics: [
        { name: 'fresh_install', elapsed_seconds: 185 },
        { name: 'workspace_cache_restored', elapsed_seconds: null },
      ],
    }, { overallAssessment: 'good', reviewerConfidence: 'high', taskCompletionScore: 5 }, classifier);
    expect(result.efficiency_findings).toContain('Cold dependency installation took 185s; improve cache hit rate or image seeding.');
    expect(result.kaseki_improvement_opportunities.map(item => item.category)).toContain('dependency_cache');
  });
});
