/**
 * Tests for Orchestrator Stages Derivation
 *
 * Tests stage sequencing logic based on job configuration, task mode, and feature flags
 */

import { deriveOrchestratorStages } from './orchestrator-stages';
import { Job, JobStatus } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';

describe('orchestrator-stages', () => {
  // Mock config
  const mockConfig: KasekiApiConfig = {
    resultsDir: '/results',
    defaultTaskMode: 'fix',
    apiKeys: [],
    defaultModel: 'openrouter/auto',
  } as Partial<KasekiApiConfig> as KasekiApiConfig;

  // Helper to create a job with defaults
  const createJob = (overrides?: Partial<Job>): Job => ({
    id: 'test-job-1',
    status: 'running' as JobStatus,
    request: { taskMode: 'fix' },
    resultDir: '/tmp/test-result',
    ...overrides,
  });

  describe('Basic stages', () => {
    it('should include core stages for minimal job', () => {
      const job = createJob({ request: {} });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('clone repository');
      expect(stages).toContain('prepare node dependencies');
      expect(stages).toContain('TypeScript pre-check');
      expect(stages).toContain('agent setup');
      expect(stages).toContain('pi coding agent');
      expect(stages).toContain('collect agent diff');
      expect(stages).toContain('quality checks');
      expect(stages).toContain('validation');
      expect(stages).toContain('secret scan');
      expect(stages).toContain('complete');
    });

    it('should maintain stage order', () => {
      const job = createJob();
      const stages = deriveOrchestratorStages(job, mockConfig);

      const cloneIdx = stages.indexOf('clone repository');
      const dependIdx = stages.indexOf('prepare node dependencies');
      const checkIdx = stages.indexOf('TypeScript pre-check');
      const agentIdx = stages.indexOf('pi coding agent');
      const collectIdx = stages.indexOf('collect agent diff');

      expect(cloneIdx).toBeLessThan(dependIdx);
      expect(dependIdx).toBeLessThan(checkIdx);
      expect(checkIdx).toBeLessThan(agentIdx);
      expect(agentIdx).toBeLessThan(collectIdx);
    });
  });

  describe('Pre-agent validation stages', () => {
    it('should skip pre-validation for inspect task mode', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          validationCommands: ['npm test'],
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('pre-agent validation');
      expect(stages).not.toContain('baseline validation');
    });

    it('should include pre-agent validation for fix task mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('pre-agent validation');
    });

    it('should include baseline validation if commands present', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          validation: {
            commands: ['npm run test', 'npm run lint'],
          },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('baseline validation');
      expect(stages).toContain('pre-agent validation');
    });

    it('should skip baseline validation if no commands', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          validation: {},
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('baseline validation');
      expect(stages).toContain('pre-agent validation');
    });
  });

  describe('Goal Setting stages', () => {
    it('should include goal-setting for fix task mode by default', () => {
      const job = createJob({
        request: { taskMode: 'fix' },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('pi goal-setting agent');
    });

    it('should skip goal-setting for fix if explicitly disabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          goalSetting: { enabled: false },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('pi goal-setting agent');
    });

    it('should skip goal-setting for inspect task mode unless enabled', () => {
      const job = createJob({
        request: { taskMode: 'inspect' },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('pi goal-setting agent');
    });

    it('should include goal-setting for inspect task mode if enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalSetting: { enabled: true },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('pi goal-setting agent');
    });

    it('should skip goal-setting for inspect if explicitly disabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalSetting: { enabled: false },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('pi goal-setting agent');
    });
  });

  describe('Scouting stages', () => {
    it('should skip scouting for inspect task mode', () => {
      const job = createJob({
        request: { taskMode: 'inspect' },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('scouting prerequisites check');
      expect(stages).not.toContain('pi scouting agent');
      expect(stages).not.toContain('derive allowlist from scouting');
    });

    it('should include scouting stages for fix task mode', () => {
      const job = createJob({
        request: { taskMode: 'fix' },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('scouting prerequisites check');
      expect(stages).toContain('pi scouting agent');
      expect(stages).toContain('derive allowlist from scouting');
    });

    it('should maintain scouting stage order', () => {
      const job = createJob({
        request: { taskMode: 'fix' },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      const preIdx = stages.indexOf('scouting prerequisites check');
      const agentIdx = stages.indexOf('pi scouting agent');
      const deriveIdx = stages.indexOf('derive allowlist from scouting');

      expect(preIdx).toBeLessThan(agentIdx);
      expect(agentIdx).toBeLessThan(deriveIdx);
    });
  });

  describe('Goal Check stages', () => {
    it('should include goal-check for fix task mode by default', () => {
      const job = createJob({
        request: { taskMode: 'fix' },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('goal check');
    });

    it('should include goal-check for inspect if enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalCheck: { enabled: true },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('goal check');
    });

    it('should skip goal-check for inspect if explicitly disabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalCheck: { enabled: false },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('goal check');
    });
  });

  describe('Run Evaluation stages', () => {
    it('should include run-evaluation for PR publish mode by default', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('run evaluation');
    });

    it('should include run-evaluation for draft_pr publish mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'draft_pr',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('run evaluation');
    });

    it('should skip run-evaluation for "none" publish mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'none',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('run evaluation');
    });

    it('should skip run-evaluation for startup check (dry run)', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          startupCheck: true,
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('run evaluation');
    });

    it('should skip run-evaluation for inspect task mode by default', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          publishMode: 'pr',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('run evaluation');
    });

    it('should include run-evaluation for inspect if explicitly enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          runEvaluation: { enabled: true },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('run evaluation');
    });
  });

  describe('Auto Lint Cleanup stages', () => {
    it('should skip auto-lint for inspect task mode unless enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('auto lint cleanup');
    });

    it('should include auto-lint for inspect if explicitly enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          autoLintCleanup: { enabled: true },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('auto lint cleanup');
    });

    it('should skip auto-lint for dry runs', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          startupCheck: true,
          autoLintCleanup: { enabled: true },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('auto lint cleanup');
    });

    it('should handle autoLintCleanup under validation namespace', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          validation: {
            autoLintCleanup: { enabled: true },
          },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('auto lint cleanup');
    });
  });

  describe('GitHub Integration stages', () => {
    it('should include github-operations for PR mode (non-dry-run)', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          startupCheck: false,
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('github operations');
    });

    it('should skip github-operations for "none" publish mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'none',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('github operations');
    });

    it('should skip github-operations for dry runs', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          startupCheck: true,
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('github operations');
    });
  });

  describe('Edge cases', () => {
    it('should handle job with no request', () => {
      const job = createJob({
        request: undefined as any,
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages.length).toBeGreaterThan(0);
      expect(stages).toContain('clone repository');
      expect(stages).toContain('complete');
    });

    it('should use default task mode from config if not specified', () => {
      const job = createJob({
        request: {},
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      // fix mode should include scouting
      expect(stages).toContain('pi scouting agent');
    });

    it('should handle all combinations without errors', () => {
      const taskModes = ['fix', 'inspect'];
      const publishModes = ['pr', 'draft_pr', 'none'];
      const startupChecks = [true, false];

      for (const taskMode of taskModes) {
        for (const publishMode of publishModes) {
          for (const startupCheck of startupChecks) {
            const job = createJob({
              request: { taskMode: taskMode as any, publishMode: publishMode as any, startupCheck },
            });
            const stages = deriveOrchestratorStages(job, mockConfig);

            expect(Array.isArray(stages)).toBe(true);
            expect(stages.length).toBeGreaterThan(0);
            expect(stages[stages.length - 1]).toBe('complete');
          }
        }
      }
    });

    it('should never return empty array', () => {
      const job = createJob();
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages.length).toBeGreaterThan(0);
    });

    it('should always end with "complete"', () => {
      const job = createJob();
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages[stages.length - 1]).toBe('complete');
    });

    it('should always start with "clone repository"', () => {
      const job = createJob();
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages[0]).toBe('clone repository');
    });
  });

  describe('Complex scenarios', () => {
    it('should handle full-featured inspect mode', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalSetting: { enabled: true },
          goalCheck: { enabled: true },
          runEvaluation: { enabled: true },
          autoLintCleanup: { enabled: true },
          startupCheck: false,
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('pi goal-setting agent');
      expect(stages).toContain('goal check');
      expect(stages).toContain('run evaluation');
      expect(stages).toContain('auto lint cleanup');
      expect(stages).not.toContain('pi scouting agent');
    });

    it('should handle full-featured fix mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          validationCommands: ['npm test'],
          startupCheck: false,
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('baseline validation');
      expect(stages).toContain('pre-agent validation');
      expect(stages).toContain('pi scouting agent');
      expect(stages).toContain('goal check');
      expect(stages).toContain('run evaluation');
      expect(stages).toContain('github operations');
    });

    it('should handle restricted inspect mode (all disabled)', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalSetting: { enabled: false },
          goalCheck: { enabled: false },
          runEvaluation: { enabled: false },
          autoLintCleanup: { enabled: false },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('pi goal-setting agent');
      expect(stages).not.toContain('goal check');
      expect(stages).not.toContain('run evaluation');
      expect(stages).not.toContain('auto lint cleanup');
      expect(stages).not.toContain('pi scouting agent');
    });
  });
});
