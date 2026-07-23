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
});
