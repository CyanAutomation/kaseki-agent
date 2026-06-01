import * as fs from 'fs';
import { StatusResponseBuilder } from './status-response-builder';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import { ResultCache } from '../result-cache';
import { Job, StatusResponse } from '../kaseki-api-types';
import * as artifactMetadataCache from '../run-artifact-metadata-cache';
import * as fileHelpers from './file-helpers';

jest.mock('fs');
jest.mock('../job-scheduler');
jest.mock('../result-cache');
jest.mock('../run-artifact-metadata-cache');
jest.mock('./file-helpers');

describe('StatusResponseBuilder', () => {
  let builder: StatusResponseBuilder;
  let mockScheduler: jest.Mocked<JobScheduler>;
  let mockConfig: KasekiApiConfig;
  let mockCache: jest.Mocked<ResultCache>;

  beforeEach(() => {
    mockScheduler = {
      getLiveProgressEvents: jest.fn(),
    } as unknown as jest.Mocked<JobScheduler>;
    mockConfig = {
      resultsDir: '/results',
      agentTimeoutSeconds: 10800,
      defaultTaskMode: 'patch',
      port: 3000,
      apiKeys: [],
      maxConcurrentRuns: 5,
      maxDiffBytes: 400000,
      logLevel: 'info',
    } as unknown as KasekiApiConfig;
    mockCache = {
      getOrLoad: jest.fn(),
    } as unknown as jest.Mocked<ResultCache>;

    // Mock getRunArtifactMetadata to return default empty object
    (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({});
    (fileHelpers.readLastJsonlEvent as jest.Mock).mockReturnValue(undefined);

    builder = new StatusResponseBuilder(mockScheduler, mockConfig, mockCache);

    jest.clearAllMocks();
  });

  describe('buildStatus', () => {
    it('should build status response for queued job', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'queued',
        failureClass: undefined,
        error: undefined,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response = builder.buildStatus(job as Job);

      expect(response.id).toBe('job-1');
      expect(response.status).toBe('queued');
      expect(response.taskProgressPercent).toBeUndefined();
      expect(response.artifacts).toBeUndefined();
    });

    it('should build status response for running job', () => {
      const startTime = new Date('2026-01-01T00:00:00Z');
      const now = new Date('2026-01-01T00:05:00Z');
      jest.useFakeTimers();
      jest.setSystemTime(now);

      const job: Partial<Job> = {
        id: 'job-2',
        status: 'running',
        startedAt: startTime,
        effectiveTimeoutSeconds: 10800,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response = builder.buildStatus(job as Job);

      expect(response.id).toBe('job-2');
      expect(response.status).toBe('running');
      expect(response.elapsedSeconds).toBe(300); // 5 minutes
      expect(response.timeoutRiskPercent).toBeLessThanOrEqual(3); // 5 min / 3 hours

      jest.useRealTimers();
    });

    it('should build status response for completed job', () => {
      const startTime = new Date('2026-01-01T00:00:00Z');
      const completedTime = new Date('2026-01-01T01:00:00Z');

      const job: Partial<Job> = {
        id: 'job-3',
        status: 'completed',
        startedAt: startTime,
        completedAt: completedTime,
        exitCode: 0,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('{}');

      const response = builder.buildStatus(job as Job);

      expect(response.id).toBe('job-3');
      expect(response.status).toBe('completed');
      expect(response.elapsedSeconds).toBe(3600); // 1 hour
      expect(response.artifacts).toBeDefined();
    });

    it('should build status response for failed job', () => {
      const job: Partial<Job> = {
        id: 'job-4',
        status: 'failed',
        failureClass: 'validation-failure',
        error: 'Validation failed',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('{}');

      const response = builder.buildStatus(job as Job);

      expect(response.id).toBe('job-4');
      expect(response.status).toBe('failed');
      expect(response.failureClass).toBe('validation-failure');
      expect(response.error).toBe('Validation failed');
    });

    it('should expose validation allowlist failures as validation-related status reasons', () => {
      const job: Partial<Job> = {
        id: 'job-validation-allowlist',
        status: 'failed',
        resultDir: '/results/job-validation-allowlist',
      };
      const allowlistReason = 'validation_allowlist_check: 1 file(s) changed during validation outside KASEKI_VALIDATION_ALLOWLIST';

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('metadata.json')) {
          return JSON.stringify({
            validation_allowlist_failure_reason: allowlistReason,
            quality_failure_reason: allowlistReason,
          });
        }
        return '';
      });

      const response = builder.buildStatus(job as Job);

      expect(response.validationFailureReason).toBe(allowlistReason);
      expect(response.validationAllowlistFailureReason).toBe(allowlistReason);
      expect(response.qualityFailureReason).toBe(allowlistReason);
    });

    it('should include timing info when startedAt is set', () => {
      const startTime = new Date('2026-01-01T00:00:00Z');
      const completedTime = new Date('2026-01-01T00:30:00Z');

      const job: Partial<Job> = {
        id: 'job-5',
        status: 'completed',
        startedAt: startTime,
        completedAt: completedTime,
        effectiveTimeoutSeconds: 3600,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response = builder.buildStatus(job as Job);

      expect(response.elapsedSeconds).toBe(1800); // 30 minutes
      expect(response.timeoutRiskPercent).toBe(50); // 30 min / 60 min
    });

    it('should calculate timeoutRiskPercent based on config timeout when effectiveTimeoutSeconds not set', () => {
      const startTime = new Date('2026-01-01T00:00:00Z');
      const now = new Date('2026-01-01T03:00:00Z');
      jest.useFakeTimers();
      jest.setSystemTime(now);

      const job: Partial<Job> = {
        id: 'job-6',
        status: 'running',
        startedAt: startTime,
        effectiveTimeoutSeconds: undefined,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response = builder.buildStatus(job as Job);

      // 3 hours / 3 hours = 100%
      expect(response.timeoutRiskPercent).toBe(100);

      jest.useRealTimers();
    });

    it('should not include timing info for queued job', () => {
      const job: Partial<Job> = {
        id: 'job-7',
        status: 'queued',
        startedAt: undefined,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response = builder.buildStatus(job as Job);

      expect(response.elapsedSeconds).toBeUndefined();
      expect(response.timeoutRiskPercent).toBeUndefined();
    });
  });

  describe('addTaskProgressInfo', () => {
    // This method has 24 cognitive complexity and needs extensive branch coverage

    it('should derive stages from orchestrator config by default', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
          taskMode: 'patch',
          publishMode: 'pr',
        } as any,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Should calculate taskProgressPercent based on orchestrator stages
      expect(response.taskProgressPercent).toBeDefined();
    });

    it('should use metadata stages when available', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
      };

      const metadataContent = JSON.stringify({
        stages: ['stage1', 'stage2', 'stage3', 'stage4'],
      });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('metadata.json') || filePath.includes('progress.jsonl');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('metadata.json')) {
          return metadataContent;
        }
        return '';
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Should use metadata stages as denominator
      expect(response.taskProgressPercent).toBeDefined();
      expect(response.taskProgressPercent).toBeGreaterThanOrEqual(0);
      expect(response.taskProgressPercent).toBeLessThanOrEqual(100);
    });

    it('should read progress from progress.jsonl file', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
      };

      const progressContent = [
        JSON.stringify({ stage: 'stage1', status: 'started' }),
        JSON.stringify({ stage: 'stage1', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'stage2', status: 'started' }),
      ].join('\n');

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return JSON.stringify({ stages: ['stage1', 'stage2', 'stage3'] });
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Should calculate progress based on finished stages
      expect(response.taskProgressPercent).toBe(33); // 1 of 3 finished
    });

    it('should map generic pi agent progress to pi coding agent for task progress', () => {
      const job: Partial<Job> = {
        id: 'job-pi-agent',
        status: 'running',
        resultDir: '/results/job-pi-agent',
      };

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return JSON.stringify({ stage: 'pi agent', status: 'running' });
        }
        return JSON.stringify({
          stages: ['clone repository', 'agent setup', 'pi coding agent', 'collect agent diff'],
        });
      });

      const response: StatusResponse = {
        id: 'job-pi-agent',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      expect(response.taskProgressPercent).toBeGreaterThanOrEqual(50);
    });

    it('should handle malformed JSON in progress.jsonl gracefully', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
      };

      const progressContent = [
        JSON.stringify({ stage: 'stage1', status: 'finished', detail: 'finished' }),
        'not valid json',
        JSON.stringify({ stage: 'stage2', status: 'finished', detail: 'finished' }),
      ].join('\n');

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return JSON.stringify({ stages: ['stage1', 'stage2', 'stage3'] });
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      // Should not throw on malformed JSON
      expect(() => builder['addTaskProgressInfo'](response, job as Job)).not.toThrow();
      expect(response.taskProgressPercent).toBeDefined();
    });

    it('should handle missing progress.jsonl file', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      // Should not throw
      expect(() => builder['addTaskProgressInfo'](response, job as Job)).not.toThrow();
      expect(response.taskProgressPercent).toBeDefined();
    });

    it('should use live progress events if progress.jsonl not available', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
      };

      mockScheduler.getLiveProgressEvents = jest.fn().mockReturnValue([
        { stage: 'stage1', status: 'finished', detail: 'finished' },
        { stage: 'stage2', status: 'started' },
      ]);

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      expect(mockScheduler.getLiveProgressEvents).toHaveBeenCalledWith('job-1', 1);
      expect(response.taskProgressPercent).toBeDefined();
    });

    it('should clamp completedStages to not exceed totalStages', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
      };

      const progressContent = [
        JSON.stringify({ stage: 'stage1', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'stage2', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'stage3', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'stage4', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'stage5', status: 'finished', detail: 'finished' }),
      ].join('\n');

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return JSON.stringify({ stages: ['stage1', 'stage2', 'stage3'] });
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Should be clamped to 100% even if more stages finished than expected
      expect(response.taskProgressPercent).toBeLessThanOrEqual(100);
    });

    it('should normalize stage names (trim whitespace)', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
        currentStage: '  stage with spaces  ',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Should normalize and calculate progress
      expect(response.taskProgressPercent).toBeDefined();
    });

    it('should handle zero totalStages gracefully', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
          taskMode: 'inspect',
          publishMode: 'none',
          goalCheck: { enabled: false },
          runEvaluation: { enabled: false },
          autoLintCleanup: { enabled: false },
        } as any,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Should set taskProgressPercent to undefined or 0, not crash
      expect(response.taskProgressPercent === undefined || response.taskProgressPercent === 0).toBe(true);
    });

    it('should round taskProgressPercent to nearest integer', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
      };

      const progressContent = JSON.stringify({ stage: 'stage1', status: 'finished', detail: 'finished' });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return JSON.stringify({ stages: ['stage1', 'stage2', 'stage3'] });
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // 1/3 = 33.333... → 33
      expect(response.taskProgressPercent).toBe(33);
      expect(typeof response.taskProgressPercent).toBe('number');
    });

    it('should handle currentStageIndex detection', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
        currentStage: 'stage2',
      };

      const metadataContent = JSON.stringify({
        stages: ['stage1', 'stage2', 'stage3', 'stage4'],
      });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockReturnValue(metadataContent);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Should recognize currentStage position
      expect(response.taskProgressPercent).toBeDefined();
      expect(response.taskProgressPercent).toBeGreaterThanOrEqual(25); // At least stage 2
    });

    it('should treat finished current stage as +1 in completedStages', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
        currentStage: 'stage2',
      };

      const progressContent = JSON.stringify({ stage: 'stage2', status: 'finished', detail: 'finished' });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return JSON.stringify({ stages: ['stage1', 'stage2', 'stage3', 'stage4'] });
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // stage2 finished (index 1) should count as 2 completed stages
      expect(response.taskProgressPercent).toBe(50); // 2/4
    });

    it('should set taskProgressPercent to undefined on exception', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
      };

      (fs.existsSync as jest.Mock).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Should handle error and skip progress calculation
      expect(response.taskProgressPercent).toBeUndefined();
    });
  });

  describe('addArtifactInfo', () => {
    it('should not add artifacts for non-terminal job', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
      };

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.artifacts).toBeUndefined();
    });

    it('should add artifacts for completed job', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'completed',
        resultDir: '/results/job-1',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'completed',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.artifacts).toBeDefined();
      expect(response.artifacts?.metadataJson).toBeDefined();
    });

    it('should add artifacts for failed job', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'failed',
        resultDir: '/results/job-1',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'failed',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.artifacts).toBeDefined();
    });

    it('should set diagnosticEntryPoint for failed job with failure.json', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'failed',
        resultDir: '/results/job-1',
      };

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'failure.json': { exists: true, size: 100 }
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'failed',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.diagnosticEntryPoint).toBe('failure.json');
    });

    it('should set diagnosticEntryPoint to analysis.md if failure.json not available', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'failed',
        resultDir: '/results/job-1',
      };

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'analysis.md': { exists: true, size: 100 }
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'failed',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.diagnosticEntryPoint).toBe('analysis.md');
    });

    it('should prefer goal-check validation errors over failure.json for invalid goal-check artifacts', () => {
      const job: Partial<Job> = {
        id: 'job-goal-check-invalid-entry',
        status: 'failed',
        resultDir: '/results/job-goal-check-invalid-entry',
      };

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'failure.json': { exists: true, size: 100 },
        'goal-check-validation-errors.jsonl': { exists: true, size: 200 },
        'goal-check-stderr.log': { exists: true, size: 300 },
      });

      const response: StatusResponse = {
        id: 'job-goal-check-invalid-entry',
        status: 'failed',
        goalCheckFailureReason: 'goal_check_artifact_invalid',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.diagnosticEntryPoint).toBe('goal-check-validation-errors.jsonl');
    });

    it('should prefer goal-check stderr when invalid goal-check artifacts have no validation errors file', () => {
      const job: Partial<Job> = {
        id: 'job-goal-check-invalid-stderr-entry',
        status: 'failed',
        resultDir: '/results/job-goal-check-invalid-stderr-entry',
      };

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'failure.json': { exists: true, size: 100 },
        'goal-check-validation-errors.jsonl': { exists: false, size: 0 },
        'goal-check-stderr.log': { exists: true, size: 300 },
      });

      const response: StatusResponse = {
        id: 'job-goal-check-invalid-stderr-entry',
        status: 'failed',
        goalCheckFailureReason: 'goal_check_artifact_invalid',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.diagnosticEntryPoint).toBe('goal-check-stderr.log');
    });

    it('should inline valid small goal-check validation errors JSONL content', () => {
      const job: Partial<Job> = {
        id: 'job-goal-check-invalid-inline',
        status: 'failed',
        resultDir: '/results/job-goal-check-invalid-inline',
      };
      const validationErrorsContent = [
        JSON.stringify({ path: 'goal-check.json', message: 'missing field' }),
        JSON.stringify({ path: 'goal-check.json', message: 'invalid verdict', code: 'invalid_enum' }),
      ].join('\n');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'goal-check-validation-errors.jsonl': { exists: true, size: validationErrorsContent.length },
      });
      mockCache.getOrLoad.mockImplementation((filePath: string) => {
        if (filePath.includes('goal-check-validation-errors.jsonl')) {
          return validationErrorsContent;
        }
        return null;
      });

      const response: StatusResponse = {
        id: 'job-goal-check-invalid-inline',
        status: 'failed',
        goalCheckFailureReason: 'goal_check_artifact_invalid',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.goalCheckValidationErrorsContent).toEqual([
        { path: 'goal-check.json', message: 'missing field' },
        { path: 'goal-check.json', message: 'invalid verdict', code: 'invalid_enum' },
      ]);
      expect(response.goalCheckValidationErrorsRawContent).toBeUndefined();
    });

    it('should not inline oversized goal-check validation errors content', () => {
      const job: Partial<Job> = {
        id: 'job-goal-check-invalid-oversized',
        status: 'failed',
        resultDir: '/results/job-goal-check-invalid-oversized',
      };
      const largeValidationErrorsContent = 'x'.repeat(70000);

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'goal-check-validation-errors.jsonl': { exists: true, size: largeValidationErrorsContent.length },
      });
      mockCache.getOrLoad.mockImplementation((filePath: string) => {
        if (filePath.includes('goal-check-validation-errors.jsonl')) {
          return largeValidationErrorsContent;
        }
        return null;
      });

      const response: StatusResponse = {
        id: 'job-goal-check-invalid-oversized',
        status: 'failed',
        goalCheckFailureReason: 'goal_check_artifact_invalid',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.goalCheckValidationErrorsContent).toBeUndefined();
      expect(response.goalCheckValidationErrorsRawContent).toBeUndefined();
    });

    it('should not break status response construction for malformed goal-check validation errors JSONL', () => {
      const job: Partial<Job> = {
        id: 'job-goal-check-invalid-malformed',
        status: 'failed',
        resultDir: '/results/job-goal-check-invalid-malformed',
      };
      const malformedValidationErrorsContent = [
        JSON.stringify({ path: 'goal-check.json', message: 'missing field' }),
        'not valid json',
      ].join('\n');

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'goal-check-validation-errors.jsonl': { exists: true, size: malformedValidationErrorsContent.length },
      });
      mockCache.getOrLoad.mockImplementation((filePath: string) => {
        if (filePath.includes('goal-check-validation-errors.jsonl')) {
          return malformedValidationErrorsContent;
        }
        return null;
      });

      const response: StatusResponse = {
        id: 'job-goal-check-invalid-malformed',
        status: 'failed',
        goalCheckFailureReason: 'goal_check_artifact_invalid',
      };

      expect(() => builder['addArtifactInfo'](response, job as Job)).not.toThrow();
      expect(response.artifacts).toBeDefined();
      expect(response.goalCheckValidationErrorsContent).toBeUndefined();
      expect(response.goalCheckValidationErrorsRawContent).toBe(malformedValidationErrorsContent);
    });

    it('should inline result-summary.md content if available', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'completed',
        resultDir: '/results/job-1',
      };

      const summaryContent = '# Summary\nTest content';

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'result-summary.md': { exists: true, size: summaryContent.length }
      });
      mockCache.getOrLoad.mockImplementation((filePath: string) => {
        if (filePath.includes('result-summary.md')) {
          return summaryContent;
        }
        return null;
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'completed',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.resultSummaryContent).toBe(summaryContent);
    });

    it('should not inline result-summary.md if too large (> 64 KB)', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'completed',
        resultDir: '/results/job-1',
      };

      const largeSummary = 'x'.repeat(100000); // > 64 KB

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'result-summary.md': { exists: true, size: largeSummary.length }
      });
      mockCache.getOrLoad.mockReturnValue(largeSummary);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'completed',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.resultSummaryContent).toBeUndefined();
    });

    it('should inline failure.json content for failed jobs', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'failed',
        resultDir: '/results/job-1',
      };

      const failureJson = { error: 'Test error', code: 'TEST_ERROR' };

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'failure.json': { exists: true, size: JSON.stringify(failureJson).length }
      });
      mockCache.getOrLoad.mockImplementation((filePath: string) => {
        if (filePath.includes('failure.json')) {
          return JSON.stringify(failureJson);
        }
        return null;
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'failed',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(response.failureJsonContent).toEqual(failureJson);
    });

    it('should handle invalid JSON in failure.json gracefully', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'failed',
        resultDir: '/results/job-1',
      };

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'failure.json': { exists: true, size: 10 }
      });
      mockCache.getOrLoad.mockImplementation((filePath: string) => {
        if (filePath.includes('failure.json')) {
          return 'not valid json';
        }
        return null;
      });

      const response: StatusResponse = {
        id: 'job-1',
        status: 'failed',
      };

      builder['addArtifactInfo'](response, job as Job);

      // Should skip inlining on parse error
      expect(response.failureJsonContent).toBeUndefined();
    });

    it('should set availableFiles list', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'completed',
        resultDir: '/results/job-1',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'completed',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(Array.isArray(response.artifacts?.availableFiles)).toBe(true);
    });

    it('should include goal-check diagnostic artifacts when goal-check artifact validation failed', () => {
      const job: Partial<Job> = {
        id: 'job-goal-check-invalid',
        status: 'failed',
        resultDir: '/results/job-goal-check-invalid',
      };

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'metadata.json': { exists: true, size: 20 },
        'failure.json': { exists: true, size: 100 },
        'stderr.log': { exists: true, size: 50 },
        'goal-check-validation-errors.jsonl': { exists: true, size: 200 },
        'goal-check-stderr.log': { exists: true, size: 300 },
        'goal-check.json': { exists: false, size: 0 },
        'goal-check-attempts.jsonl': { exists: true, size: 80 },
      });

      const response: StatusResponse = {
        id: 'job-goal-check-invalid',
        status: 'failed',
        goalCheckFailureReason: 'goal_check_artifact_invalid',
      };

      builder['addArtifactInfo'](response, job as Job);

      expect(artifactMetadataCache.getRunArtifactMetadata).toHaveBeenCalledWith(
        'job-goal-check-invalid',
        '/results/job-goal-check-invalid',
        expect.arrayContaining([
          'metadata.json',
          'failure.json',
          'stderr.log',
          'goal-check-validation-errors.jsonl',
          'goal-check-stderr.log',
          'goal-check.json',
          'goal-check-attempts.jsonl',
        ]),
        true
      );
      expect(response.artifacts?.availableFiles).toEqual([
        'metadata.json',
        'failure.json',
        'stderr.log',
        'goal-check-validation-errors.jsonl',
        'goal-check-stderr.log',
        'goal-check-attempts.jsonl',
      ]);
      expect(response.artifacts?.diagnosticFiles).toEqual([
        'goal-check-validation-errors.jsonl',
        'goal-check-stderr.log',
        'goal-check-attempts.jsonl',
      ]);
    });
  });

  describe('addProgressInfo', () => {
    it('should not add progress for non-running job', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'completed',
      };

      const response: StatusResponse = {
        id: 'job-1',
        status: 'completed',
      };

      builder['addProgressInfo'](response, job as Job);

      expect(response.progress).toBeUndefined();
    });

    it('should add progress for running job from file', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
      };

      const progressEvent = { stage: 'stage1', status: 'running' };

      (fileHelpers.readLastJsonlEvent as jest.Mock).mockReturnValue(progressEvent);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addProgressInfo'](response, job as Job);

      // Should attempt to load progress
      expect(response.progress).toBeDefined();
    });
  });

  describe('resilience', () => {
    it('should not crash when result directory does not exist', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'completed',
        resultDir: '/nonexistent/path',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      expect(() => {
        builder.buildStatus(job as Job);
      }).not.toThrow();
    });

    it('should handle missing metadata.json gracefully', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'completed',
        resultDir: '/results/job-1',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const response = builder.buildStatus(job as Job);

      expect(response).toBeDefined();
      expect(response.id).toBe('job-1');
    });

    it('should handle corrupted metadata.json', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'completed',
        resultDir: '/results/job-1',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Read failed');
      });

      expect(() => {
        builder.buildStatus(job as Job);
      }).not.toThrow();
    });
  });
});
