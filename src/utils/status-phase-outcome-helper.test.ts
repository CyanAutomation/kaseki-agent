import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isExecutionInProgress, StatusPhaseOutcomeHelper } from './status-phase-outcome-helper';
import type { Job, StatusResponse } from '../kaseki-api-types';
import type { KasekiApiConfig } from '../kaseki-api-config';
import type { JobScheduler } from '../job-scheduler';

function makeConfig(resultsDir: string): KasekiApiConfig {
  return { resultsDir } as KasekiApiConfig;
}

function makeScheduler(events: Array<Record<string, unknown>> = []): JobScheduler {
  return { getLiveProgressEvents: jest.fn().mockReturnValue(events) } as unknown as JobScheduler;
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return { id: 'job-1', status: 'running', ...overrides } as Job;
}

function makeResponse(stage?: string): StatusResponse {
  return { id: 'job-1', status: 'running', progress: stage ? { stage } as any : undefined };
}

describe('isExecutionInProgress', () => {
  it('returns true for an IN_PROGRESS outcome with a RUNNING phase', () => {
    expect(isExecutionInProgress({ phase: 'RUNNING', outcome: 'IN_PROGRESS' })).toBe(true);
  });

  it('returns false for an IN_PROGRESS outcome with a non-RUNNING phase', () => {
    expect(isExecutionInProgress({ phase: 'COMPLETED', outcome: 'IN_PROGRESS' })).toBe(false);
  });

  it('returns false when a RUNNING phase has a terminal outcome', () => {
    expect(isExecutionInProgress({ phase: 'RUNNING', outcome: 'COMPLETED' })).toBe(false);
  });
});

