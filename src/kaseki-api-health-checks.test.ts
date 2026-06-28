/**
 * src/kaseki-api-health-checks.test.ts
 *
 * Comprehensive test suite for kaseki-api-health-checks.ts module.
 * Tests all health check functions with success, failure, and edge-case scenarios.
 *
 * **Coverage Target**: >90% for all exported functions
 *
 * Mocked dependencies:
 * - fs: filesystem operations
 * - child_process.spawnSync: subprocess execution
 * - execDockerCommand: Docker operations
 * - readHostSecret: secret retrieval
 * - validateGitHubAppPrivateKey: GitHub App validation
 * - resolveGatewayApiKey: gateway key resolution
 */

import * as fs from 'fs';
import { spawnSync } from 'node:child_process';
import {
  checkDeletedBindMounts,
  checkWritableDirectory,
  checkLLMGatewayKey,
  checkGatewayTestSecretConsistency,
  checkWorkerGatewayConfig,
  checkGitHubAppCredentials,
  checkWorkerSmokeTest,
  buildTemplateHealthStatus,
  resolveCheckoutFreshness,
  checkTemplateActivatorParity,
  getSubmissionTemplateHealthStatus,
  checkTemplatePublishModeCompatibility,
  shouldBlockForFreshness,
  isTemplateDoctorTimeout,
  TEMPLATE_REMEDIATION,
} from './kaseki-api-health-checks';
import { execDockerCommand } from './lib/subprocess-helpers';
import {
  readHostSecret,
  getSecretLocations,
} from './secrets/host-secrets-reader';
import { validateGitHubAppPrivateKey } from './github-app-private-key';
import {
  resolveGatewayApiKey,
  isResponsesEndpoint,
} from './kaseki-api-gateway-smoke';

