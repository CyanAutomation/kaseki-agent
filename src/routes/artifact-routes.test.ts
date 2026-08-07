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

  function mockFileStats(files: Record<string, { size?: number; content?: string }>): void {
    (fs.statSync as jest.Mock).mockImplementation((filePath: string) => {
      const fileName = filePath.split('/').pop() || filePath;
      const file = files[fileName];
      if (!file) {
        throw new Error(`missing artifact: ${fileName}`);
      }
      return {
        isFile: () => true,
        size: file.size ?? Buffer.byteLength(file.content ?? ''),
        mtimeMs: 1,
      };
    });
    (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
      const fileName = filePath.split('/').pop() || filePath;
      return Object.prototype.hasOwnProperty.call(files, fileName);
    });
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      const fileName = filePath.split('/').pop() || filePath;
      const file = files[fileName];
      if (!file) {
        throw new Error(`missing artifact: ${fileName}`);
      }
      return file.content ?? '';
    });
  }

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

    it('lists only available artifacts by default and exposes the full registry on demand', async () => {
      const job = mockCompletedJob();
      mockFileStats({ 'stdout.log': { content: 'worker output\n' } });
      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const available = await (await fetch(`${url}/api/runs/${job.id}/artifacts`)).json();
        const manifest = await (await fetch(`${url}/api/runs/${job.id}/artifacts?manifest=true`)).json();

        expect(available.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'stdout.log', available: true })]));
        expect(available.artifacts.every((artifact: { available: boolean }) => artifact.available)).toBe(true);
        expect(manifest.artifacts.length).toBeGreaterThan(available.artifacts.length);
        expect(manifest.artifacts.some((artifact: { available: boolean }) => !artifact.available)).toBe(true);
      } finally {
        await close(server);
      }
    });

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

    it.each([
      ['hashline-events.jsonl', 'application/x-jsonl', '{"status":"rejected"}\n'],
      ['hashline-summary.json', 'application/json', '{"errors":1}\n'],
      ['hashline-validation.log', 'text/plain', 'Fatal error: invalid hashline\n'],
    ])('serves registered hashline artifact %s', async (fileName, contentType, content) => {
      const job = mockCompletedJob();
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        size: Buffer.byteLength(content),
      });
      mockCache.getOrLoad.mockReturnValue(content);

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/${fileName}`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(fs.statSync).toHaveBeenCalledWith(`/results/${job.id}/${fileName}`);
        expect(body).toEqual({
          file: fileName,
          contentType,
          size: Buffer.byteLength(content),
          content,
        });
      } finally {
        await close(server);
      }
    });

    it('returns a bounded tail for line-oriented artifacts', async () => {
      const job = mockCompletedJob();
      const content = '{"line":1}\n{"line":2}\n{"line":3}\n';
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        size: Buffer.byteLength(content),
      });
      mockCache.getOrLoad.mockReturnValue(content);

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/pi-events.jsonl?tail=2`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toEqual({
          file: 'pi-events.jsonl',
          contentType: 'application/x-jsonl',
          size: Buffer.byteLength(content),
          content: '{"line":2}\n{"line":3}\n',
          truncated: true,
          tailLines: 2,
        });
      } finally {
        await close(server);
      }
    });

    it('returns a validation error for invalid tail values', async () => {
      const job = mockCompletedJob();
      const content = 'line 1\nline 2\n';
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        size: Buffer.byteLength(content),
      });
      mockCache.getOrLoad.mockReturnValue(content);

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/stdout.log?tail=abc`);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.detail).toBe('tail must be a positive integer');
      } finally {
        await close(server);
      }
    });

    it('serves live stdout for a running job before the stdout artifact exists', async () => {
      const job: Job = {
        ...mockCompletedJob(),
        status: 'running',
      };
      mockScheduler.getJob.mockReturnValue(job);
      mockScheduler.getLiveDockerLogTail = jest.fn().mockReturnValue('live line\n');
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('stdout not flushed');
      });

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/stdout.log`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(mockScheduler.getLiveDockerLogTail).toHaveBeenCalledWith(job.id, 300);
        expect(body).toEqual({
          file: 'stdout.log',
          contentType: 'text/plain',
          size: Buffer.byteLength('live line\n'),
          content: 'live line\n',
        });
      } finally {
        await close(server);
      }
    });

    it('returns pending for an unavailable artifact on a non-terminal job', async () => {
      const job: Job = {
        ...mockCompletedJob(),
        status: 'running',
      };
      mockScheduler.getJob.mockReturnValue(job);
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('artifact pending');
      });

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/metadata.json`);
        const body = await response.json();

        expect(response.status).toBe(202);
        expect(body.detail).toBe('Artifact will be available when job completes');
      } finally {
        await close(server);
      }
    });

    it('rejects unsupported rendered artifact formats', async () => {
      const job = mockCompletedJob();
      const content = '{}';
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        size: Buffer.byteLength(content),
      });
      mockCache.getOrLoad.mockReturnValue(content);

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/run-evaluation.json?format=html`);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.detail).toBe('Unsupported format: html. Supported: rendered');
      } finally {
        await close(server);
      }
    });

    it('rejects rendered format for artifacts other than run-evaluation.json', async () => {
      const job = mockCompletedJob();
      const content = '{}';
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        size: Buffer.byteLength(content),
      });
      mockCache.getOrLoad.mockReturnValue(content);

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/metadata.json?format=rendered`);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.detail).toBe('Rendered format is only supported for run-evaluation.json');
      } finally {
        await close(server);
      }
    });

    it('rejects malformed rendered run-evaluation JSON', async () => {
      const job = mockCompletedJob();
      const content = '{bad json';
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        size: Buffer.byteLength(content),
      });
      mockCache.getOrLoad.mockReturnValue(content);

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/run-evaluation.json?format=rendered`);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.detail).toBe('Invalid JSON in run-evaluation.json artifact');
      } finally {
        await close(server);
      }
    });

    it('rejects rendered run-evaluation JSON when the artifact is not an object', async () => {
      const job = mockCompletedJob();
      const content = '[]';
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        size: Buffer.byteLength(content),
      });
      mockCache.getOrLoad.mockReturnValue(content);

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/run-evaluation.json?format=rendered`);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.detail).toBe('run-evaluation.json must contain a JSON object');
      } finally {
        await close(server);
      }
    });

    it('returns rendered run-evaluation payload as JSON', async () => {
      const job = mockCompletedJob();
      const content = JSON.stringify({
        verdict: 'passed',
        summary: 'Looks good',
        checks: [{ name: 'tests', status: 'passed' }],
      });
      (fs.statSync as jest.Mock).mockReturnValue({
        isFile: () => true,
        size: Buffer.byteLength(content),
      });
      mockCache.getOrLoad.mockReturnValue(content);

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/results/${job.id}/run-evaluation.json?format=rendered&markdown=1`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toEqual(expect.objectContaining({
          raw: expect.objectContaining({
            verdict: 'passed',
            summary: 'Looks good',
          }),
          markdown: expect.stringContaining('Looks good'),
        }));
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

    it('prioritizes provider failure artifacts in the artifact listing', async () => {
      const job = mockCompletedJob();
      job.status = 'failed';
      mockFileStats({
        'metadata.json': { content: JSON.stringify({ provider_error_type: 'gateway_error' }) },
        '.gateway-diagnostics.jsonl': { content: '{}\n' },
        'provider-attempts.jsonl': { content: '{}\n' },
        'gateway-summary.json': { content: '{}' },
        'git.diff': { content: 'diff --git a/file b/file\n' },
        'failure.json': { content: '{}' },
        'result-summary.md': { content: '# Failed\n' },
      });

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/runs/${job.id}/artifacts`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.recommended).toEqual([
          '.gateway-diagnostics.jsonl',
          'provider-attempts.jsonl',
          'gateway-summary.json',
          'git.diff',
          'failure.json',
        ]);
      } finally {
        await close(server);
      }
    });

    it('prioritizes pre-agent validation artifacts in the artifact listing', async () => {
      const job = mockCompletedJob();
      job.status = 'failed';
      mockFileStats({
        'metadata.json': { content: JSON.stringify({ failed_command: 'pre-agent validation' }) },
        'test-baseline-comparison.json': { content: '{}' },
        'pre-validation.log': { content: 'failed\n' },
        'failure.json': { content: '{}' },
        'result-summary.md': { content: '# Failed\n' },
        'pi-events.jsonl': { content: '{}\n' },
      });

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/runs/${job.id}/artifacts`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.recommended.slice(0, 4)).toEqual([
          'test-baseline-comparison.json',
          'pre-validation.log',
          'failure.json',
          'result-summary.md',
        ]);
      } finally {
        await close(server);
      }
    });

    it('keeps artifact listing resilient when metadata is malformed', async () => {
      const job = mockCompletedJob();
      job.status = 'failed';
      mockFileStats({
        'metadata.json': { content: '{bad json' },
        'failure.json': { content: '{}' },
        'result-summary.md': { content: '# Failed\n' },
      });

      const { server, url } = await listen(createMountedArtifactApp());

      try {
        const response = await fetch(`${url}/api/runs/${job.id}/artifacts`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.recommended[0]).toBe('failure.json');
        expect(body.artifactCount).toBe(3);
      } finally {
        await close(server);
      }
    });
  });
});
