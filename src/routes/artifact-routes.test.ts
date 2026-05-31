import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { ResultCache } from '../result-cache';
import { KasekiApiConfig } from '../kaseki-api-config';
import { readArtifactContent, createArtifactRoutes } from './artifact-routes';

// Mock dependencies
jest.mock('fs');
jest.mock('../job-scheduler');
jest.mock('../result-cache');

describe('artifact-routes', () => {
  let mockScheduler: jest.Mocked<JobScheduler>;
  let mockCache: jest.Mocked<ResultCache>;
  let mockConfig: KasekiApiConfig;

  beforeEach(() => {
    mockScheduler = {} as jest.Mocked<JobScheduler>;
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
    it('should return a router', () => {
      const router = createArtifactRoutes(mockScheduler, mockConfig, mockCache);
      expect(router).toBeDefined();
      expect(typeof router.get).toBe('function');
    });
  });
});
