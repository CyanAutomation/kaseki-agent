/**
 * Tests for Orchestrator Stages Derivation
 *
 * Tests stage sequencing logic based on job configuration, task mode, and feature flags
 */

import { deriveOrchestratorStages, deriveFeatureFlags } from './orchestrator-stages';
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
      expect(stages).toContain('typescript precheck');
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
      const checkIdx = stages.indexOf('typescript precheck');
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

      expect(stages).not.toContain('scouting prerequisites validation');
      expect(stages).not.toContain('pi scouting agent');
      expect(stages).not.toContain('derive allowlist from scouting');
    });

    it('should include scouting stages for fix task mode', () => {
      const job = createJob({
        request: { taskMode: 'fix' },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('scouting prerequisites validation');
      expect(stages).toContain('pi scouting agent');
      expect(stages).toContain('derive allowlist from scouting');
    });

    it('should maintain scouting stage order', () => {
      const job = createJob({
        request: { taskMode: 'fix' },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      const preIdx = stages.indexOf('scouting prerequisites validation');
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

  describe('deriveFeatureFlags', () => {
    it('should derive flags for fix task mode', () => {
      const job = createJob({ request: { taskMode: 'fix' } });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.dryRun).toBe(false);
      expect(flags.preAgentValidation).toBe(true);
      expect(flags.goalSettingEnabled).toBe(true);
      expect(flags.scoutingEnabled).toBe(true);
      expect(flags.goalCheckEnabled).toBe(true);
      expect(flags.githubAppEnabled).toBe(true);
    });

    it('should derive flags for inspect task mode', () => {
      const job = createJob({ request: { taskMode: 'inspect' } });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.preAgentValidation).toBe(false);
      expect(flags.scoutingEnabled).toBe(false);
      expect(flags.goalSettingEnabled).toBe(false);
    });

    it('should set dryRun when startupCheck is enabled', () => {
      const job = createJob({
        request: { taskMode: 'fix', startupCheck: true },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.dryRun).toBe(true);
    });

    it('should disable githubAppEnabled for "none" publish mode', () => {
      const job = createJob({
        request: { taskMode: 'fix', publishMode: 'none' },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.githubAppEnabled).toBe(false);
    });

    it('should respect explicit feature enablement in inspect mode', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalSetting: { enabled: true },
          goalCheck: { enabled: true },
          runEvaluation: { enabled: true },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(true);
      expect(flags.goalCheckEnabled).toBe(true);
      expect(flags.runEvaluationEnabled).toBe(true);
    });

    it('should respect explicit feature disablement in fix mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          goalSetting: { enabled: false },
          scoutingEnabled: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(false);
    });

    it('should disable runEvaluation for inspect without explicit enablement', () => {
      const job = createJob({ request: { taskMode: 'inspect' } });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(false);
    });

    it('should include runEvaluation for PR publish mode in fix mode', () => {
      const job = createJob({
        request: { taskMode: 'fix', publishMode: 'pr' },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(true);
    });

    it('should disable runEvaluation for dry runs', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          startupCheck: true,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(false);
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
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(true);
    });
  });

  describe('deriveFeatureFlags - comprehensive coverage', () => {
    it('should derive all flags correctly for patch mode (fix)', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          startupCheck: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.dryRun).toBe(false);
      expect(flags.preAgentValidation).toBe(true);
      expect(flags.goalSettingEnabled).toBe(true);
      expect(flags.scoutingEnabled).toBe(true);
      expect(flags.goalCheckEnabled).toBe(true);
      expect(flags.runEvaluationEnabled).toBe(true);
      expect(flags.autoLintCleanupEnabled).toBe(true);
      expect(flags.githubAppEnabled).toBe(true);
    });

    it('should derive all flags correctly for inspect mode', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          publishMode: 'pr',
          startupCheck: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.dryRun).toBe(false);
      expect(flags.preAgentValidation).toBe(false);
      expect(flags.goalSettingEnabled).toBe(false);
      expect(flags.scoutingEnabled).toBe(false);
      expect(flags.goalCheckEnabled).toBe(false);
      expect(flags.runEvaluationEnabled).toBe(false);
      expect(flags.autoLintCleanupEnabled).toBe(false);
      expect(flags.githubAppEnabled).toBe(true);
    });

    it('should set dryRun=true for startup check', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          startupCheck: true,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.dryRun).toBe(true);
    });

    it('should disable githubAppEnabled for "none" publish mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'none',
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.githubAppEnabled).toBe(false);
    });

    it('should disable scoutingEnabled for inspect mode', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.scoutingEnabled).toBe(false);
    });

    it('should handle nested validation namespace for autoLintCleanup', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          validation: {
            autoLintCleanup: { enabled: false },
          },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(false);
    });

    it('should prioritize direct autoLintCleanup over validation.autoLintCleanup', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          autoLintCleanup: { enabled: true },
          validation: {
            autoLintCleanup: { enabled: false },
          },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(true);
    });

    it('should return correct type with all required properties', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(typeof flags).toBe('object');
      expect(flags).toHaveProperty('dryRun');
      expect(flags).toHaveProperty('preAgentValidation');
      expect(flags).toHaveProperty('goalSettingEnabled');
      expect(flags).toHaveProperty('scoutingEnabled');
      expect(flags).toHaveProperty('goalCheckEnabled');
      expect(flags).toHaveProperty('runEvaluationEnabled');
      expect(flags).toHaveProperty('autoLintCleanupEnabled');
      expect(flags).toHaveProperty('githubAppEnabled');
    });

    it('should enable runEvaluation for draft_pr mode in fix', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'draft_pr',
          startupCheck: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(true);
    });

    it('should disable runEvaluation for branch mode in fix', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'branch',
          startupCheck: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(false);
    });

    it('should disable runEvaluation for "none" mode in fix', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'none',
          startupCheck: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(false);
    });

    it('should enable autoLintCleanup by default for fix mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(true);
    });

    it('should disable autoLintCleanup for inspect mode by default', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(false);
    });

    it('should enable autoLintCleanup for inspect mode when explicitly enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          autoLintCleanup: { enabled: true },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(true);
    });

    it('should handle goalCheck defaulting correctly for fix mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalCheckEnabled).toBe(true);
    });

    it('should handle goalCheck defaulting correctly for inspect mode', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalCheckEnabled).toBe(false);
    });

    it('should disable goalSetting for fix mode when explicitly disabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          goalSetting: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(false);
    });

    it('should enable goalSetting for fix mode by default', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(true);
    });

    it('should handle undefined request safely', () => {
      const job = createJob({
        request: undefined as any,
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.dryRun).toBe(false);
      expect(flags.preAgentValidation).toBe(true); // defaults to fix mode
      expect(flags.scoutingEnabled).toBe(true);
    });

    it('should use config default task mode when request has no taskMode', () => {
      const job = createJob({
        request: {},
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      // mockConfig has defaultTaskMode: 'fix'
      expect(flags.preAgentValidation).toBe(true);
      expect(flags.scoutingEnabled).toBe(true);
    });

    it('should handle empty validation commands array', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          validation: {
            commands: [],
          },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('baseline validation');
      expect(stages).toContain('pre-agent validation');
    });

    it('should handle runEvaluation with explicit false in fix mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          runEvaluation: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(false);
    });

    it('should handle mixed enabled/disabled features correctly', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          goalSetting: { enabled: false },
          goalCheck: { enabled: false },
          autoLintCleanup: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(false);
      expect(flags.goalCheckEnabled).toBe(false);
      expect(flags.autoLintCleanupEnabled).toBe(false);
      expect(flags.scoutingEnabled).toBe(true); // not disabled
      expect(flags.runEvaluationEnabled).toBe(true); // not disabled
    });

    it('should disable all optional features for dry run', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          startupCheck: true,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.dryRun).toBe(true);
      expect(flags.runEvaluationEnabled).toBe(false);
    });
  });

  describe('deriveOrchestratorStages - stage sequencing', () => {
    it('should include goal-setting stage when enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          goalSetting: { enabled: true },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('pi goal-setting agent');
    });

    it('should not include goal-setting stage when disabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalSetting: { enabled: false },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('pi goal-setting agent');
    });

    it('should include scouting stages when enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          scoutingEnabled: true,
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('scouting prerequisites validation');
      expect(stages).toContain('pi scouting agent');
      expect(stages).toContain('derive allowlist from scouting');
    });

    it('should not include scouting stages for inspect mode', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('scouting prerequisites validation');
      expect(stages).not.toContain('pi scouting agent');
      expect(stages).not.toContain('derive allowlist from scouting');
    });

    it('should include goal check stage when enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          goalCheck: { enabled: true },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('goal check');
    });

    it('should not include goal check stage when disabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalCheck: { enabled: false },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('goal check');
    });

    it('should include run evaluation stage when enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          runEvaluation: { enabled: true },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('run evaluation');
    });

    it('should not include run evaluation stage when disabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          runEvaluation: { enabled: false },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('run evaluation');
    });

    it('should include auto lint cleanup when enabled and not dryRun', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          autoLintCleanup: { enabled: true },
          startupCheck: false,
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('auto lint cleanup');
    });

    it('should not include auto lint cleanup during dryRun even if enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          autoLintCleanup: { enabled: true },
          startupCheck: true, // dryRun
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('auto lint cleanup');
    });

    it('should include github operations when githubApp enabled and not dryRun', () => {
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

    it('should not include github operations when githubApp disabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'none',
          startupCheck: false,
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('github operations');
    });

    it('should not include github operations during dryRun', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          startupCheck: true, // dryRun
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('github operations');
    });

    it('should include pre-agent validation for fix mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('pre-agent validation');
    });

    it('should not include pre-agent validation for inspect mode', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).not.toContain('pre-agent validation');
    });

    it('should include baseline validation when validation commands present in fix mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          validation: {
            commands: ['npm test'],
          },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('baseline validation');
      expect(stages).toContain('pre-agent validation');
    });

    it('should include baseline validation with validationCommands at top level', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          validationCommands: ['npm test', 'npm run build'],
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('baseline validation');
    });

    it('should always include core stages', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          goalSetting: { enabled: false },
          goalCheck: { enabled: false },
          scoutingEnabled: false,
          runEvaluation: { enabled: false },
          autoLintCleanup: { enabled: false },
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('clone repository');
      expect(stages).toContain('prepare node dependencies');
      expect(stages).toContain('typescript precheck');
      expect(stages).toContain('pi coding agent');
      expect(stages).toContain('collect agent diff');
      expect(stages).toContain('quality checks');
      expect(stages).toContain('validation');
      expect(stages).toContain('secret scan');
      expect(stages).toContain('complete');
    });

    it('should maintain correct stage order', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          validationCommands: ['npm test'],
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      const cloneIdx = stages.indexOf('clone repository');
      const tsIdx = stages.indexOf('typescript precheck');
      const piIdx = stages.indexOf('pi coding agent');
      const diffIdx = stages.indexOf('collect agent diff');
      const completeIdx = stages.indexOf('complete');

      expect(cloneIdx).toBeLessThan(tsIdx);
      expect(tsIdx).toBeLessThan(piIdx);
      expect(piIdx).toBeLessThan(diffIdx);
      expect(diffIdx).toBeLessThan(completeIdx);
    });

    it('should handle all features enabled simultaneously', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'pr',
          validationCommands: ['npm test'],
          goalSetting: { enabled: true },
          goalCheck: { enabled: true },
          runEvaluation: { enabled: true },
          autoLintCleanup: { enabled: true },
          startupCheck: false,
        },
      });
      const stages = deriveOrchestratorStages(job, mockConfig);

      expect(stages).toContain('baseline validation');
      expect(stages).toContain('pre-agent validation');
      expect(stages).toContain('pi goal-setting agent');
      expect(stages).toContain('scouting prerequisites validation');
      expect(stages).toContain('pi scouting agent');
      expect(stages).toContain('derive allowlist from scouting');
      expect(stages).toContain('goal check');
      expect(stages).toContain('run evaluation');
      expect(stages).toContain('auto lint cleanup');
      expect(stages).toContain('github operations');
    });
  });

  describe('deriveFeatureFlags - ternary path coverage', () => {
    it('should handle autoLintCleanup in inspect mode with undefined enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          autoLintCleanup: {}, // enabled is undefined
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(false);
    });

    it('should handle autoLintCleanup in inspect mode with explicit true', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          autoLintCleanup: { enabled: true },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(true);
    });

    it('should handle autoLintCleanup in inspect mode with explicit false', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          autoLintCleanup: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(false);
    });

    it('should handle autoLintCleanup in fix mode with undefined enabled', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          autoLintCleanup: {}, // enabled is undefined
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(true); // defaults to true
    });

    it('should handle autoLintCleanup in fix mode with explicit true', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          autoLintCleanup: { enabled: true },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(true);
    });

    it('should handle autoLintCleanup in fix mode with explicit false', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          autoLintCleanup: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(false);
    });

    it('should handle runEvaluation in inspect mode with explicit true', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          publishMode: 'pr',
          runEvaluation: { enabled: true },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(true);
    });

    it('should handle runEvaluation in inspect mode with explicit false', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          publishMode: 'pr',
          runEvaluation: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(false);
    });

    it('should handle runEvaluation in fix mode with draft_pr and no explicit setting', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'draft_pr',
          startupCheck: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(true);
    });

    it('should handle runEvaluation in fix mode with branch and no explicit setting', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'branch',
          startupCheck: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(false);
    });

    it('should handle runEvaluation in fix mode with explicit override', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'branch',
          runEvaluation: { enabled: true },
          startupCheck: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(true);
    });

    it('should handle goalSetting in inspect mode with explicit true', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalSetting: { enabled: true },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(true);
    });

    it('should handle goalSetting in inspect mode with explicit false', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalSetting: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(false);
    });

    it('should handle goalSetting in fix mode with explicit override', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          goalSetting: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(false);
    });

    it('should handle goalCheck in inspect mode with explicit true', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalCheck: { enabled: true },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalCheckEnabled).toBe(true);
    });

    it('should handle goalCheck in inspect mode with explicit false', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalCheck: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalCheckEnabled).toBe(false);
    });

    it('should handle goalCheck in fix mode with explicit override', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          goalCheck: { enabled: false },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalCheckEnabled).toBe(false);
    });

    it('should set preAgentValidation based on taskMode', () => {
      const jobFix = createJob({
        request: { taskMode: 'fix' },
      });
      const jobInspect = createJob({
        request: { taskMode: 'inspect' },
      });

      expect(deriveFeatureFlags(jobFix, mockConfig).preAgentValidation).toBe(true);
      expect(deriveFeatureFlags(jobInspect, mockConfig).preAgentValidation).toBe(false);
    });

    it('should set scoutingEnabled based on taskMode', () => {
      const jobFix = createJob({
        request: { taskMode: 'fix' },
      });
      const jobInspect = createJob({
        request: { taskMode: 'inspect' },
      });

      expect(deriveFeatureFlags(jobFix, mockConfig).scoutingEnabled).toBe(true);
      expect(deriveFeatureFlags(jobInspect, mockConfig).scoutingEnabled).toBe(false);
    });

    it('should set githubAppEnabled based on publishMode', () => {
      const jobPr = createJob({
        request: { publishMode: 'pr' },
      });
      const jobNone = createJob({
        request: { publishMode: 'none' },
      });

      expect(deriveFeatureFlags(jobPr, mockConfig).githubAppEnabled).toBe(true);
      expect(deriveFeatureFlags(jobNone, mockConfig).githubAppEnabled).toBe(false);
    });

    it('should set dryRun based on startupCheck', () => {
      const jobWithStartup = createJob({
        request: { startupCheck: true },
      });
      const jobWithoutStartup = createJob({
        request: { startupCheck: false },
      });

      expect(deriveFeatureFlags(jobWithStartup, mockConfig).dryRun).toBe(true);
      expect(deriveFeatureFlags(jobWithoutStartup, mockConfig).dryRun).toBe(false);
    });

    it('should handle githubAppEnabled for auto publishMode', () => {
      const job = createJob({
        request: { publishMode: 'auto' },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.githubAppEnabled).toBe(true);
    });

    it('should handle githubAppEnabled for draft_pr publishMode', () => {
      const job = createJob({
        request: { publishMode: 'draft_pr' },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.githubAppEnabled).toBe(true);
    });

    it('should handle githubAppEnabled for branch publishMode', () => {
      const job = createJob({
        request: { publishMode: 'branch' },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.githubAppEnabled).toBe(true);
    });

    it('should handle runEvaluation in fix mode with auto publishMode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          publishMode: 'auto',
          startupCheck: false,
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.runEvaluationEnabled).toBe(false); // auto is not pr or draft_pr
    });

    it('should handle validation.autoLintCleanup fallback when autoLintCleanup is absent', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          validation: {
            autoLintCleanup: { enabled: true },
          },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(true);
    });

    it('should handle validation.autoLintCleanup fallback with false in fix mode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          validation: {
            autoLintCleanup: { enabled: false },
          },
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.autoLintCleanupEnabled).toBe(false);
    });

    it('should handle inspect mode with no enabled properties at all', () => {
      const job = createJob({
        request: {
          taskMode: 'inspect',
          goalSetting: {},
          goalCheck: {},
          runEvaluation: {},
          autoLintCleanup: {},
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(false);
      expect(flags.goalCheckEnabled).toBe(false);
      expect(flags.runEvaluationEnabled).toBe(false);
      expect(flags.autoLintCleanupEnabled).toBe(false);
    });

    it('should handle fix mode with no enabled properties at all', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          goalSetting: {},
          goalCheck: {},
          runEvaluation: {},
          autoLintCleanup: {},
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.goalSettingEnabled).toBe(true); // defaults to true
      expect(flags.goalCheckEnabled).toBe(true); // defaults to true
      expect(flags.runEvaluationEnabled).toBe(true); // defaults to true (pr mode)
      expect(flags.autoLintCleanupEnabled).toBe(true); // defaults to true
    });

    it('should use pr as default publishMode', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          // no publishMode specified
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.githubAppEnabled).toBe(true); // pr mode enables github app
      expect(flags.runEvaluationEnabled).toBe(true); // pr mode enables evaluation
    });

    it('should handle request without publishMode property', () => {
      const job = createJob({
        request: {
          taskMode: 'fix',
          // explicit no publishMode
        },
      });
      const flags = deriveFeatureFlags(job, mockConfig);

      expect(flags.githubAppEnabled).toBe(true);
    });
  });
});
