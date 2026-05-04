import { Request, Response } from 'express';
import { jobLookupMiddleware } from './job-lookup';
import { JobScheduler } from '../job-scheduler';
import { Job } from '../kaseki-api-types';

// Mock Job object
const mockJob: Job = {
  id: 'run-123',
  status: 'running',
  createdAt: new Date(),
  startedAt: new Date(),
  completedAt: undefined,
  resultDir: '/results/run-123',
  correlationId: 'corr-456',
  requestId: 'req-789',
  exitCode: undefined,
  failureClass: undefined,
  error: undefined,
  webhookConfig: undefined,
  finalized: false,
  request: {
    repoUrl: 'https://github.com/org/repo',
    ref: 'main',
    taskPrompt: 'Fix the bug',
  },
};

describe('jobLookupMiddleware', () => {
  let mockScheduler: jest.Mocked<JobScheduler>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextCalled: boolean;

  beforeEach(() => {
    // Create a mock scheduler
    mockScheduler = {
      getJob: jest.fn(),
    } as unknown as jest.Mocked<JobScheduler>;

    // Create mock request and response
    mockReq = {
      params: { id: 'run-123' },
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    nextCalled = false;
  });

  const next = (): void => {
    nextCalled = true;
  };

  it('should attach job to request when found', () => {
    mockScheduler.getJob.mockReturnValue(mockJob);

    const middleware = jobLookupMiddleware(mockScheduler);
    middleware(mockReq as Request, mockRes as Response, next);

    expect(mockScheduler.getJob).toHaveBeenCalledWith('run-123');
    expect(mockReq.job).toBe(mockJob);
    expect(nextCalled).toBe(true);
  });

  it('should return 404 when job not found', () => {
    mockScheduler.getJob.mockReturnValue(undefined);

    const middleware = jobLookupMiddleware(mockScheduler);
    middleware(mockReq as Request, mockRes as Response, next);

    expect(mockScheduler.getJob).toHaveBeenCalledWith('run-123');
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(nextCalled).toBe(false);
  });

  it('should return 400 when job ID is missing', () => {
    mockReq.params = {};

    const middleware = jobLookupMiddleware(mockScheduler);
    middleware(mockReq as Request, mockRes as Response, next);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(nextCalled).toBe(false);
  });

  it('should not call scheduler.getJob when job ID is missing', () => {
    mockReq.params = {};

    const middleware = jobLookupMiddleware(mockScheduler);
    middleware(mockReq as Request, mockRes as Response, next);

    expect(mockScheduler.getJob).not.toHaveBeenCalled();
  });

  it('should return proper error response format for 404', () => {
    mockScheduler.getJob.mockReturnValue(undefined);

    const middleware = jobLookupMiddleware(mockScheduler);
    middleware(mockReq as Request, mockRes as Response, next);

    // Verify that json() was called with the correct error format
    const callArgs = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(callArgs).toEqual({
      type: 'https://api.kaseki.local/errors#not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Run not found: run-123',
    });
  });
});
