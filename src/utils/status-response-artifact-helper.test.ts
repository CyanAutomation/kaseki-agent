import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StatusArtifactHelper } from './status-response-artifact-helper';
import type { Job, StatusResponse } from '../kaseki-api-types';
import type { KasekiApiConfig } from '../kaseki-api-config';
import { TaskProgressCalculator } from './task-progress-calculator';
import { DiagnosticExtractor } from './diagnostic-extractor';
import { ArtifactContentLoader } from './artifact-content-loader';
import * as artifactMetadataCache from '../run-artifact-metadata-cache';

// Mock only specific dependencies, not fs
jest.mock('../run-artifact-metadata-cache');

// Helper functions to create test objects
function makeConfig(resultsDir: string): KasekiApiConfig {
  return { resultsDir } as KasekiApiConfig;
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    status: 'running',
    resultDir: undefined,
    ...overrides,
  } as Job;
}

function makeResponse(): StatusResponse {
  return {
    id: 'job-1',
    status: 'running',
  } as StatusResponse;
}

describe('StatusArtifactHelper', () => {
  let resultsDir: string;
  let helper: StatusArtifactHelper;
  let mockTaskProgressCalculator: jest.Mocked<TaskProgressCalculator>;
  let mockDiagnosticExtractor: jest.Mocked<DiagnosticExtractor>;
  let mockArtifactContentLoader: jest.Mocked<ArtifactContentLoader>;
  let progressHighWater: Map<string, number>;

  beforeEach(() => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-helper-'));

    mockTaskProgressCalculator = {
      calculateProgressPercent: jest.fn(),
    } as unknown as jest.Mocked<TaskProgressCalculator>;

    mockDiagnosticExtractor = {
      extractDiagnosticSummary: jest.fn(),
    } as unknown as jest.Mocked<DiagnosticExtractor>;

    mockArtifactContentLoader = {
      addValidationErrorsContent: jest.fn(),
    } as unknown as jest.Mocked<ArtifactContentLoader>;

    progressHighWater = new Map<string, number>();

    const readSmallTerminalArtifact = (filePath: string): string | null => {
      try {
        if (fs.existsSync(filePath)) {
          return fs.readFileSync(filePath, 'utf-8');
        }
      } catch {
        // Return null on any read error
      }
      return null;
    };

    const readMetadata = (runDir: string): any => {
      const metadataPath = path.join(runDir, 'metadata.json');
      try {
        if (fs.existsSync(metadataPath)) {
          return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        }
      } catch {
        // Return empty object if metadata can't be read
      }
      return {};
    };

    const stringField = (record: Record<string, unknown>, key: string): string | undefined => {
      const value = record[key];
      return typeof value === 'string' ? value : undefined;
    };

    const isRecord = (value: unknown): value is Record<string, unknown> => {
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    };

    helper = new StatusArtifactHelper(
      makeConfig(resultsDir),
      mockTaskProgressCalculator,
      mockDiagnosticExtractor,
      mockArtifactContentLoader,
      readSmallTerminalArtifact,
      readMetadata,
      progressHighWater,
      stringField,
      isRecord
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (fs.existsSync(resultsDir)) {
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });

  describe('addTaskProgressInfo', () => {
    it('should set progress to 100% when job is completed', () => {
      const response = makeResponse();
      const job = makeJob({ status: 'completed' });

      helper.addTaskProgressInfo(response, job);

      expect(response.taskProgressPercent).toBe(100);
      expect(progressHighWater.has('job-1')).toBe(false); // Should delete from high water map
    });

    it('should not set progress when job is queued', () => {
      const response = makeResponse();
      const job = makeJob({ status: 'queued' });
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');

      // Mock calculateProgressPercent to return undefined
      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(undefined);

      helper.addTaskProgressInfo(response, job);

      expect(response.taskProgressPercent).toBeUndefined();
    });

    it('should maintain monotonically increasing progress for running jobs', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'running', resultDir: runDir });

      // Create metadata file
      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({}));

      // First call: 25%
      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(25);
      helper.addTaskProgressInfo(response, job);
      expect(response.taskProgressPercent).toBe(25);
      expect(progressHighWater.get('job-1')).toBe(25);

      // Second call: 30%
      const response2 = makeResponse();
      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(30);
      helper.addTaskProgressInfo(response2, job);
      expect(response2.taskProgressPercent).toBe(30);
      expect(progressHighWater.get('job-1')).toBe(30);

      // Third call: 20% (should NOT go backward, should stay at 30%)
      const response3 = makeResponse();
      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(20);
      helper.addTaskProgressInfo(response3, job);
      expect(response3.taskProgressPercent).toBe(30); // Maintains high water mark
      expect(progressHighWater.get('job-1')).toBe(30);
    });

    it('should respect progress from calculation', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'running', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({}));

      // Test with a large value - should be passed through unchanged
      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(150);
      helper.addTaskProgressInfo(response, job);
      expect(response.taskProgressPercent).toBe(150); // No upper bound enforcement
    });

    it('should clear high water mark when job transitions from running to completed', () => {
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'running', resultDir: runDir });

      fs.writeFileSync(path.join(resultsDir, 'job-1', 'metadata.json'), JSON.stringify({}));

      // Set running progress
      const response = makeResponse();
      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(75);
      helper.addTaskProgressInfo(response, job);
      expect(progressHighWater.has('job-1')).toBe(true);

      // Transition to completed
      const completedJob = makeJob({ status: 'completed' });
      const completedResponse = makeResponse();
      helper.addTaskProgressInfo(completedResponse, completedJob);
      expect(progressHighWater.has('job-1')).toBe(false);
    });

    it('should handle missing progress calculation gracefully', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'running', resultDir: runDir });

      fs.writeFileSync(path.join(resultsDir, 'job-1', 'metadata.json'), JSON.stringify({}));

      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(undefined);

      helper.addTaskProgressInfo(response, job);

      expect(response.taskProgressPercent).toBeUndefined();
    });
  });

  describe('addArtifactInfo', () => {
    it('should skip processing for running jobs', () => {
      const response = makeResponse();
      const job = makeJob({ status: 'running' });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts).toBeUndefined();
    });

    it('should populate artifact availability for completed job', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'completed', resultDir: runDir });

      // Create key files
      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(runDir, 'result-summary.md'), '# Summary');
      fs.writeFileSync(path.join(runDir, 'failure.json'), '{}');

      // Mock artifact metadata to indicate files exist
      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'result-summary.md': { exists: true, size: 200 },
        'failure.json': { exists: true, size: 50 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts).toBeDefined();
      expect(response.artifacts?.metadataJson).toBe(true);
      expect(response.artifacts?.resultSummaryMd).toBe(true);
      expect(response.artifacts?.failureJson).toBe(true);
      expect(response.artifacts?.analysisMd).toBe(false);
    });

    it('should inline small artifacts when available', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'completed', resultDir: runDir });

      const smallContent = '# Small Summary';
      fs.writeFileSync(path.join(runDir, 'result-summary.md'), smallContent);
      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');

      // Mock metadata - only result-summary.md is available and small
      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'result-summary.md': { exists: true, size: smallContent.length },
        'failure.json': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.resultSummaryContent).toBe(smallContent);
    });

    it('should NOT inline artifacts larger than INLINE_ARTIFACT_LIMIT_BYTES', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'completed', resultDir: runDir });

      const largeContent = 'x'.repeat(100000); // Larger than 65536 limit
      fs.writeFileSync(path.join(runDir, 'result-summary.md'), largeContent);
      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'result-summary.md': { exists: true, size: largeContent.length },
        'failure.json': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.resultSummaryContent).toBeUndefined();
    });

    it('should handle failed jobs with appropriate diagnostics', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({ failed_command: 'test' }));
      fs.writeFileSync(path.join(runDir, 'failure.json'), '{"reason": "test failure"}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'failure.json': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      // Should try to set diagnostic entry point for failed jobs
      expect(response.artifacts).toBeDefined();
    });

    it('should use custom resultDir when provided by job', () => {
      const customDir = path.join(resultsDir, 'custom-results');
      fs.mkdirSync(customDir, { recursive: true });

      const response = makeResponse();
      const job = makeJob({ status: 'completed', resultDir: customDir });

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'result-summary.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts).toBeDefined();
    });

    it('should handle missing metadata gracefully', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'completed', resultDir: runDir });

      // Don't create metadata file - should handle gracefully

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: false, size: 0 },
        'result-summary.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts).toBeDefined();
      expect(response.artifacts?.metadataJson).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete workflow: progress update followed by artifact processing', () => {
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'running', resultDir: runDir });
      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');

      // Phase 1: Job running, update progress
      const response1 = makeResponse();
      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(50);
      helper.addTaskProgressInfo(response1, job);
      expect(response1.taskProgressPercent).toBe(50);

      // Phase 2: Job completes, add artifacts
      const completedJob = makeJob({ status: 'completed', resultDir: runDir });
      fs.writeFileSync(path.join(runDir, 'result-summary.md'), '# Complete');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'result-summary.md': { exists: true, size: 20 },
        'failure.json': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      const response2 = makeResponse();
      helper.addArtifactInfo(response2, completedJob);
      expect(response2.artifacts).toBeDefined();

      // Phase 3: Progress should reflect completion
      const response3 = makeResponse();
      helper.addTaskProgressInfo(response3, completedJob);
      expect(response3.taskProgressPercent).toBe(100);
    });

    it('should transition correctly from running to failed state with diagnostics', () => {
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'running', resultDir: runDir });
      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({ failed_command: 'test' }));

      // Simulate running state
      const response1 = makeResponse();
      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(75);
      helper.addTaskProgressInfo(response1, job);

      // Transition to failed
      const failedJob = makeJob({ status: 'failed', resultDir: runDir });
      fs.writeFileSync(path.join(runDir, 'failure.json'), '{"error": "failed"}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'failure.json': { exists: true, size: 30 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      const response2 = makeResponse();
      // Mock should still return a value for the failed job calculation
      (mockTaskProgressCalculator.calculateProgressPercent as jest.Mock).mockReturnValue(75);
      helper.addTaskProgressInfo(response2, failedJob);

      // High water mark should be cleared
      expect(progressHighWater.has('job-1')).toBe(false);
    });
  });
});