jest.mock('fs');
jest.mock('node:child_process');
jest.mock('./lib/subprocess-helpers');
jest.mock('./secrets/host-secrets-reader');
jest.mock('./github-app-private-key');
jest.mock('./kaseki-api-gateway-smoke');
jest.mock('./utils/file-helpers', () => ({
  commandOutput: jest.fn().mockReturnValue(''),
  readFirstLine: jest.fn().mockReturnValue(''),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockExecDocker = execDockerCommand as jest.MockedFunction<
  typeof execDockerCommand
>;
const mockReadHostSecret = readHostSecret as jest.MockedFunction<
  typeof readHostSecret
>;
const mockGetSecretLocations = getSecretLocations as jest.MockedFunction<
  typeof getSecretLocations
>;
const mockValidateGitHubKey = validateGitHubAppPrivateKey as jest.MockedFunction<
  typeof validateGitHubAppPrivateKey
>;
const mockResolveGatewayKey = resolveGatewayApiKey as jest.MockedFunction<
  typeof resolveGatewayApiKey
>;
const mockIsResponsesEndpoint = isResponsesEndpoint as jest.MockedFunction<
  typeof isResponsesEndpoint
>;

describe('kaseki-api-health-checks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.KASEKI_PROVIDER = 'gateway';
    process.env.LLM_GATEWAY_URL = 'https://gateway.example/v1';
    process.env.KASEKI_TEMPLATE_DIR = '/agents/kaseki-template';
    process.env.KASEKI_CHECKOUT_DIR = '/agents/kaseki-agent';
  });

  describe('checkDeletedBindMounts', () => {
    it('should pass when no deleted mounts are detected', () => {
      mockFs.readFileSync.mockReturnValue(
        '1 2 3 /mount1 mount-point-1 - type opts\n2 2 3 /mount2 mount-point-2 - type opts'
      );

      const result = checkDeletedBindMounts(['/workspace']);

      expect(result.ok).toBe(true);
      expect(result.name).toBe('bind-mounts');
    });

    it('should fail when deleted bind mounts are detected', () => {
      mockFs.readFileSync.mockReturnValue(
        '1 2 3 /path/to/deleted\\040(deleted) /workspace - type opts'
      );

      const result = checkDeletedBindMounts(['/workspace']);

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('deleted');
    });

    it('should handle empty paths array', () => {
      mockFs.readFileSync.mockReturnValue('1 2 3 /path /mount - type opts');

      const result = checkDeletedBindMounts([]);

      expect(result.ok).toBe(true);
    });

    it('should handle missing mountinfo file', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = checkDeletedBindMounts(['/workspace']);

      expect(result.ok).toBe(true);
    });
  });

  describe('checkWritableDirectory', () => {
    it('should pass for writable directory', () => {
      mockFs.mkdirSync.mockImplementation(() => '/tmp/test');
      mockFs.accessSync.mockImplementation(() => undefined);

      const result = checkWritableDirectory(
        'test-dir',
        '/tmp/test',
        'Test remediation'
      );

      expect(result.ok).toBe(true);
      expect(result.name).toBe('test-dir');
      expect(result.detail).toContain('readable and writable');
    });

    it('should fail for non-writable directory', () => {
      mockFs.mkdirSync.mockImplementation(() => '/tmp/test');
      mockFs.accessSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = checkWritableDirectory(
        'test-dir',
        '/tmp/test',
        'Test remediation'
      );

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('not readable and writable');
      expect(result.remediation).toBe('Test remediation');
    });

    it('should fail if directory creation fails', () => {
      mockFs.mkdirSync.mockImplementation(() => {
        throw new Error('Cannot create directory');
      });

      const result = checkWritableDirectory(
        'test-dir',
        '/tmp/test',
        'Test remediation'
      );

      expect(result.ok).toBe(false);
    });
  });

  describe('checkLLMGatewayKey', () => {
    it('should pass when gateway provider is disabled', () => {
      process.env.KASEKI_PROVIDER = 'openrouter';

      const result = checkLLMGatewayKey();

      expect(result.ok).toBe(true);
      expect(result.detail).toContain('not required');
    });

    it('should pass when gateway URL and key are configured', () => {
      process.env.KASEKI_PROVIDER = 'gateway';
      mockReadHostSecret.mockReturnValue('test-key');
      mockIsResponsesEndpoint.mockReturnValue(true);

      const result = checkLLMGatewayKey();

      expect(result.ok).toBe(true);
    });

    it('should fail when gateway URL is missing', () => {
      process.env.KASEKI_PROVIDER = 'gateway';
      process.env.LLM_GATEWAY_URL = '';
      mockReadHostSecret.mockReturnValue('test-key');
      mockGetSecretLocations.mockReturnValue({
        primary: '/run/secrets/kaseki/llm_gateway_api_key',
        secondary: '~/.kaseki/secrets.json',
      });

      const result = checkLLMGatewayKey();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('missing');
    });

    it('should fail when gateway key is missing', () => {
      process.env.KASEKI_PROVIDER = 'gateway';
      mockReadHostSecret.mockReturnValue(undefined);
      mockGetSecretLocations.mockReturnValue({
        primary: '/run/secrets/kaseki/llm_gateway_api_key',
        secondary: '~/.kaseki/secrets.json',
      });

      const result = checkLLMGatewayKey();

      expect(result.ok).toBe(false);
    });
  });

  describe('checkGatewayTestSecretConsistency', () => {
    it('should pass when both preflight and gateway test can resolve key', () => {
      process.env.KASEKI_PROVIDER = 'gateway';
      mockReadHostSecret.mockReturnValue('test-key');
      mockResolveGatewayKey.mockReturnValue({
        configured: true,
        source: 'env-var',
      });

      const result = checkGatewayTestSecretConsistency();

      expect(result.ok).toBe(true);
      expect(result.name).toBe('gateway-api-secret-consistency');
    });

    it('should pass when gateway provider is disabled', () => {
      process.env.KASEKI_PROVIDER = 'openrouter';

      const result = checkGatewayTestSecretConsistency();

      expect(result.ok).toBe(true);
    });

    it('should fail when neither can resolve key', () => {
      process.env.KASEKI_PROVIDER = 'gateway';
      mockReadHostSecret.mockReturnValue(undefined);
      mockResolveGatewayKey.mockReturnValue({ configured: false });

      const result = checkGatewayTestSecretConsistency();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('Neither');
    });

    it('should fail when only one can resolve key', () => {
      process.env.KASEKI_PROVIDER = 'gateway';
      mockReadHostSecret.mockReturnValue('test-key');
      mockResolveGatewayKey.mockReturnValue({ configured: false });

      const result = checkGatewayTestSecretConsistency();

      expect(result.ok).toBe(false);
    });
  });

  describe('checkWorkerGatewayConfig', () => {
    it('should pass when gateway provider is disabled', () => {
      process.env.KASEKI_PROVIDER = 'openrouter';

      const result = checkWorkerGatewayConfig();

      expect(result.ok).toBe(true);
      expect(result.name).toBe('worker-gateway-secret-mount');
    });

    it('should pass when all gateway config is present', () => {
      process.env.KASEKI_PROVIDER = 'gateway';
      mockResolveGatewayKey.mockReturnValue({
        configured: true,
        source: 'env-var',
      });
      mockFs.accessSync.mockImplementation(() => undefined);

      const result = checkWorkerGatewayConfig();

      expect(result.ok).toBe(true);
    });

    it('should fail when gateway URL is missing', () => {
      process.env.KASEKI_PROVIDER = 'gateway';
      process.env.LLM_GATEWAY_URL = '';

      const result = checkWorkerGatewayConfig();

      expect(result.ok).toBe(false);
    });
  });

  describe('checkGitHubAppCredentials', () => {
    it('should pass when all GitHub App credentials are present and valid', () => {
      mockReadHostSecret
        .mockReturnValueOnce('123456') // app_id
        .mockReturnValueOnce('client-id') // client_id
        .mockReturnValueOnce('-----BEGIN RSA PRIVATE KEY-----'); // private_key

      mockValidateGitHubKey.mockReturnValue({ ok: true });

      const result = checkGitHubAppCredentials();

      expect(result.ok).toBe(true);
      expect(result.name).toBe('github-app');
    });

    it('should fail when no GitHub App credentials are configured', () => {
      mockReadHostSecret.mockReturnValue(undefined);
      mockGetSecretLocations.mockReturnValue({
        primary: '/run/secrets/kaseki/github_app_id',
        secondary: '~/.kaseki/secrets.json',
      });

      const result = checkGitHubAppCredentials();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('not configured');
    });

    it('should fail when some credentials are missing', () => {
      mockReadHostSecret
        .mockReturnValueOnce('123456') // app_id
        .mockReturnValueOnce(undefined) // client_id
        .mockReturnValueOnce('-----BEGIN RSA PRIVATE KEY-----'); // private_key

      const result = checkGitHubAppCredentials();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('incomplete');
    });

    it('should fail when app_id is not numeric', () => {
      mockReadHostSecret
        .mockReturnValueOnce('not-a-number')
        .mockReturnValueOnce('client-id')
        .mockReturnValueOnce('-----BEGIN RSA PRIVATE KEY-----');

      const result = checkGitHubAppCredentials();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('not numeric');
    });

    it('should fail when private key is invalid', () => {
      mockReadHostSecret
        .mockReturnValueOnce('123456')
        .mockReturnValueOnce('client-id')
        .mockReturnValueOnce('invalid-key');

      mockValidateGitHubKey.mockReturnValue({
        ok: false,
        error: 'Invalid key format',
        remediation: 'Use a valid RSA private key',
      });

      const result = checkGitHubAppCredentials();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('Invalid key format');
    });
  });

  describe('checkWorkerSmokeTest', () => {
    it('should pass when worker container smoke test succeeds', () => {
      const mockConfig = {
        resultsDir: '/agents/kaseki-results',
      };

      mockFs.mkdirSync.mockImplementation(() => '/smoke/workspace');
      mockFs.rmSync.mockImplementation(() => undefined);
      mockExecDocker.mockReturnValue({
        ok: true,
        stdout: '',
        stderr: '',
      });

      const result = checkWorkerSmokeTest(mockConfig as any, 'kaseki-agent:latest');

      expect(result.ok).toBe(true);
      expect(result.name).toBe('worker-smoke');
    });

    it('should fail when worker container startup fails', () => {
      const mockConfig = {
        resultsDir: '/agents/kaseki-results',
      };

      mockFs.mkdirSync.mockImplementation(() => '/smoke/workspace');
      mockFs.rmSync.mockImplementation(() => undefined);
      mockExecDocker.mockReturnValue({
        ok: false,
        stdout: '',
        stderr: 'Worker startup failed',
        detail: 'Container failed to start',
      });

      const result = checkWorkerSmokeTest(mockConfig as any, 'kaseki-agent:latest');

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('failed');
    });

    it('should cleanup temp directories on failure', () => {
      const mockConfig = {
        resultsDir: '/agents/kaseki-results',
      };

      mockFs.mkdirSync.mockImplementation(() => '/smoke/workspace');
      mockFs.rmSync.mockImplementation(() => undefined);
      mockExecDocker.mockReturnValue({
        ok: false,
        stdout: '',
        stderr: 'Worker startup failed',
      });

      checkWorkerSmokeTest(mockConfig as any, 'kaseki-agent:latest');

      expect(mockFs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('.preflight-worker'),
        { recursive: true, force: true }
      );
    });
  });

  describe('buildTemplateHealthStatus', () => {
    it('should return ok status when template is healthy', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'Doctor OK',
        stderr: '',
        signal: null,
        pid: 1234,
      } as any);

      const result = buildTemplateHealthStatus();

      expect(result.ok).toBe(true);
      expect(result.detail).toContain('passed doctor check');
    });

    it('should fail when run script is missing', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = buildTemplateHealthStatus();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('Missing template runner');
    });

    it('should fail when required template files are missing', () => {
      mockFs.existsSync
        .mockReturnValueOnce(true) // run script exists
        .mockReturnValueOnce(true) // .git exists
        .mockReturnValueOnce(false); // required file missing

      const result = buildTemplateHealthStatus();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('incomplete');
    });

    it('should fail when doctor check fails', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'Doctor failed',
        signal: null,
        pid: 1234,
      } as any);

      const result = buildTemplateHealthStatus();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('doctor failed');
    });

    it('should handle doctor timeout', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockSpawnSync.mockReturnValue({
        status: null,
        stdout: '',
        stderr: '',
        signal: 'SIGTERM',
        pid: 1234,
      } as any);

      const result = buildTemplateHealthStatus();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('timed out');
    });
  });

  describe('resolveCheckoutFreshness', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      process.env.KASEKI_REF = 'main';
    });

    it('should skip when not a git repo', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = resolveCheckoutFreshness();

      expect(result.ok).toBe(true);
      expect(result.stale).toBe(false);
      expect(result.detail).toContain('skipped');
    });
  });

  describe('checkTemplateActivatorParity', () => {
    it('should pass when activators match', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('#!/bin/bash\n');

      const result = checkTemplateActivatorParity(
        '/agents/kaseki-template',
        '/agents/kaseki-agent'
      );

      expect(result.ok).toBe(true);
      expect(result.name).toBe('template-activator-parity');
    });

    it('should fail when activators differ', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync
        .mockReturnValueOnce('#!/bin/bash\necho "template"')
        .mockReturnValueOnce('#!/bin/bash\necho "checkout"');

      const result = checkTemplateActivatorParity(
        '/agents/kaseki-template',
        '/agents/kaseki-agent'
      );

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('differs');
    });

    it('should fail when activators are not readable', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = checkTemplateActivatorParity(
        '/agents/kaseki-template',
        '/agents/kaseki-agent'
      );

      expect(result.ok).toBe(false);
    });
  });

  describe('getSubmissionTemplateHealthStatus', () => {
    it('should cache successful template health status', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'Doctor OK',
        stderr: '',
        signal: null,
        pid: 1234,
      } as any);

      const result1 = getSubmissionTemplateHealthStatus();
      expect(result1.fromCache).toBe(false);
      expect(result1.status.ok).toBe(true);

      // Verify cache by calling again
      const result2 = getSubmissionTemplateHealthStatus();
      expect(result2.fromCache).toBe(true);
      expect(result2.status.ok).toBe(result1.status.ok);
    });
  });

  describe('checkTemplatePublishModeCompatibility', () => {
    it('should pass when metadata is not present (legacy templates)', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = checkTemplatePublishModeCompatibility('pr');

      expect(result.ok).toBe(true);
    });

    it('should pass when publish mode is supported', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          gitRef: 'abc123',
          supportedPublishModes: ['pr', 'branch'],
        })
      );

      const result = checkTemplatePublishModeCompatibility('pr');

      expect(result.ok).toBe(true);
    });

    it('should fail when publish mode is not supported', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          gitRef: 'abc123',
          supportedPublishModes: ['pr'],
        })
      );

      const result = checkTemplatePublishModeCompatibility('branch');

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('does not support');
    });

    it('should handle invalid metadata format', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      expect(() => {
        checkTemplatePublishModeCompatibility('pr');
      }).toThrow();
    });
  });

  describe('shouldBlockForFreshness', () => {
    it('should block for PR publish mode', () => {
      expect(shouldBlockForFreshness('pr')).toBe(true);
    });

    it('should block for draft_pr publish mode', () => {
      expect(shouldBlockForFreshness('draft_pr')).toBe(true);
    });

    it('should block for branch publish mode', () => {
      expect(shouldBlockForFreshness('branch')).toBe(true);
    });

    it('should not block for non-publish modes', () => {
      expect(shouldBlockForFreshness('scouting')).toBe(false);
      expect(shouldBlockForFreshness('local')).toBe(false);
    });

    it('should not block when KASEKI_ENFORCE_FRESHNESS is disabled', () => {
      process.env.KASEKI_ENFORCE_FRESHNESS = '0';
      expect(shouldBlockForFreshness('pr')).toBe(false);
    });
  });

  describe('isTemplateDoctorTimeout', () => {
    it('should return true for timeout status', () => {
      const status = {
        ok: false,
        templateDir: '/template',
        runScript: '/template/run-kaseki.sh',
        checkoutDir: '/checkout',
        doctorCommand: 'doctor',
        detail: 'Template doctor timed out after 15000ms',
        doctorStderrTail: '',
        doctorStdoutTail: '',
      };

      expect(isTemplateDoctorTimeout(status)).toBe(true);
    });

    it('should return false for non-timeout status', () => {
      const status = {
        ok: false,
        templateDir: '/template',
        runScript: '/template/run-kaseki.sh',
        checkoutDir: '/checkout',
        doctorCommand: 'doctor',
        detail: 'Template files missing',
        doctorStderrTail: '',
        doctorStdoutTail: '',
      };

      expect(isTemplateDoctorTimeout(status)).toBe(false);
    });

    it('should detect ETIMEDOUT in stderr', () => {
      const status = {
        ok: false,
        templateDir: '/template',
        runScript: '/template/run-kaseki.sh',
        checkoutDir: '/checkout',
        doctorCommand: 'doctor',
        detail: 'Doctor check failed',
        doctorStderrTail: 'Error: ETIMEDOUT',
        doctorStdoutTail: '',
      };

      expect(isTemplateDoctorTimeout(status)).toBe(true);
    });

    it('should detect SIGTERM signal', () => {
      const status = {
        ok: false,
        templateDir: '/template',
        runScript: '/template/run-kaseki.sh',
        checkoutDir: '/checkout',
        doctorCommand: 'doctor',
        doctorSignal: 'SIGTERM' as NodeJS.Signals,
        detail: 'Doctor check failed',
        doctorStderrTail: '',
        doctorStdoutTail: '',
      };

      expect(isTemplateDoctorTimeout(status)).toBe(true);
    });
  });

  describe('exported constants', () => {
    it('should export TEMPLATE_REMEDIATION constant', () => {
      expect(TEMPLATE_REMEDIATION).toBeTruthy();
      expect(typeof TEMPLATE_REMEDIATION).toBe('string');
      expect(TEMPLATE_REMEDIATION).toContain('kaseki-activate.sh');
    });
  });
});
