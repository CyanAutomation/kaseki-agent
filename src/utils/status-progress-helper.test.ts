import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StatusProgressHelper } from './status-progress-helper';
import type { Job, StatusResponse } from '../kaseki-api-types';
import type { KasekiApiConfig } from '../kaseki-api-config';
import type { JobScheduler } from '../job-scheduler';

function makeJob(id: string): Job {
  return { id, status: 'running' } as Job;
}

describe('StatusProgressHelper', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-progress-'));
  });

  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  it('shows command start/end/duration while ignoring validation heartbeats for substantive progress age', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:06:00Z'));
    const id = 'kaseki-1';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), [
      { event_type: 'validation_command_started', stage: 'pre-agent validation', command: 'npm run check', timestamp: '2026-01-01T00:00:00Z' },
      { stage: 'pre-agent validation', detail: 'running validation command: npm run check', timestamp: '2026-01-01T00:05:30Z' },
      { event_type: 'validation_command_finished', stage: 'pre-agent validation', command: 'npm run build', exit_code: '0', duration_seconds: '31', timestamp: '2026-01-01T00:05:40Z' },
    ].map((event) => JSON.stringify(event)).join('\n'));

    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.validationCommands).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'npm run check', status: 'running', startedAt: '2026-01-01T00:00:00Z' }),
      expect.objectContaining({ command: 'npm run build', status: 'passed', finishedAt: '2026-01-01T00:05:40Z', durationSeconds: 31 }),
    ]));
    expect(response.progressHeartbeat).toMatchObject({
      updatedAt: '2026-01-01T00:05:40Z',
      ageSeconds: 20,
      stale: false,
    });
  });

  it('does not let a timestamp-estimated Docker observation refresh real progress', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:05:00Z'));
    const id = 'kaseki-2';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), JSON.stringify({
      stage: 'pre-agent validation', detail: 'started', timestamp: '2026-01-01T00:00:00Z',
    }) + '\n');

    const scheduler = {
      getLiveProgressEvents: jest.fn(() => [{
        stage: 'pre-agent validation', message: 'observed in log tail', timestamp: '2026-01-01T00:05:00Z', timestampEstimated: true,
      }]),
    } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.progress).toMatchObject({ updatedAt: '2026-01-01T00:00:00Z', source: 'progress.jsonl' });
    expect(response.progressHeartbeat).toMatchObject({ updatedAt: '2026-01-01T00:00:00Z', ageSeconds: 300, stale: true });
  });

  it('uses the newest stage when Docker tail observations share a timestamp', () => {
    const id = 'kaseki-3';
    const scheduler = {
      getLiveProgressEvents: jest.fn(() => []),
      getLiveDockerLogTail: jest.fn(() => [
        '==> github operations preflight health check',
        '==> clone repository',
        '==> prepare node dependencies',
        '==> pi coding agent',
      ].join('\n')),
    } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.progress).toMatchObject({
      stage: 'pi coding agent',
      source: 'docker-logs',
      timestampEstimated: true,
    });
  });

  it('summarizes skipped validation commands', () => {
    const id = 'kaseki-4';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), JSON.stringify({
      event_type: 'validation_command_skipped',
      stage: 'secret scan',
      command: 'detect-secrets scan',
      timestamp: '2026-01-01T00:01:00Z',
    }) + '\n');

    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.validationCommands).toEqual([
      {
        stage: 'secret scan',
        command: 'detect-secrets scan',
        status: 'skipped',
        startedAt: '2026-01-01T00:01:00Z',
        finishedAt: '2026-01-01T00:01:00Z',
      },
    ]);
  });

  it('does not read progress for non-running jobs', () => {
    const id = 'kaseki-5';
    const scheduler = {
      getLiveProgressEvents: jest.fn(() => [{ stage: 'pi coding agent', status: 'started' }]),
      getLiveDockerLogTail: jest.fn(() => '==> pi coding agent'),
    } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'completed' } as StatusResponse;

    helper.addProgressInfo(response, { ...makeJob(id), status: 'completed' } as Job);

    expect(response.progress).toBeUndefined();
    expect(response.validationCommands).toBeUndefined();
    expect(scheduler.getLiveProgressEvents).not.toHaveBeenCalled();
    expect(scheduler.getLiveDockerLogTail).not.toHaveBeenCalled();
  });

  it('handles malformed JSON lines in progress.jsonl gracefully', () => {
    const id = 'kaseki-6';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), [
      '{not valid json',
      'null',
      '42',
      '[]',
      JSON.stringify({ stage: 'pi coding agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' }),
    ].join('\n'));

    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.progress).toMatchObject({ stage: 'pi coding agent', updatedAt: '2026-01-01T00:00:00Z' });
  });

  it('handles validation commands with missing timestamps gracefully', () => {
    const id = 'kaseki-7';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), [
      JSON.stringify({ event_type: 'validation_command_started', stage: 'validation', command: 'npm test' }),
      JSON.stringify({ event_type: 'validation_command_finished', stage: 'validation', command: 'npm test', exit_code: 0 }),
    ].join('\n'));

    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.validationCommands).toEqual([
      expect.objectContaining({ command: 'npm test', status: 'passed' }),
    ]);
  });

  it('handles validation commands with updatedAt instead of timestamp', () => {
    const id = 'kaseki-8';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), JSON.stringify({
      event_type: 'validation_command_started',
      stage: 'validation',
      command: 'npm run lint',
      updatedAt: '2026-01-01T00:00:00Z',
    }) + '\n');

    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.validationCommands).toEqual([
      expect.objectContaining({ command: 'npm run lint', status: 'running', startedAt: '2026-01-01T00:00:00Z' }),
    ]);
  });

  it('handles validation command events with missing command field', () => {
    const id = 'kaseki-9';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), [
      JSON.stringify({ event_type: 'validation_command_started', stage: 'validation' }),
      JSON.stringify({ event_type: 'validation_command_finished', stage: 'validation', exit_code: 0 }),
    ].join('\n'));

    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.validationCommands).toBeUndefined();
  });

  it('limits validation commands summary to last 8 entries', () => {
    const id = 'kaseki-10';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    const commands = Array.from({ length: 12 }, (_, i) => JSON.stringify({
      event_type: 'validation_command_finished',
      stage: 'validation',
      command: `cmd-${i}`,
      exit_code: 0,
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
    }));
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), commands.join('\n'));

    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.validationCommands).toHaveLength(8);
    expect(response.validationCommands![0].command).toBe('cmd-4');
    expect(response.validationCommands![7].command).toBe('cmd-11');
  });

  it('handles progress events with invalid timestamp format', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:05:00Z'));
    const id = 'kaseki-11';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), JSON.stringify({
      stage: 'pi coding agent',
      status: 'started',
      updatedAt: 'not-a-date',
    }) + '\n');

    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.progress).toMatchObject({ stage: 'pi coding agent', updatedAt: 'not-a-date' });
    expect(response.progressHeartbeat).toBeUndefined();
  });

  it('handles missing progress.jsonl file gracefully', () => {
    const id = 'kaseki-12';
    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.progress).toBeUndefined();
    expect(response.validationCommands).toBeUndefined();
  });

  it('prioritizes actual timestamps over estimated timestamps for progress', () => {
    const id = 'kaseki-13';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), JSON.stringify({
      stage: 'pre-agent validation',
      status: 'started',
      timestamp: '2026-01-01T00:00:00Z',
    }) + '\n');

    const scheduler = {
      getLiveProgressEvents: jest.fn(() => [{
        stage: 'pi coding agent',
        status: 'started',
        timestamp: '2026-01-01T00:02:00Z',
        timestampEstimated: true,
      }]),
    } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.progress).toMatchObject({ stage: 'pre-agent validation', updatedAt: '2026-01-01T00:00:00Z' });
  });

  it('falls back to estimated timestamps when no actual timestamps available', () => {
    const id = 'kaseki-14';
    const scheduler = {
      getLiveProgressEvents: jest.fn(() => [{
        stage: 'pi coding agent',
        status: 'started',
        timestamp: '2026-01-01T00:02:00Z',
        timestampEstimated: true,
      }]),
    } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.progress).toMatchObject({ stage: 'pi coding agent', timestampEstimated: true });
  });

  it('handles validation command with non-numeric exit_code', () => {
    const id = 'kaseki-15';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), JSON.stringify({
      event_type: 'validation_command_finished',
      stage: 'validation',
      command: 'npm test',
      exit_code: 'NaN',
      duration_seconds: 'invalid',
      timestamp: '2026-01-01T00:00:00Z',
    }) + '\n');

    const scheduler = { getLiveProgressEvents: jest.fn(() => []) } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.validationCommands).toEqual([
      expect.objectContaining({ command: 'npm test', status: 'failed' }),
    ]);
    expect(response.validationCommands![0]).not.toHaveProperty('durationSeconds');
  });

  it('handles scheduler without getLiveProgressEvents method', () => {
    const id = 'kaseki-16';
    const jobDir = path.join(resultsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'progress.jsonl'), JSON.stringify({
      stage: 'pi coding agent',
      status: 'started',
      timestamp: '2026-01-01T00:00:00Z',
    }) + '\n');

    const scheduler = {} as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.progress).toMatchObject({ stage: 'pi coding agent' });
  });

  it('handles scheduler without getLiveDockerLogTail method', () => {
    const id = 'kaseki-17';
    const scheduler = {
      getLiveProgressEvents: jest.fn(() => [{ stage: 'pi coding agent', status: 'started', timestamp: '2026-01-01T00:00:00Z' }]),
    } as unknown as JobScheduler;
    const helper = new StatusProgressHelper(scheduler, { resultsDir } as KasekiApiConfig);
    const response = { id, status: 'running' } as StatusResponse;

    helper.addProgressInfo(response, makeJob(id));

    expect(response.progress).toMatchObject({ stage: 'pi coding agent' });
  });
});