describe('StatusPhaseOutcomeHelper', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-outcome-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  it('keeps both phases not reached for pre-agent validation failures', () => {
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'phase_not_reached', message: 'phase=scouting reason=pre_agent_validation_failed' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('pre-agent validation');

    helper.addPhaseOutcome(response, makeJob({ status: 'failed' }), { failed_command: 'pre-agent validation' });

    expect(response.phaseOutcome).toMatchObject({ scouting: 'not_reached', weaving: 'not_reached' });
  });

  it('ignores GitHub operations preflight as weaving evidence', () => {
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'github operations preflight health check', status: 'started' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('github operations preflight health check');

    helper.addPhaseOutcome(response, makeJob(), {});

    expect(response.phaseOutcome).toMatchObject({ scouting: 'not_reached', weaving: 'not_reached' });
  });

  it('does not advance phases from an un-timestamped Docker log observation', () => {
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'pi coding agent', status: 'started', timestampEstimated: true }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('');

    helper.addPhaseOutcome(response, makeJob(), {});

    expect(response.phaseOutcome).toMatchObject({ scouting: 'not_reached', weaving: 'not_reached' });
  });

  it('uses scouting artifact metadata as scouting-start evidence', () => {
    const job = makeJob({ id: 'job-artifact' });
    fs.mkdirSync(path.join(resultsDir, job.id), { recursive: true });
    fs.writeFileSync(path.join(resultsDir, job.id, 'scouting.json'), '{}');
    const helper = new StatusPhaseOutcomeHelper(makeScheduler(), makeConfig(resultsDir));
    const response = makeResponse('pi scouting agent');

    helper.addPhaseOutcome(response, job, {});

    expect(response.phaseOutcome).toMatchObject({ scouting: 'running', weaving: 'not_reached' });
  });

  it('combines file and live events to derive phase timestamps', () => {
    const job = makeJob({ id: 'job-events' });
    const runDir = path.join(resultsDir, job.id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'progress.jsonl'), [
      JSON.stringify({ stage: 'pi scouting agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ stage: 'pi scouting agent', status: 'finished', timestamp: '2026-01-01T00:01:00Z' }),
    ].join('\n'));
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'pi coding agent', status: 'started', timestamp: '2026-01-01T00:02:00Z' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('pi coding agent');

    helper.addPhaseOutcome(response, job, {});

    expect(response.phaseOutcome).toMatchObject({
      scouting: 'completed',
      weaving: 'running',
      scoutingStartedAt: '2026-01-01T00:00:00Z',
      scoutingCompletedAt: '2026-01-01T00:01:00Z',
      weavingStartedAt: '2026-01-01T00:02:00Z',
    });
  });

  it('does not regress completed scouting or active weaving when a later status read lacks retained events', () => {
    const job = makeJob({ id: 'job-monotonic' });
    const scheduler = makeScheduler([{ stage: 'pi coding agent', status: 'started', timestamp: '2026-01-01T00:02:00Z' }]);
    const helper = new StatusPhaseOutcomeHelper(scheduler, makeConfig(resultsDir));

    const first = makeResponse('pi coding agent');
    helper.addPhaseOutcome(first, job, {});
    expect(first.phaseOutcome).toMatchObject({ scouting: 'completed', weaving: 'running' });

    (scheduler.getLiveProgressEvents as jest.Mock).mockReturnValue([]);
    const second = makeResponse('pre-agent validation');
    helper.addPhaseOutcome(second, job, {});

    expect(second.phaseOutcome).toMatchObject({ scouting: 'completed', weaving: 'running' });
  });

  it('tolerates malformed progress jsonl lines and unreadable fallback diagnostics', () => {
    const job = makeJob({ id: 'job-malformed' });
    const runDir = path.join(resultsDir, job.id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'progress.jsonl'), [
      '{not json',
      JSON.stringify({ stage: 'pi scouting agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' }),
      '',
    ].join('\n'));
    const helper = new StatusPhaseOutcomeHelper(makeScheduler(), makeConfig(resultsDir));
    const response = makeResponse('pi scouting agent');

    helper.addPhaseOutcome(response, job, {});

    expect(response.phaseOutcome).toMatchObject({
      scouting: 'running',
      weaving: 'not_reached',
      scoutingStartedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('uses fallback reason_code when recovery_reason_code is absent', () => {
    const job = makeJob({ id: 'job-fallback-reason' });
    const runDir = path.join(resultsDir, job.id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), JSON.stringify({
      reason_code: 'minimal_fallback_recovered',
      recovered: true,
    }) + '\n');
    const helper = new StatusPhaseOutcomeHelper(makeScheduler(), makeConfig(resultsDir));
    const response = makeResponse('pi coding agent');

    helper.addPhaseOutcome(response, job, {});

    expect(response.phaseOutcome).toMatchObject({
      scouting: 'completed_with_fallback',
      scoutingFallbackReason: 'minimal_fallback_recovered',
    });
  });

  it('marks failed scouting and explains the failed command', () => {
    const helper = new StatusPhaseOutcomeHelper(makeScheduler(), makeConfig(resultsDir));
    const response = makeResponse('pi scouting agent');

    helper.addPhaseOutcome(response, makeJob({ status: 'failed' }), { failed_command: 'pi scouting agent' });

    expect(response.phaseOutcome).toMatchObject({
      scouting: 'failed',
      weaving: 'not_reached',
      explanation: expect.stringContaining('pi scouting agent'),
    });
  });

  it('does not mark weaving complete when scouting fails after goal-setting', () => {
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'pi goal-setting agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('pi scouting agent');

    helper.addPhaseOutcome(response, makeJob({ status: 'failed' }), { failed_command: 'pi scouting agent' });

    expect(response.phaseOutcome).toMatchObject({ scouting: 'failed', weaving: 'not_reached' });
  });

  it('marks failed weaving after weaving has started', () => {
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'pi coding agent', status: 'started' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('pi coding agent');

    helper.addPhaseOutcome(response, makeJob({ status: 'failed' }), { failed_command: 'pi coding agent' });

    expect(response.phaseOutcome).toMatchObject({ scouting: 'completed', weaving: 'failed' });
  });

  it('reports default-enabled scouting as completed once weaving begins without retained scout evidence', () => {
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'pi coding agent', status: 'started' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('pi coding agent');

    helper.addPhaseOutcome(response, makeJob(), {});

    expect(response.phaseOutcome).toMatchObject({ scouting: 'completed', weaving: 'running' });
  });

  it('keeps completed scouting visible while collecting the coding diff', () => {
    const helper = new StatusPhaseOutcomeHelper(makeScheduler(), makeConfig(resultsDir));
    const response = makeResponse('collect agent diff');

    helper.addPhaseOutcome(response, makeJob(), {});

    expect(response.phaseOutcome).toMatchObject({ scouting: 'completed', weaving: 'running' });
  });

  it('does not regress completed phase visibility during secret scanning', () => {
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'pi coding agent', status: 'started' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('secret scan');

    helper.addPhaseOutcome(response, makeJob(), {});

    expect(response.phaseOutcome).toMatchObject({ scouting: 'completed', weaving: 'completed' });
  });

  it('does not report scouting as running after the job reaches a terminal status', () => {
    const helper = new StatusPhaseOutcomeHelper(makeScheduler(), makeConfig(resultsDir));
    const response = makeResponse('pi scouting agent');

    helper.addPhaseOutcome(response, makeJob({ status: 'completed' }), {});

    expect(response.phaseOutcome).toMatchObject({ scouting: 'completed', weaving: 'not_reached' });
  });

  it('does not report weaving as running after the job reaches a terminal status', () => {
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'pi coding agent', status: 'started' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('pi coding agent');

    helper.addPhaseOutcome(response, makeJob({ status: 'completed' }), {});

    expect(response.phaseOutcome).toMatchObject({ scouting: 'completed', weaving: 'completed' });
  });

  it('reports scouting as skipped when it was explicitly disabled', () => {
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'pi coding agent', status: 'started' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('pi coding agent');

    helper.addPhaseOutcome(response, makeJob({ request: { scouting: { enabled: false } } as any }), {});

    expect(response.phaseOutcome).toMatchObject({ scouting: 'skipped', weaving: 'running' });
  });

  it('keeps a validated scouting fallback visible while later quality checks run', () => {
    const job = makeJob({ id: 'job-fallback' });
    const runDir = path.join(resultsDir, job.id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), JSON.stringify({
      reason_code: 'patch_retry_exhausted_fallback_recovered',
      recovered: true,
      recovery_reason_code: 'patch_retry_exhausted_fallback_recovered',
    }) + '\n');
    const helper = new StatusPhaseOutcomeHelper(
      makeScheduler([{ stage: 'pi coding agent', status: 'started' }]),
      makeConfig(resultsDir),
    );
    const response = makeResponse('quality checks');

    helper.addPhaseOutcome(response, job, {});

    expect(response.phaseOutcome).toMatchObject({
      scouting: 'completed_with_fallback',
      scoutingFallback: true,
      scoutingFallbackReason: 'patch_retry_exhausted_fallback_recovered',
      weaving: 'completed',
    });
    expect(response.phaseOutcome?.explanation).toContain('validated fallback handoff');
  });

  describe('monotonic high-water mark behavior', () => {
    it('enforces scouting failed outcome even after cleared live events', () => {
      const job = makeJob({ id: 'job-hwm-failed' });
      const scheduler = makeScheduler([
        { stage: 'pi scouting agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' }
      ]);
      const helper = new StatusPhaseOutcomeHelper(scheduler, makeConfig(resultsDir));

      // First status read: scouting fails
      const first = makeResponse('pi scouting agent');
      helper.addPhaseOutcome(first, makeJob({ ...job, status: 'failed' }), { failed_command: 'pi scouting agent' });
      expect(first.phaseOutcome).toMatchObject({ scouting: 'failed', weaving: 'not_reached' });

      // Second status read: job recovered to running with empty events (should preserve failed)
      (scheduler.getLiveProgressEvents as jest.Mock).mockReturnValue([]);
      const second = makeResponse('');
      helper.addPhaseOutcome(second, job, {});

      expect(second.phaseOutcome).toMatchObject({ scouting: 'failed' });
    });

    it('does not downgrade completed scouting to running even with running stage', () => {
      const job = makeJob({ id: 'job-hwm-completed' });
      const scheduler = makeScheduler([{ stage: 'pi coding agent', status: 'started' }]);
      const helper = new StatusPhaseOutcomeHelper(scheduler, makeConfig(resultsDir));

      // First status read: scouting completed, weaving running
      const first = makeResponse('pi coding agent');
      helper.addPhaseOutcome(first, job, {});
      expect(first.phaseOutcome).toMatchObject({ scouting: 'completed', weaving: 'running' });

      // Second status read: events suggest scouting running (should preserve completed)
      (scheduler.getLiveProgressEvents as jest.Mock).mockReturnValue([
        { stage: 'pi scouting agent', status: 'started' }
      ]);
      const second = makeResponse('pi scouting agent');
      helper.addPhaseOutcome(second, job, {});

      expect(second.phaseOutcome).toMatchObject({ scouting: 'completed' });
    });

    it('preserves phase timestamps across status reads when events are lost', () => {
      const job = makeJob({ id: 'job-hwm-timestamps' });
      const scheduler = makeScheduler([
        { stage: 'pi scouting agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' },
        { stage: 'pi scouting agent', status: 'finished', timestamp: '2026-01-01T00:01:00Z' },
      ]);
      const helper = new StatusPhaseOutcomeHelper(scheduler, makeConfig(resultsDir));

      // First status read: capture timestamps
      const first = makeResponse('pi coding agent');
      helper.addPhaseOutcome(first, job, {});
      expect(first.phaseOutcome).toMatchObject({
        scoutingStartedAt: '2026-01-01T00:00:00Z',
        scoutingCompletedAt: '2026-01-01T00:01:00Z',
      });

      // Second status read: events cleared (should preserve timestamps)
      (scheduler.getLiveProgressEvents as jest.Mock).mockReturnValue([]);
      const second = makeResponse('');
      helper.addPhaseOutcome(second, job, {});

      expect(second.phaseOutcome).toMatchObject({
        scoutingStartedAt: '2026-01-01T00:00:00Z',
        scoutingCompletedAt: '2026-01-01T00:01:00Z',
      });
    });

    it('clears high-water mark cache when job transitions to terminal state', () => {
      const job = makeJob({ id: 'job-hwm-terminal' });
      const scheduler = makeScheduler([{ stage: 'pi scouting agent', status: 'started' }]);
      const helper = new StatusPhaseOutcomeHelper(scheduler, makeConfig(resultsDir));

      // First: running job with scouting running
      const first = makeResponse('pi scouting agent');
      helper.addPhaseOutcome(first, job, {});
      expect(first.phaseOutcome).toMatchObject({ scouting: 'running' });

      // Second: job completed (should derive fresh outcome, not use cache)
      const second = makeResponse('pi scouting agent');
      helper.addPhaseOutcome(second, makeJob({ ...job, status: 'completed' }), {});

      expect(second.phaseOutcome).toMatchObject({ scouting: 'completed' });
    });
  });

  describe('event source fallback and malformed stream handling', () => {
    it('handles missing progress.jsonl file gracefully', () => {
      const job = makeJob({ id: 'job-no-progress' });
      fs.mkdirSync(path.join(resultsDir, job.id), { recursive: true });
      // No progress.jsonl file created
      const helper = new StatusPhaseOutcomeHelper(makeScheduler(), makeConfig(resultsDir));
      const response = makeResponse('');

      helper.addPhaseOutcome(response, job, {});

      expect(response.phaseOutcome).toMatchObject({ scouting: 'not_reached', weaving: 'not_reached' });
    });

    it('handles empty progress.jsonl file', () => {
      const job = makeJob({ id: 'job-empty-progress' });
      const runDir = path.join(resultsDir, job.id);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'progress.jsonl'), '');
      const helper = new StatusPhaseOutcomeHelper(makeScheduler(), makeConfig(resultsDir));
      const response = makeResponse('');

      helper.addPhaseOutcome(response, job, {});

      expect(response.phaseOutcome).toMatchObject({ scouting: 'not_reached', weaving: 'not_reached' });
    });

    it('tolerates all-malformed progress.jsonl (no valid events)', () => {
      const job = makeJob({ id: 'job-all-malformed' });
      const runDir = path.join(resultsDir, job.id);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'progress.jsonl'), [
        '{not json',
        'also not json',
        '{"incomplete":',
        '',
      ].join('\n'));
      const helper = new StatusPhaseOutcomeHelper(makeScheduler(), makeConfig(resultsDir));
      const response = makeResponse('');

      helper.addPhaseOutcome(response, job, {});

      expect(response.phaseOutcome).toMatchObject({ scouting: 'not_reached', weaving: 'not_reached' });
    });

    it('uses live events when progress.jsonl is missing', () => {
      const job = makeJob({ id: 'job-live-only' });
      fs.mkdirSync(path.join(resultsDir, job.id), { recursive: true });
      // No progress.jsonl, but live events available
      const helper = new StatusPhaseOutcomeHelper(
        makeScheduler([
          { stage: 'pi scouting agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' }
        ]),
        makeConfig(resultsDir),
      );
      const response = makeResponse('pi scouting agent');

      helper.addPhaseOutcome(response, job, {});

      expect(response.phaseOutcome).toMatchObject({
        scouting: 'running',
        scoutingStartedAt: '2026-01-01T00:00:00Z',
      });
    });

    it('merges valid events from partially malformed progress.jsonl with live events', () => {
      const job = makeJob({ id: 'job-partial-malformed' });
      const runDir = path.join(resultsDir, job.id);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'progress.jsonl'), [
        '{malformed',
        JSON.stringify({ stage: 'pi scouting agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' }),
        'also bad',
        JSON.stringify({ stage: 'pi scouting agent', status: 'finished', timestamp: '2026-01-01T00:01:00Z' }),
      ].join('\n'));
      const helper = new StatusPhaseOutcomeHelper(
        makeScheduler([
          { stage: 'pi coding agent', status: 'started', timestamp: '2026-01-01T00:02:00Z' }
        ]),
        makeConfig(resultsDir),
      );
      const response = makeResponse('pi coding agent');

      helper.addPhaseOutcome(response, job, {});

      expect(response.phaseOutcome).toMatchObject({
        scouting: 'completed',
        weaving: 'running',
        scoutingStartedAt: '2026-01-01T00:00:00Z',
        scoutingCompletedAt: '2026-01-01T00:01:00Z',
        weavingStartedAt: '2026-01-01T00:02:00Z',
      });
    });
  });

  describe('phase ranking edge cases', () => {
    it('enforces failed > completed ranking for weaving', () => {
      const job = makeJob({ id: 'job-ranking-weaving' });
      const scheduler = makeScheduler([
        { stage: 'pi coding agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' },
        { stage: 'pi coding agent', status: 'finished', timestamp: '2026-01-01T00:01:00Z' },
      ]);
      const helper = new StatusPhaseOutcomeHelper(scheduler, makeConfig(resultsDir));

      // First: weaving completed
      const first = makeResponse('validation');
      helper.addPhaseOutcome(first, job, {});
      expect(first.phaseOutcome).toMatchObject({ weaving: 'completed' });

      // Second: weaving failed (should override completed)
      const second = makeResponse('pi coding agent');
      helper.addPhaseOutcome(second, makeJob({ ...job, status: 'failed' }), { failed_command: 'pi coding agent' });

      expect(second.phaseOutcome).toMatchObject({ weaving: 'failed' });
    });

    it('enforces skipped > running ranking for scouting', () => {
      const job = makeJob({ id: 'job-ranking-skipped', request: { scouting: { enabled: false } } as any });
      const scheduler = makeScheduler([{ stage: 'pi coding agent', status: 'started' }]);
      const helper = new StatusPhaseOutcomeHelper(scheduler, makeConfig(resultsDir));

      // First: scouting skipped (disabled)
      const first = makeResponse('pi coding agent');
      helper.addPhaseOutcome(first, job, {});
      expect(first.phaseOutcome).toMatchObject({ scouting: 'skipped' });

      // Second: events suggest scouting running (should preserve skipped)
      (scheduler.getLiveProgressEvents as jest.Mock).mockReturnValue([
        { stage: 'pi scouting agent', status: 'started' }
      ]);
      const second = makeResponse('pi scouting agent');
      helper.addPhaseOutcome(second, job, {});

      expect(second.phaseOutcome).toMatchObject({ scouting: 'skipped' });
    });
  });
});

