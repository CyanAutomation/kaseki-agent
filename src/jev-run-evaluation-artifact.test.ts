import { buildRunEvaluationArtifact, buildRunEvaluationEvidenceSources } from './jev-run-evaluation-artifact';

const evaluation = {
  stage: 'run evaluation' as const,
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
    }, evaluation);

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
    expect(result.confidence_calibration).toMatchObject({ status: 'unassessed', calibrated: false });
  });

  test('preserves typed answer confidence and probabilities in the evaluation artifact', () => {
    const result = buildRunEvaluationArtifact(completeFacts, {
      overallAssessment: 'good', reviewerConfidence: 'high', taskCompletionScore: 5,
    }, {
      ...evaluation,
      answers: {
        reviewer_confidence: { type: 'choice', choice: 'high', probabilities: { high: 0.9, medium: 0.1 }, confidence: 0.9 },
      },
    });

    expect(result.evaluation.answers?.reviewer_confidence).toMatchObject({ confidence: 0.9, probabilities: { high: 0.9 } });
    expect(result.confidence_calibration.reason).toMatch(/labeled outcome data/i);
  });

  test('records failure triage as advisory diagnostics', () => {
    const result = buildRunEvaluationArtifact({
      ...completeFacts,
      metadata: { exit_code: 1, validation_commands_attempted: 1, validation_exit_code: 1, task_mode: 'patch' },
      validation: 'npm test: failed',
    }, {
      overallAssessment: 'poor', reviewerConfidence: 'low', taskCompletionScore: 2,
      failureDiagnosis: {
        cause: 'timeout_or_flaky',
        recommendedAction: 'retry_validation_once',
        confidence: 0.91,
        causeProbabilities: { timeout_or_flaky: 0.91, test_failure: 0.09 },
        actionProbabilities: { retry_validation_once: 0.93, inspect_diagnostics: 0.07 },
      },
    }, evaluation);

    expect(result.failure_diagnosis).toEqual({
      cause: 'timeout_or_flaky',
      recommended_action: 'retry_validation_once',
      confidence: 0.91,
      cause_probabilities: { timeout_or_flaky: 0.91, test_failure: 0.09 },
      action_probabilities: { retry_validation_once: 0.93, inspect_diagnostics: 0.07 },
    });
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
    }, { overallAssessment: 'excellent', reviewerConfidence: 'high', taskCompletionScore: 5 }, evaluation);

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
    }, { overallAssessment: 'good', reviewerConfidence: 'high', taskCompletionScore: 5 }, evaluation);
    expect(result.efficiency_findings).toContain('Cold dependency installation took 185s; improve cache hit rate or image seeding.');
    expect(result.kaseki_improvement_opportunities.map(item => item.category)).toContain('dependency_cache');
  });

  test('reconciles validation counts from nested command evidence and ignores free-text fallback mentions', () => {
    const result = buildRunEvaluationArtifact({
      ...completeFacts,
      metadata: {
        exit_code: 0,
        validation_commands_attempted: 0,
        validation_exit_code: 0,
        phases: { validation: { commands_attempted: 2, results: [
          { command: 'npm test', status: 'passed', exit_code: 0 },
          { command: 'npm run build', status: 'passed', exit_code: 0 },
        ] } },
      },
      goalSetting: {
        success_criteria: ['Refactor the helper'],
        confidence: 'high',
        reasoning: 'A runner-up fallback option was considered and rejected.',
      },
      validation: '',
      validationSources: [],
      presentSources: ['goal-setting.json', 'goal-check.json', 'git.diff', 'changed-files.txt'],
    }, { overallAssessment: 'good', reviewerConfidence: 'high', taskCompletionScore: 5 }, evaluation);

    expect(result.phase_scorecard.validation).toMatchObject({ outcome: 'succeeded', commands_attempted: 2 });
    expect(result.phase_scorecard['goal-setting']).toMatchObject({ outcome: 'succeeded' });
    expect(result.contradictions).toEqual([]);
  });

  test('uses only the latest validation invocation and merges its timing row with phase evidence', () => {
    const result = buildRunEvaluationArtifact({
      ...completeFacts,
      metadata: {
        exit_code: 0,
        validation_commands_attempted: 2,
        validation_exit_code: 0,
        phases: { validation: { commands_attempted: 2, results: [
          { command: 'npm test', stage: 'validation', attempt: 1, invocation: 1, status: 'failed', exit_code: 1 },
          { command: 'npm test', stage: 'validation', attempt: 2, invocation: 2, status: 'passed', exit_code: 0 },
        ] } },
      },
      timingManifest: { validation_timings: [
        { command: 'npm test', exit_code: 1, details: 'stage=validation;attempt=1;invocation=1' },
        { command: 'npm test', exit_code: 0, details: 'stage=validation;attempt=2;invocation=2' },
      ] },
      validation: '',
      validationSources: [],
    }, { overallAssessment: 'good', reviewerConfidence: 'high', taskCompletionScore: 5 }, evaluation);

    expect(result.phase_scorecard.validation).toMatchObject({ outcome: 'succeeded', commands_attempted: 2 });
  });
});
