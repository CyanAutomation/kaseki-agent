import type { Job } from '../kaseki-api-types';
import type { JobScheduler } from '../job-scheduler';
import { findRunJob } from './route-helpers';

describe('findRunJob', () => {
  const job = { id: 'run-1' } as Job;

  it('prefers the durable history lookup when the scheduler provides it', async () => {
    const scheduler = {
      getJob: jest.fn().mockReturnValue(undefined),
      getJobIncludingHistory: jest.fn().mockResolvedValue(job),
    } as unknown as JobScheduler;

    await expect(findRunJob(scheduler, 'run-1')).resolves.toBe(job);
    expect(scheduler.getJobIncludingHistory).toHaveBeenCalledWith('run-1');
    expect(scheduler.getJob).not.toHaveBeenCalled();
  });

  it('uses the in-memory lookup for schedulers without history support', async () => {
    const scheduler = {
      getJob: jest.fn().mockReturnValue(job),
    } as unknown as JobScheduler;

    await expect(findRunJob(scheduler, 'run-1')).resolves.toBe(job);
    expect(scheduler.getJob).toHaveBeenCalledWith('run-1');
  });
});
