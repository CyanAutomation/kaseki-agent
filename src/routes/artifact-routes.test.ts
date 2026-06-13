import * as fs from 'fs';
import express from 'express';
import { Server } from 'http';
import { JobScheduler } from '../job-scheduler';
import { ResultCache } from '../result-cache';
import { KasekiApiConfig } from '../kaseki-api-config';
import { Job } from '../kaseki-api-types';
import { readArtifactContent, createArtifactRoutes } from './artifact-routes';

// Mock dependencies
jest.mock('fs');
jest.mock('../job-scheduler');
jest.mock('../result-cache');

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve, reject) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
    nextServer.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected test server to bind to a TCP port');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe('artifact-routes', () => {
  let mockScheduler: jest.Mocked<JobScheduler>;
  let mockCache: jest.Mocked<ResultCache>;
  let mockConfig: KasekiApiConfig;

  beforeEach(() => {
    mockScheduler = {
      getJob: jest.fn(),
    } as unknown as jest.Mocked<JobScheduler>;
    mockCache = {
      getOrLoad: jest.fn(),
      getStats: jest.fn(),
    } as any;
    mockConfig = {
      resultsDir: '/results',
      agentTimeoutSeconds: 3600,
      defaultTaskMode: 'fix',
      port: 3000,
      apiKeys: [],
      maxConcurrentRuns: 5,
      maxDiffBytes: 400000,
      logLevel: 'info',
    } as unknown as KasekiApiConfig;

    jest.clearAllMocks();
  });

  describe('readArtifactContent', () => {
    it('should read directly from disk for non-terminal jobs (queued)', () => {
      const filePath = '/path/to/file.txt';
      const content = 'test content';
      (fs.readFileSync as jest.Mock).mockReturnValue(content);

      const result = readArtifactContent(filePath, 'queued', mockCache);

      expect(result).toBe(content);
      expect(fs.readFileSync).toHaveBeenCalledWith(filePath, 'utf-8');
      expect(mockCache.getOrLoad).not.toHaveBeenCalled();
    });

    it('should read directly from disk for non-terminal jobs (running)', () => {
      const filePath = '/path/to/file.txt';
      const content = 'test content';
      (fs.readFileSync as jest.Mock).mockReturnValue(content);

      const result = readArtifactContent(filePath, 'running', mockCache);

      expect(result).toBe(content);
      expect(fs.readFileSync).toHaveBeenCalledWith(filePath, 'utf-8');
      expect(mockCache.getOrLoad).not.toHaveBeenCalled();
    });

    it('should return null if disk read fails for non-terminal job', () => {
      const filePath = '/path/to/file.txt';
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = readArtifactContent(filePath, 'running', mockCache);

      expect(result).toBeNull();
    });

    it('should use cache for terminal jobs (completed)', () => {
      const filePath = '/path/to/file.txt';
      const content = 'cached content';
      (mockCache.getOrLoad as jest.Mock).mockReturnValue(content);

      const result = readArtifactContent(filePath, 'completed', mockCache);

      expect(result).toBe(content);
      expect(mockCache.getOrLoad).toHaveBeenCalledWith(filePath);
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('should use cache for terminal jobs (failed)', () => {
      const filePath = '/path/to/file.txt';
      const content = 'cached content';
      (mockCache.getOrLoad as jest.Mock).mockReturnValue(content);

      const result = readArtifactContent(filePath, 'failed', mockCache);

      expect(result).toBe(content);
      expect(mockCache.getOrLoad).toHaveBeenCalledWith(filePath);
    });

    it('should return null if cache returns null for terminal job', () => {
      const filePath = '/path/to/file.txt';
      (mockCache.getOrLoad as jest.Mock).mockReturnValue(null);

      const result = readArtifactContent(filePath, 'completed', mockCache);

      expect(result).toBeNull();
    });
  });

  describe('createArtifactRoutes', () => {
    function createMountedArtifactApp(): express.Express {
      const app = express();
      app.use('/api', createArtifactRoutes(mockScheduler, mockConfig, mockCache));
      return app;
    }

    function mockCompletedJob(id = 'kaseki-1'): Job {
      const job: Job = {
        id,
        status: 'completed',
        request: {
          repoUrl: 'https://github.com/example/repo.git',
          ref: 'main',
          taskPrompt: 'Test artifact route',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      mockScheduler.getJob.mockReturnValue(job);
      return job;
    }

    it('serves a registered artifact for a known job', async () => {
      const job = mockCompletedJob();
      const content = '{"id":"kaseki-1","status":"completed"}';
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        size: Buffer.byteLength(content),
      });
      mockCache.getOrLoad.mockReturnValue(content);

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/metadata.json`);
        const text = await response.text();
        const body = JSON.parse(text);

        expect(response.status).toBe(200);
        expect(mockScheduler.getJob).toHaveBeenCalledWith(job.id);
        expect(fs.statSync).toHaveBeenCalledWith('/results/kaseki-1/metadata.json');
        expect(mockCache.getOrLoad).toHaveBeenCalledWith('/results/kaseki-1/metadata.json');
        expect(body).toEqual({
          file: 'metadata.json',
          contentType: 'application/json',
          size: Buffer.byteLength(content),
          content,
        });
      } finally {
        await close(server);
      }
    });

    it('returns a contract error for an artifact name outside the registry', async () => {
      const job = mockCompletedJob();
      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/not-a-kaseki-artifact.txt`);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(fs.statSync).not.toHaveBeenCalled();
        expect(mockCache.getOrLoad).not.toHaveBeenCalled();
        expect(body).toEqual(expect.objectContaining({
          type: 'https://api.kaseki.local/errors#bad-request',
          title: 'Bad Request',
          status: 400,
          detail: expect.stringContaining('Artifact not found in registry: not-a-kaseki-artifact.txt'),
        }));
      } finally {
        await close(server);
      }
    });

    it('returns a contract error for a registered artifact that is missing on disk', async () => {
      const job = mockCompletedJob();
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('missing artifact');
      });

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/metadata.json`);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(mockCache.getOrLoad).not.toHaveBeenCalled();
        expect(body).toEqual({
          type: 'https://api.kaseki.local/errors#bad-request',
          title: 'Bad Request',
          status: 400,
          detail: 'Artifact not found: metadata.json',
        });
      } finally {
        await close(server);
      }
    });
  });
});
