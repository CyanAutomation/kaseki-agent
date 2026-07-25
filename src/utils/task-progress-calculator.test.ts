import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskProgressCalculator } from './task-progress-calculator';
import type { Job, StatusResponse } from '../kaseki-api-types';
import type { KasekiApiConfig } from '../kaseki-api-config';
import type { JobScheduler } from '../job-scheduler';

describe('TaskProgressCalculator', () => {
  let resultsDir: string;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-progress-'));
  });

  afterEach(() => {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  it('advances from live progress when the durable progress file is behind', () => {
    const id = 'kaseki-1';
    const runDir = path.join(resultsDir, id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'progress.jsonl'), JSON.stringify({
      stage: 'clone repository', status: 'started', timestamp: '2026-01-01T00:00:00Z',
    }) + '\n');
    const scheduler = {
      getLiveProgressEvents: jest.fn(() => [{
        stage: 'pi coding agent', status: 'started', timestamp: '2026-01-01T00:10:00Z',
      }]),
    } as unknown as JobScheduler;
    const calculator = new TaskProgressCalculator(scheduler, {
      resultsDir,
      defaultTaskMode: 'patch',
    } as KasekiApiConfig);
    const job = {
      id,
      status: 'running',
      request: { taskMode: 'patch', publishMode: 'none' },
    } as Job;
    const response = { id, status: 'running' } as StatusResponse;

    const progress = calculator.calculateProgressPercent(response, job, runDir, {});

    expect(scheduler.getLiveProgressEvents).toHaveBeenCalledWith(id, 100);
    expect(progress).toBeGreaterThan(50);
  });
});
