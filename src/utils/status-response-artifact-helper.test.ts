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

    it('should inline valid failure JSON and ignore malformed failure JSON content', () => {
      const runDir = path.join(resultsDir, 'job-failure-json');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(runDir, 'failure.json'), JSON.stringify({ error: 'first failure' }));

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'failure.json': { exists: true, size: 30 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      const validResponse = makeResponse();
      helper.addArtifactInfo(validResponse, makeJob({ id: 'job-failure-json', status: 'failed', resultDir: runDir }));
      expect(validResponse.failureJsonContent).toEqual({ error: 'first failure' });

      fs.writeFileSync(path.join(runDir, 'failure.json'), '{not json');
      const malformedResponse = makeResponse();
      helper.addArtifactInfo(malformedResponse, makeJob({ id: 'job-failure-json', status: 'failed', resultDir: runDir }));

      expect(malformedResponse.failureJsonContent).toBeUndefined();
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

  describe('addDiagnosticSummary', () => {
    it('should extract diagnostic summary for failed jobs', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');

      helper.addDiagnosticSummary(response, job);

      expect(mockDiagnosticExtractor.extractDiagnosticSummary).toHaveBeenCalledWith(
        response,
        runDir,
        expect.any(Function)
      );
    });

    it('should extract diagnostic summary for completed jobs', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-1');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'completed', resultDir: runDir });

      helper.addDiagnosticSummary(response, job);

      expect(mockDiagnosticExtractor.extractDiagnosticSummary).toHaveBeenCalledWith(
        response,
        runDir,
        expect.any(Function)
      );
    });

    it('should handle missing diagnostic files gracefully', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-missing-diag');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      // Don't create any diagnostic files

      expect(() => {
        helper.addDiagnosticSummary(response, job);
      }).not.toThrow();

      expect(mockDiagnosticExtractor.extractDiagnosticSummary).toHaveBeenCalled();
    });
  });

  describe('diagnostic inclusion flag logic', () => {
    it('should include Pi agent diagnostics when pi-events.jsonl exists in failed job', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-pi-diag');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pi coding agent'
      }));
      fs.writeFileSync(path.join(runDir, 'pi-events.jsonl'), '{"event":"test"}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'pi-events.jsonl': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      // Should include pi-events.jsonl in diagnostic files
      expect(response.artifacts?.diagnosticFiles).toContain('pi-events.jsonl');
    });

    it.each([
      ['provider_error'],
      ['model_unavailable'],
      ['provider_empty_assistant_turn'],
    ])('should include Pi agent diagnostics for provider_error_type=%s', (providerErrorType) => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, `job-pi-type-${providerErrorType}`);
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ id: `job-pi-type-${providerErrorType}`, status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        provider_error_type: providerErrorType,
      }));

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'pi-agent-diagnostics.jsonl': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toContain('pi-agent-diagnostics.jsonl');
    });

    it.each([
      ['pi provider empty assistant turn'],
      ['pi provider error'],
    ])('should include Pi agent diagnostics when failed_command contains "%s"', (failedCommand) => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, `job-pi-command-${failedCommand.replaceAll(' ', '-')}`);
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ id: path.basename(runDir), status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: failedCommand,
      }));

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        '.gateway-diagnostics.jsonl': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toContain('.gateway-diagnostics.jsonl');
      expect(response.diagnosticEntryPoint).toBe('.gateway-diagnostics.jsonl');
    });

    it('should include goal-setting diagnostics when goal-setting fails', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-goal-setting-fail');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pi goal-setting agent',
        goal_setting_exit_code: 1
      }));
      fs.writeFileSync(path.join(runDir, 'goal-setting-validation-errors.jsonl'), '{"error":"test"}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'goal-setting-validation-errors.jsonl': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toContain('goal-setting-validation-errors.jsonl');
    });

    it('should include scouting diagnostics when scouting fails', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-scouting-fail');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pi scouting agent'
      }));
      fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), '{"error":"test"}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'scouting-validation-errors.jsonl': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toContain('scouting-validation-errors.jsonl');
    });

    it('should include pre-validation diagnostics when pre-validation fails', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-pre-validation-fail');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pre-agent validation',
        pre_validation_exit_code: 1
      }));
      fs.writeFileSync(path.join(runDir, 'pre-validation.log'), 'validation failed');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'pre-validation.log': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toContain('pre-validation.log');
    });

    it('should include goal-check diagnostics when goal check artifact is invalid', () => {
      const response = makeResponse();
      response.goalCheckFailureReason = 'goal_check_artifact_invalid';
      const runDir = path.join(resultsDir, 'job-goal-check-invalid');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'goal check'
      }));
      fs.writeFileSync(path.join(runDir, 'goal-check-validation-errors.jsonl'), '{"error":"invalid"}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'goal-check-validation-errors.jsonl': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toContain('goal-check-validation-errors.jsonl');
    });

    it.each([
      'goal_check_artifact_missing',
      'goal_check_artifact_malformed',
      'goal_check_turn_budget_exhausted',
    ])('should include goal-check diagnostics for %s', (goalCheckFailureReason) => {
      const response = makeResponse();
      response.goalCheckFailureReason = goalCheckFailureReason;
      const runDir = path.join(resultsDir, `job-${goalCheckFailureReason}`);
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({ failed_command: 'goal check' }));
      fs.writeFileSync(path.join(runDir, 'goal-check-validation-errors.jsonl'), '{"error":"missing"}');
      fs.writeFileSync(path.join(runDir, 'goal-check-contract-diagnostics.json'), '{}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'goal-check-validation-errors.jsonl': { exists: true, size: 50 },
        'goal-check-contract-diagnostics.json': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toEqual(expect.arrayContaining([
        'goal-check-validation-errors.jsonl',
        'goal-check-contract-diagnostics.json',
      ]));
    });

    it('should NOT include diagnostics for successful completed jobs', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-success');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'completed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(runDir, 'result-summary.md'), '# Success');
      // Create diagnostic files that should NOT be included for success
      fs.writeFileSync(path.join(runDir, 'pi-events.jsonl'), '{}');
      fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), '{}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'result-summary.md': { exists: true, size: 50 },
        'pi-events.jsonl': { exists: true, size: 20 },
        'scouting-validation-errors.jsonl': { exists: true, size: 20 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      // Should NOT include diagnostic files for successful jobs
      expect(response.artifacts?.diagnosticFiles).toBeUndefined();
    });

    it('should handle multiple diagnostic file types in a single failed job', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-multi-diag');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pi coding agent',
        goal_setting_exit_code: 0,
        scouting_exit_code: 0
      }));
      fs.writeFileSync(path.join(runDir, 'pi-events.jsonl'), '{}');
      fs.writeFileSync(path.join(runDir, 'goal-setting-validation-errors.jsonl'), '{}');
      fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), '{}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'pi-events.jsonl': { exists: true, size: 50 },
        'goal-setting-validation-errors.jsonl': { exists: true, size: 50 },
        'scouting-validation-errors.jsonl': { exists: true, size: 50 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      // Should include all relevant diagnostic files
      expect(response.artifacts?.diagnosticFiles?.length).toBeGreaterThan(0);
      expect(response.artifacts?.diagnosticFiles).toContain('pi-events.jsonl');
    });

    it('should handle empty metadata gracefully when determining diagnostic inclusion', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-empty-metadata');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      // Create empty metadata
      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 2 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      expect(() => {
        helper.addArtifactInfo(response, job);
      }).not.toThrow();

      expect(response.artifacts).toBeDefined();
    });

    it('should include phase diagnostics when the phase exits with contract validation code 86', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-phase-exit-86');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'goal check',
        goal_setting_exit_code: 86,
        scouting_exit_code: 86,
      }));
      fs.writeFileSync(path.join(runDir, 'goal-setting-validation-errors.jsonl'), '{"error":"goal"}');
      fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), '{"error":"scout"}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'goal-setting-validation-errors.jsonl': { exists: true, size: 20 },
        'scouting-validation-errors.jsonl': { exists: true, size: 20 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toEqual(expect.arrayContaining([
        'goal-setting-validation-errors.jsonl',
        'scouting-validation-errors.jsonl',
      ]));
      expect(mockArtifactContentLoader.addValidationErrorsContent).toHaveBeenCalledWith(
        response,
        runDir,
        'goal-setting-validation-errors.jsonl',
        'goalSetting',
        expect.any(Function),
      );
      expect(mockArtifactContentLoader.addValidationErrorsContent).toHaveBeenCalledWith(
        response,
        runDir,
        'scouting-validation-errors.jsonl',
        'scouting',
        expect.any(Function),
      );
    });

    it('should expose the inline-size predicate to validation error content loading', () => {
      const response = makeResponse();
      response.goalCheckFailureReason = 'goal_check_artifact_invalid';
      const runDir = path.join(resultsDir, 'job-small-predicate');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(runDir, 'goal-check-validation-errors.jsonl'), '{"error":"invalid"}');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'goal-check-validation-errors.jsonl': { exists: true, size: 20 },
        'goal-check-stderr.log': { exists: true, size: 70000 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'failure.json': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      const isSmallAvailable = mockArtifactContentLoader.addValidationErrorsContent.mock.calls.find(
        (call) => call[3] === 'goalCheck',
      )?.[4];
      expect(isSmallAvailable).toEqual(expect.any(Function));
      expect(isSmallAvailable?.('goal-check-validation-errors.jsonl')).toBe(true);
      expect(isSmallAvailable?.('goal-check-stderr.log')).toBe(false);
      expect(isSmallAvailable?.('missing.jsonl')).toBe(false);
    });

    it('should prioritize unresolved critical scouting diagnostics over generic failures', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-unresolved-scouting-critical');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pi coding agent',
      }));
      fs.writeFileSync(path.join(runDir, 'failure.json'), '{"error":"coding failed"}');
      fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), [
        JSON.stringify({ severity: 'critical', field: 'requirements', reason_code: 'schema_mismatch' }),
        JSON.stringify({ recovered: true, field: 'summary', reason_code: 'patch_fallback_recovered' }),
      ].join('\n'));

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'scouting-validation-errors.jsonl': { exists: true, size: 120 },
        'failure.json': { exists: true, size: 30 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toContain('scouting-validation-errors.jsonl');
      expect(response.diagnosticEntryPoint).toBe('scouting-validation-errors.jsonl');
    });

    it('should not prioritize scouting diagnostics when a recovery marker resolves the same field', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-resolved-scouting-critical');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pi coding agent',
      }));
      fs.writeFileSync(path.join(runDir, 'failure.json'), '{"error":"coding failed"}');
      fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), [
        JSON.stringify({ severity: 'critical', field: 'requirements', reason_code: 'schema_mismatch' }),
        JSON.stringify({ recovered: true, field: 'requirements', reason_code: 'patch_fallback_recovered' }),
      ].join('\n'));

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'scouting-validation-errors.jsonl': { exists: true, size: 120 },
        'failure.json': { exists: true, size: 30 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toContain('scouting-validation-errors.jsonl');
      expect(response.diagnosticEntryPoint).toBe('failure.json');
    });

    it('should ignore malformed scouting validation diagnostics discovered outside a scouting failure', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-malformed-scouting-diagnostics');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pi coding agent',
      }));
      fs.writeFileSync(path.join(runDir, 'failure.json'), '{"error":"coding failed"}');
      fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), '{"severity":"critical"\n{not json');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'scouting-validation-errors.jsonl': { exists: true, size: 40 },
        'failure.json': { exists: true, size: 30 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toBeUndefined();
      expect(response.diagnosticEntryPoint).toBe('failure.json');
    });

    it('should prioritize critical scouting diagnostics even when the entry has no reason code', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-scouting-critical-no-reason');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pi coding agent',
      }));
      fs.writeFileSync(path.join(runDir, 'failure.json'), '{"error":"coding failed"}');
      fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), JSON.stringify({
        severity: 'critical',
        field: 'requirements',
      }));

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'scouting-validation-errors.jsonl': { exists: true, size: 60 },
        'failure.json': { exists: true, size: 30 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toContain('scouting-validation-errors.jsonl');
      expect(response.diagnosticEntryPoint).toBe('scouting-validation-errors.jsonl');
    });

    it('should ignore critical scouting entries that are themselves recovery diagnostics', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-scouting-recovery-diagnostic');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        failed_command: 'pi coding agent',
      }));
      fs.writeFileSync(path.join(runDir, 'failure.json'), '{"error":"coding failed"}');
      fs.writeFileSync(path.join(runDir, 'scouting-validation-errors.jsonl'), JSON.stringify({
        severity: 'critical',
        reason_code: 'patch_fallback',
      }));

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 100 },
        'scouting-validation-errors.jsonl': { exists: true, size: 60 },
        'failure.json': { exists: true, size: 30 },
        'result-summary.md': { exists: false, size: 0 },
        'analysis.md': { exists: false, size: 0 },
        'stderr.log': { exists: false, size: 0 },
        'stdout.log': { exists: false, size: 0 },
      });

      helper.addArtifactInfo(response, job);

      expect(response.artifacts?.diagnosticFiles).toBeUndefined();
      expect(response.diagnosticEntryPoint).toBe('failure.json');
    });
  });

  describe('test failure diagnostic summary', () => {
    it('should summarize Jest failure logs and unreliable baseline comparisons', () => {
      const response = makeResponse();
      response.diagnosticSummary = { provider: { errorType: 'provider_error' } } as any;
      const runDir = path.join(resultsDir, 'job-test-failure-summary');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'pre-validation.log'), [
        'setup noise',
        'Summary of all failing tests',
        '  FAIL  src/example.test.ts',
        '  ● example suite › fails clearly',
        '    expect(received).toBe(expected)',
      ].join('\n'));
      fs.writeFileSync(path.join(runDir, 'test-baseline-comparison.json'), JSON.stringify({
        baseline_validation_exit_code: 2,
        summary: {
          total_newly_introduced: 3,
          total_pre_existing: 4,
          total_fixed: 1,
        },
      }));

      helper.addDiagnosticSummary(response, job);

      expect(response.diagnosticSummary?.provider).toEqual({ errorType: 'provider_error' });
      expect(response.diagnosticSummary?.testFailure).toMatchObject({
        failedSuite: 'src/example.test.ts',
        failedTest: 'example suite › fails clearly',
        assertionSummary: 'expect(received).toBe(expected)',
        baselineComparison: {
          totalNewlyIntroduced: 3,
          totalPreExisting: 4,
          totalFixed: 1,
          baselineValidationExitCode: 2,
          baselineComparisonReliable: false,
          baselineComparisonWarning: 'Baseline validation exited 2; failure classification may be incomplete.',
        },
      });
    });

    it('should omit test failure summary for malformed comparison content with no log evidence', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-malformed-comparison');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'test-baseline-comparison.json'), '{not json');

      helper.addDiagnosticSummary(response, job);

      expect(response.diagnosticSummary?.testFailure).toBeUndefined();
    });

    it('should treat missing or passing baseline exit codes as reliable', () => {
      const response = makeResponse();
      const runDir = path.join(resultsDir, 'job-reliable-comparison');
      fs.mkdirSync(runDir, { recursive: true });
      const job = makeJob({ status: 'failed', resultDir: runDir });

      fs.writeFileSync(path.join(runDir, 'test-baseline-comparison.json'), JSON.stringify({
        summary: {
          total_newly_introduced: 0,
          total_pre_existing: 'not-a-number',
          total_fixed: Number.NaN,
        },
      }));

      helper.addDiagnosticSummary(response, job);

      expect(response.diagnosticSummary?.testFailure?.baselineComparison).toEqual({
        totalNewlyIntroduced: 0,
        totalPreExisting: undefined,
        totalFixed: undefined,
        baselineComparisonReliable: true,
      });
    });
  });
});
