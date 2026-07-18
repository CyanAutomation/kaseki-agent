import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StatusLifecycleHelper } from './status-lifecycle-helper';
import type { Job, StatusResponse } from '../kaseki-api-types';
import type { KasekiApiConfig } from '../kaseki-api-config';

function makeConfig(resultsDir: string): KasekiApiConfig {
  return { resultsDir } as KasekiApiConfig;
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return { id: 'job-1', status: 'running', ...overrides } as Job;
}

function makeResponse(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return { id: 'job-1', status: 'running', ...overrides } as StatusResponse;
}

describe('StatusLifecycleHelper', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-lifecycle-'));
  });

  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  it.each([
    ['queued', 'queued'],
    ['completed', 'terminal'],
    ['failed', 'terminal'],
  ] as const)('sets lifecycle phase for %s jobs', (status, lifecyclePhase) => {
    const response = makeResponse({ status });
    const job = makeJob({ status });

    new StatusLifecycleHelper(makeConfig(resultsDir)).addLifecycleInfo(response, job, {});

    expect(response.lifecyclePhase).toBe(lifecyclePhase);
    expect(response.cancellable).toBe(status === 'queued');
  });

  it('marks running artifact/report stages as finalizing', () => {
    const response = makeResponse({ progress: { stage: 'run evaluation', message: 'finalizing report' } as any });

    new StatusLifecycleHelper(makeConfig(resultsDir)).addLifecycleInfo(response, makeJob(), {});

    expect(response.lifecyclePhase).toBe('finalizing');
  });

  it('derives live retry attempt and next retry delay', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:05Z'));
    const response = makeResponse({
      progress: {
        stage: 'pi coding agent',
        message: 'provider retry scheduled after failure attempt 2/3 in 30s',
        updatedAt: '2026-01-01T00:00:00Z',
      } as any,
    });

    new StatusLifecycleHelper(makeConfig(resultsDir)).addLifecycleInfo(response, makeJob(), {});

    expect(response.attempt).toMatchObject({ current: 2, maximum: 3, state: 'retrying', nextRetryInSeconds: 25 });
    expect(response.diagnosis).toMatchObject({ category: 'provider_error', retryCount: 1, retryExhausted: false });
    expect(response.progress?.displayName).toBe('Coding attempt 2/3 — retrying');
  });

  it('uses critical scouting contract failure diagnostics', () => {
    const job = makeJob({ status: 'failed', resultDir: path.join(resultsDir, 'job-scout') });
    fs.mkdirSync(job.resultDir!, { recursive: true });
    fs.writeFileSync(path.join(job.resultDir!, 'scouting-validation-errors.jsonl'), JSON.stringify({
      severity: 'critical',
      field: 'scouting-candidate.json',
      actual: 'missing',
      suggestion: 'write candidate artifact',
    }));
    const response = makeResponse({ status: 'failed' });

    new StatusLifecycleHelper(makeConfig(resultsDir)).addLifecycleInfo(response, job, {
      failed_command: 'pi scouting agent',
      scouting_attempts: 2,
      scouting_max_attempts: 2,
      provider_error_provider: 'gateway',
    });

    expect(response.attempt).toMatchObject({ phase: 'scouting', current: 2, maximum: 2, state: 'exhausted', provider: 'gateway' });
    expect(response.diagnosis).toMatchObject({
      category: 'artifact_contract',
      summary: 'scouting-candidate.json: missing',
      remediation: 'write candidate artifact',
      retryExhausted: true,
    });
  });

  it('reports provider retry metadata for terminal failures', () => {
    const response = makeResponse({ status: 'failed', progress: { stage: 'pi coding agent' } as any });

    new StatusLifecycleHelper(makeConfig(resultsDir)).addLifecycleInfo(response, makeJob({ status: 'failed' }), {
      provider_error_retry_attempt_count: 3,
      provider_error_retry_result: 'failed',
      provider_error_message: 'HTTP 503',
      provider_error_phase: 'pi coding agent',
      provider_error_provider: 'gateway',
      provider_error_type: 'provider_error',
    });

    expect(response.attempt).toMatchObject({ current: 3, maximum: 3, state: 'exhausted', provider: 'gateway' });
    expect(response.diagnosis).toMatchObject({ severity: 'error', retryCount: 3, retryExhausted: true });
    expect(response.progress?.displayName).toBe('Coding attempt 3/3 — exhausted');
  });

  it('adds stale progress heartbeat warning only when no diagnosis exists', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:03:00Z'));
    const response = makeResponse({
      progress: { stage: 'pi coding agent', updatedAt: '2026-01-01T00:00:00Z' } as any,
    });

    new StatusLifecycleHelper(makeConfig(resultsDir)).addLifecycleInfo(response, makeJob(), {});

    expect(response.progressHeartbeat).toEqual({
      updatedAt: '2026-01-01T00:00:00Z',
      ageSeconds: 180,
      stale: true,
    });
    expect(response.diagnosis).toMatchObject({ category: 'stale_progress' });
  });
});
