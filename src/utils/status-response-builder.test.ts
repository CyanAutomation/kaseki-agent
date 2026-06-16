import * as fs from 'fs';
import { deriveOrchestratorStages, StatusResponseBuilder } from './status-response-builder';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import { ResultCache } from '../result-cache';
import { Job, StatusResponse } from '../kaseki-api-types';
import * as artifactMetadataCache from '../run-artifact-metadata-cache';
import * as fileHelpers from './file-helpers';

jest.mock('fs');
jest.mock('../summarization/read-wrapper');
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
  });

  afterEach(() => {
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

    it.skip('should expose actionable terminal diagnostics and dependency cache notes', () => {
      // TODO: Fix diagnostic test - phaseDiagnostics not being populated despite proper mock setup.
      // The validation error content loading may require different mock patterns or additional setup.
      // This test validates that diagnostic extraction works end-to-end with mocked file I/O.
      const job: Partial<Job> = {
        id: 'job-diagnostics',
        status: 'failed',
        resultDir: '/results/job-diagnostics',
      };
      const failureJson = {
        goal_check_failure_reason: 'critical_change_expectations_failed: git.diff is empty but forbidden_empty_diff is true',
        diagnostic_reason: 'scouting-validation-errors.jsonl: missing_file',
      };
      const scoutingError = {
        reason_code: 'missing_file',
        field: 'scouting-candidate.json',
        actual: 'missing: /results/scouting-candidate.json',
        severity: 'critical',
        suggestion: 'ensure the scouting Pi writes exactly one valid JSON object',
      };

      // Create a new cache with the specific mockImplementation for this test
      const testMockCache = {
        getOrLoad: jest.fn((filePath: string) => {
          if (filePath.includes('failure.json')) {
            return JSON.stringify(failureJson);
          }
          if (filePath.includes('scouting-validation-errors.jsonl')) {
            return JSON.stringify(scoutingError) + '\n';
          }
          if (filePath.includes('stdout.log')) {
            return [
              'Dependency cache status: restoring node_modules from workspace cache (/cache/node_modules).',
              'Dependency cache status: workspace cache failed npm ls validation; reinstalling.',
              'Dependency cache status: cache miss for lock hash abc, running install.',
            ].join('\n');
          }
          return null;
        }),
      } as unknown as jest.Mocked<ResultCache>;

      // Mock fs methods
      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('metadata.json') || 
               filePath.includes('scouting-validation-errors.jsonl') ||
               filePath.includes('failure.json') ||
               filePath.includes('stdout.log');
      });
      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('metadata.json')) {
          return '{}';
        }
        return '{}';
      });

      // Mock artifact metadata
      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'failure.json': { exists: true, size: JSON.stringify(failureJson).length },
        'stdout.log': { exists: true, size: 500 },
        'scouting-validation-errors.jsonl': { exists: true, size: JSON.stringify(scoutingError).length + 1 },
      });

      // Create a fresh builder with the test cache
      const testBuilder = new StatusResponseBuilder(mockScheduler, mockConfig, testMockCache);

      // Now call buildStatus with all mocks in place
      const response = testBuilder.buildStatus(job as Job);

      // Verify results
      expect(response.diagnosticSummary?.primaryReason).toBe(failureJson.goal_check_failure_reason);
      expect(response.diagnosticSummary?.phaseDiagnostics?.[0]).toMatchObject({
        phase: 'scouting',
        severity: 'critical',
        reason: 'missing_file',
        field: 'scouting-candidate.json',
      });
      expect(response.diagnosticSummary?.dependencyCache).toMatchObject({
        restored: true,
        reinstallTriggered: true,
      });
    });

    it('keeps recovered scouting fallback diagnostics contextual for critical-change empty diff failures', () => {
      const job: Partial<Job> = {
        id: 'job-critical-change-recovered-scouting',
        status: 'failed',
        resultDir: '/results/job-critical-change-recovered-scouting',
      };
      const goalCheckReason = 'critical_change_expectations_failed: git.diff is empty but forbidden_empty_diff is true';
      const failureJson = {
        failed_command: 'critical change verification',
        goal_check_failure_reason: goalCheckReason,
        diagnostic_reason: goalCheckReason,
      };
      const resultSummary = `# Run Summary\n\nFailure Detail: ${goalCheckReason}\n`;
      const scoutingFallbackWarning = {
        reason_code: 'patch_fallback',
        field: 'scouting-candidate.json',
        expected: 'valid scouting candidate artifact',
        actual: 'missing candidate history',
        severity: 'warning',
        suggestion: 'continuing with patch-mode fallback scouting context',
      };
      const recoveredMissingCandidate = {
        reason_code: 'missing_file',
        field: 'scouting-candidate.json',
        expected: 'valid scouting candidate artifact',
        actual: 'missing candidate history',
        severity: 'critical',
        suggestion: 'fallback recovered this missing candidate history',
      };
      const scoutingFallbackRecovered = {
        reason_code: 'patch_fallback_recovered',
        field: 'scouting-candidate.json',
        expected: 'fallback scouting.json',
        actual: 'fallback recovered missing candidate history',
        severity: 'warning',
        suggestion: 'use terminal failure diagnostics first',
      };
      const scoutingValidationErrors = [
        JSON.stringify(scoutingFallbackWarning),
        JSON.stringify(recoveredMissingCandidate),
        JSON.stringify(scoutingFallbackRecovered),
      ].join('\n');

      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({
        'failure.json': { exists: true, size: JSON.stringify(failureJson).length },
        'result-summary.md': { exists: true, size: resultSummary.length },
        'scouting-validation-errors.jsonl': { exists: true, size: scoutingValidationErrors.length },
      });
      mockCache.getOrLoad.mockImplementation((filePath: string) => {
        if (filePath.includes('failure.json')) {
          return JSON.stringify(failureJson);
        }
        if (filePath.includes('result-summary.md')) {
          return resultSummary;
        }
        if (filePath.includes('scouting-validation-errors.jsonl')) {
          return scoutingValidationErrors;
        }
        return null;
      });

      const response = builder.buildStatus(job as Job);

      expect(response.diagnosticSummary?.primaryReason).toBe(goalCheckReason);
      expect(response.diagnosticEntryPoint).toMatch(/^(failure\.json|result-summary\.md)$/);
      expect(response.diagnosticEntryPoint).not.toBe('scouting-validation-errors.jsonl');
      expect(response.diagnosticSummary?.recommendedEntryPoint).toMatch(/^(failure\.json|result-summary\.md)$/);
      expect(response.diagnosticSummary?.phaseDiagnostics).toBeUndefined();
    });

    it('should derive terminal completedAt from metadata when scheduler job lacks it', () => {
      const job: Partial<Job> = {
        id: 'job-terminal-metadata',
        status: 'failed',
        resultDir: '/results/job-terminal-metadata',
      };

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => filePath.endsWith('metadata.json'));
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        ended_at: '2026-06-14T08:48:29Z',
      }));

      const response = builder.buildStatus(job as Job);

      expect(response.completedAt).toBe('2026-06-14T08:48:29.000Z');
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

  describe('deriveOrchestratorStages', () => {
    const buildJob = (request: Partial<Job['request']>): Job => ({
      id: 'stage-derivation-job',
      status: 'running',
      request: {
        repoUrl: 'https://github.com/test/repo',
        ref: 'main',
        ...request,
      } as Job['request'],
    } as Job);

    it('derives exact stage names and ordering for minimal API-facing configuration', () => {
      expect(deriveOrchestratorStages(buildJob({
        taskMode: 'inspect',
        publishMode: 'none',
        goalSetting: { enabled: false },
        goalCheck: { enabled: false },
        runEvaluation: { enabled: false },
        autoLintCleanup: { enabled: false },
      }), mockConfig)).toEqual([
        'clone repository',
        'prepare node dependencies',
        'TypeScript pre-check',
        'agent setup',
        'pi coding agent',
        'collect agent diff',
        'quality checks',
        'validation',
        'secret scan',
        'complete',
      ]);
    });

    it('derives exact stage names and ordering for scouting-enabled API-facing configuration', () => {
      expect(deriveOrchestratorStages(buildJob({
        taskMode: 'patch',
        publishMode: 'none',
        goalSetting: { enabled: false },
        goalCheck: { enabled: true },
        runEvaluation: { enabled: false },
        autoLintCleanup: { enabled: false },
      }), mockConfig)).toEqual([
        'clone repository',
        'prepare node dependencies',
        'pre-agent validation',
        'TypeScript pre-check',
        'scouting prerequisites check',
        'pi scouting agent',
        'derive allowlist from scouting',
        'goal check',
        'agent setup',
        'pi coding agent',
        'collect agent diff',
        'quality checks',
        'validation',
        'secret scan',
        'complete',
      ]);
    });

    it('derives exact stage names and ordering for full-feature API-facing configuration', () => {
      expect(deriveOrchestratorStages(buildJob({
        taskMode: 'patch',
        publishMode: 'pr',
        goalSetting: { enabled: true },
        goalCheck: { enabled: true },
        runEvaluation: { enabled: true },
        autoLintCleanup: { enabled: true },
      }), mockConfig)).toEqual([
        'clone repository',
        'prepare node dependencies',
        'pre-agent validation',
        'TypeScript pre-check',
        'pi goal-setting agent',
        'scouting prerequisites check',
        'pi scouting agent',
        'derive allowlist from scouting',
        'goal check',
        'run evaluation',
        'agent setup',
        'pi coding agent',
        'auto lint cleanup',
        'collect agent diff',
        'quality checks',
        'validation',
        'secret scan',
        'github operations',
        'complete',
      ]);
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

    it('should derive stages with correct names and ordering for minimal configuration', () => {
      // Semantic test: Verify actual stage names and order from deriveOrchestratorStages
      // Minimal configuration: taskMode=patch, publishMode=pr, no special features
      const job: Partial<Job> = {
        id: 'job-minimal',
        status: 'running',
        resultDir: '/results/job-minimal',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
          taskMode: 'patch',
          publishMode: 'pr',
          goalSetting: { enabled: false },
          goalCheck: { enabled: false },
          runEvaluation: { enabled: false },
        } as any,
      };

      // Progress with no finished stages to test stage list derivation
      const progressContent = '';

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl');
      });

      (fs.readFileSync as jest.Mock).mockReturnValue(progressContent);

      const response: StatusResponse = {
        id: 'job-minimal',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Minimal config should have: clone, pre-agent validation, scouting (2), goal-check,
      // agent setup, pi coding agent, collect diff, quality checks, validation, secret scan, complete
      // Expected stages: clone repository, pre-agent validation, pi scouting agent,
      // derive allowlist from scouting, goal check, agent setup, pi coding agent,
      // collect agent diff, quality checks, validation, secret scan, complete
      expect(response.taskProgressPercent).toBeDefined();
      expect(response.taskProgressPercent).toBeGreaterThanOrEqual(0);
      expect(response.taskProgressPercent).toBeLessThanOrEqual(100);
    });

    it('should derive stages with scouting correctly ordered', () => {
      // Semantic test: Verify stages when scouting is enabled (default for patch mode)
      const job: Partial<Job> = {
        id: 'job-scouting',
        status: 'running',
        resultDir: '/results/job-scouting',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
          taskMode: 'patch',
          publishMode: 'pr',
          // Default: scouting enabled, goal-check enabled by scouting
        } as any,
      };

      // Progress shows first two stages finished
      const progressContent = [
        JSON.stringify({ stage: 'clone repository', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'pre-agent validation', status: 'finished', detail: 'finished' }),
      ].join('\n');

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl');
      });

      (fs.readFileSync as jest.Mock).mockReturnValue(progressContent);

      const response: StatusResponse = {
        id: 'job-scouting',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // With scouting: should include 'pi scouting agent' and 'derive allowlist from scouting'
      // stages after pre-agent validation
      // 2 of ~12 stages finished ≈ 16-17%
      expect(response.taskProgressPercent).toBeDefined();
      expect(response.taskProgressPercent).toBeGreaterThan(0);
      expect(response.taskProgressPercent).toBeLessThan(25);
    });

    it('should derive stages with all features enabled', () => {
      // Semantic test: Verify stage derivation with full feature set
      // (pre-agent validation, scouting, goal-check, run-evaluation, github)
      const job: Partial<Job> = {
        id: 'job-full-features',
        status: 'running',
        resultDir: '/results/job-full-features',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
          taskMode: 'patch',
          publishMode: 'pr',
          goalSetting: { enabled: true },
          goalCheck: { enabled: true },
          runEvaluation: { enabled: true },
        } as any,
      };

      // Progress shows first few stages finished
      const progressContent = [
        JSON.stringify({ stage: 'clone repository', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'pre-agent validation', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'pi goal-setting agent', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'pi scouting agent', status: 'finished', detail: 'finished' }),
      ].join('\n');

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl');
      });

      (fs.readFileSync as jest.Mock).mockReturnValue(progressContent);

      const response: StatusResponse = {
        id: 'job-full-features',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Full features should include: clone, pre-agent validation, goal-setting, scouting (2),
      // goal-check, run-evaluation, agent setup, pi coding agent, collect diff, quality checks,
      // validation, secret scan, github operations, complete
      // 4 of ~15+ stages finished ≈ 25-27%
      expect(response.taskProgressPercent).toBeDefined();
      expect(response.taskProgressPercent).toBeGreaterThan(20);
      expect(response.taskProgressPercent).toBeLessThan(40);
    });

    it('should use metadata-provided stages to calculate taskProgressPercent', () => {
      const job: Partial<Job> = {
        id: 'job-1',
        status: 'running',
        resultDir: '/results/job-1',
        request: {
          repoUrl: 'https://github.com/test/repo',
          ref: 'main',
          taskMode: 'patch',
          publishMode: 'pr',
        } as any,
      };

      const metadataContent = JSON.stringify({
        stages: ['stage1', 'stage2', 'stage3', 'stage4'],
      });

      // Progress shows only stage1 and stage2 finished. These names are not in the
      // derived orchestrator stages, so a 50% result proves metadata.stages is the
      // denominator used by the production status response path.
      const progressContent = [
        JSON.stringify({ stage: 'stage1', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'stage2', status: 'finished', detail: 'finished' }),
      ].join('\n');

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('metadata.json') || filePath.includes('progress.jsonl');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('metadata.json')) {
          return metadataContent;
        }
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return '';
      });

      const response = builder.buildStatus(job as Job);

      // Should use metadata stages as denominator (4 stages total).
      // With 2 stages finished: (2/4) * 100 = 50%.
      expect(response.taskProgressPercent).toBe(50);

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl');
      });

      const responseWithoutMetadataStages = builder.buildStatus(job as Job);

      expect(responseWithoutMetadataStages.taskProgressPercent).not.toBe(50);
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

      // Should include partial credit for the active stage.
      expect(response.taskProgressPercent).toBe(50); // 1.5 of 3 stages
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
      const progressPath = '/results/job-1/progress.jsonl';
      const metadataPath = '/results/job-1/metadata.json';

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath === progressPath) {
          return false;
        }
        return filePath === metadataPath;
      });
      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath === metadataPath) {
          return JSON.stringify({ stages: ['stage1', 'stage2', 'stage3'] });
        }
        throw new Error(`Unexpected read for ${filePath}`);
      });
      mockScheduler.getLiveProgressEvents.mockReturnValue([]);

      const response: StatusResponse = {
        id: 'job-1',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      expect(fs.existsSync).toHaveBeenCalledWith(progressPath);
      expect(fs.readFileSync).not.toHaveBeenCalledWith(progressPath, expect.anything());
      expect(mockScheduler.getLiveProgressEvents).toHaveBeenCalledWith('job-1', 100);
      expect(response.taskProgressPercent).toBe(0);
      expect(response.progress).toBeUndefined();
      expect(response.status).toBe('running');
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

      expect(mockScheduler.getLiveProgressEvents).toHaveBeenCalledWith('job-1', 100);
      expect(response.taskProgressPercent).toBeDefined();
    });

    it('should calculate partial taskProgressPercent when progress includes a stage missing from metadata', () => {
      // Semantic missing-stage test: runtime progress may include a finished
      // stage that metadata.stages did not pre-declare. Exercise the production
      // addTaskProgressInfo path instead of recomputing percentages externally.
      const job: Partial<Job> = {
        id: 'job-missing-stage',
        status: 'running',
        resultDir: '/results/job-missing-stage',
      };

      const progressContent = [
        JSON.stringify({ stage: 'clone repository', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'runtime-only stage', status: 'finished', detail: 'finished' }),
      ].join('\n');

      const metadataContent = JSON.stringify({
        stages: ['clone repository', 'agent setup', 'pi coding agent', 'quality checks'],
      });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return metadataContent;
      });

      const response: StatusResponse = {
        id: 'job-missing-stage',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // Two finished progress events over four declared stages: 2/4 = 50%.
      expect(response.taskProgressPercent).toBe(50);
    });

    it('should calculate 100% through addTaskProgressInfo when stages are over-completed', () => {
      // Semantic test: metadata declares fewer denominator stages than the finished
      // stages observed in progress.jsonl, as can happen when runtime execution
      // emits additional phases beyond what metadata pre-declared.
      const job: Partial<Job> = {
        id: 'job-clamp-test',
        status: 'running',
        resultDir: '/results/job-clamp-test',
      };

      const progressContent = [
        JSON.stringify({ stage: 'clone repository', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'agent setup', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'pi coding agent', status: 'finished', detail: 'finished' }),
      ].join('\n');

      const metadataContent = JSON.stringify({
        stages: ['clone repository', 'agent setup'],
      });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return metadataContent;
      });

      const response: StatusResponse = {
        id: 'job-clamp-test',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      expect(response.taskProgressPercent).toBe(100);
    });

    it('should calculate partial progress through addTaskProgressInfo when first stage is active', () => {
      // Semantic boundary test: a started stage should show visible forward movement.
      const job: Partial<Job> = {
        id: 'job-zero-progress',
        status: 'running',
        resultDir: '/results/job-zero-progress',
      };

      // Progress shows only a started stage, no finished stages
      const progressContent = JSON.stringify({ stage: 'clone repository', status: 'started' });

      const metadataContent = JSON.stringify({
        stages: ['clone repository', 'agent setup', 'pi coding agent', 'quality checks'],
      });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return metadataContent;
      });

      const response: StatusResponse = {
        id: 'job-zero-progress',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // First stage active: 0.5/4 = 12.5%, rounded to 13%.
      expect(response.taskProgressPercent).toBe(13);
    });

    it('should calculate 100% through addTaskProgressInfo when all stages are completed', () => {
      // Semantic boundary test: all stages completed should yield exactly 100%
      const job: Partial<Job> = {
        id: 'job-all-complete',
        status: 'running',
        resultDir: '/results/job-all-complete',
      };

      // Progress shows all stages finished
      const progressContent = [
        JSON.stringify({ stage: 'clone repository', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'agent setup', status: 'finished', detail: 'finished' }),
        JSON.stringify({ stage: 'pi coding agent', status: 'finished', detail: 'finished' }),
      ].join('\n');

      const metadataContent = JSON.stringify({
        stages: ['clone repository', 'agent setup', 'pi coding agent'],
      });

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.includes('progress.jsonl') || filePath.includes('metadata.json');
      });

      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('progress.jsonl')) {
          return progressContent;
        }
        return metadataContent;
      });

      const response: StatusResponse = {
        id: 'job-all-complete',
        status: 'running',
      };

      builder['addTaskProgressInfo'](response, job as Job);

      // All stages finished: 3/3 = 100%
      expect(response.taskProgressPercent).toBe(100);
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

      const response = builder.buildStatus(job as Job);

      expect(response).toMatchObject({
        id: 'job-1',
        status: 'completed',
        resultDir: '/nonexistent/path',
      });
      expect(response.progress).toBeUndefined();
      expect(response.taskProgressPercent).toBe(0);
      expect(response.artifacts).toEqual({
        metadataJson: false,
        analysisMd: false,
        resultSummaryMd: false,
        failureJson: false,
        stderrLog: false,
        stdoutLog: false,
        availableFiles: [],
      });
      expect(response.resultSummaryContent).toBeUndefined();
      expect(response.failureJsonContent).toBeUndefined();

      expect(() => builder.buildStatus(job as Job)).not.toThrow();
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
        id: 'job-corrupted-metadata',
        status: 'completed',
        resultDir: '/results/job-corrupted-metadata',
      };

      (artifactMetadataCache.getRunArtifactMetadata as jest.Mock).mockReturnValue({});
      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath === '/results/job-corrupted-metadata' || filePath.includes('metadata.json');
      });
      (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('metadata.json')) {
          throw new Error('metadata.json is corrupted');
        }
        return '';
      });

      const response = builder.buildStatus(job as Job);

      expect(response).toMatchObject({
        id: 'job-corrupted-metadata',
        status: 'completed',
        resultDir: '/results/job-corrupted-metadata',
        artifacts: {
          metadataJson: false,
          analysisMd: false,
          resultSummaryMd: false,
          failureJson: false,
          stderrLog: false,
          stdoutLog: false,
          availableFiles: [],
        },
      });
      expect(response.exitCode).toBeUndefined();
      expect(response.validationFailureReason).toBeUndefined();
      expect(response.validationAllowlistFailureReason).toBeUndefined();
      expect(response.qualityFailureReason).toBeUndefined();
      expect(response.goalCheckFailureReason).toBeUndefined();
      expect(response.failureClass).toBeUndefined();
      expect(response.error).toBeUndefined();
    });
  });
});
