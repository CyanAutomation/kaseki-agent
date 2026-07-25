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
});
