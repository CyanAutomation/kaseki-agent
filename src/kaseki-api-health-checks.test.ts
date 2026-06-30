/**
 * src/kaseki-api-health-checks.test.ts
 *
 * Robust behavioral coverage for public health-check functions.
 */

import fs = require('fs');
import { spawnSync } from 'node:child_process';
import * as subprocessHelpers from './lib/subprocess-helpers';
import * as hostSecretsReader from './secrets/host-secrets-reader';
import * as githubAppPrivateKey from './github-app-private-key';
import * as gatewaySmoke from './kaseki-api-gateway-smoke';
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
  TemplateHealthStatus,
} from './kaseki-api-health-checks';

jest.mock('node:child_process', () => ({
  spawnSync: jest.fn(),
}));

jest.mock('./utils/file-helpers', () => ({
  commandOutput: jest.fn().mockReturnValue(''),
  readFirstLine: jest.fn().mockReturnValue(''),
}));

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

type FsSpyName = 'readFileSync' | 'mkdirSync' | 'accessSync' | 'existsSync' | 'rmSync';
type FsSpies = Partial<Record<FsSpyName, jest.SpyInstance>>;

type SecretMap = Partial<Record<string, string | undefined>>;

const defaultEnv = {
  KASEKI_PROVIDER: 'gateway',
  LLM_GATEWAY_URL: 'https://gateway.example/v1',
  KASEKI_TEMPLATE_DIR: '/agents/kaseki-template',
  KASEKI_CHECKOUT_DIR: '/agents/kaseki-agent',
};

const savedEnv = { ...process.env };
let fsSpies: FsSpies = {};
let execDockerSpy: jest.SpyInstance;
let readHostSecretSpy: jest.SpyInstance;
let getSecretLocationsSpy: jest.SpyInstance;
let validateGitHubKeySpy: jest.SpyInstance;
let resolveGatewayKeySpy: jest.SpyInstance;
let isResponsesEndpointSpy: jest.SpyInstance;

function setEnv(overrides: NodeJS.ProcessEnv = {}) {
  process.env = { ...savedEnv, ...defaultEnv, ...overrides };
}

function spyFs<T extends FsSpyName>(name: T) {
  if (!fsSpies[name]) {
    fsSpies[name] = jest.spyOn(fs, name as never) as jest.SpyInstance;
  }
  return fsSpies[name]!;
}

function mockSecretReader(secrets: SecretMap) {
  readHostSecretSpy.mockImplementation((name: string) => secrets[name]);
}

function mockSecretLocations() {
  getSecretLocationsSpy.mockImplementation((name: string) => ({
    primary: `/run/secrets/kaseki/${name}`,
    secondary: '~/.kaseki/secrets.json',
  }));
}

function healthyTemplateFs() {
  spyFs('existsSync').mockReturnValue(true);
  mockSpawnSync.mockReturnValue({
    status: 0,
    stdout: 'Doctor OK',
    stderr: '',
    signal: null,
    pid: 1234,
  } as any);
}

function templateStatus(overrides: Partial<TemplateHealthStatus>): TemplateHealthStatus {
  return {
    ok: false,
    templateDir: '/template',
    runScript: '/template/run-kaseki.sh',
    checkoutDir: '/checkout',
    doctorCommand: 'doctor',
    detail: 'Doctor check failed',
    doctorStderrTail: '',
    doctorStdoutTail: '',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setEnv();
  fsSpies = {};
  execDockerSpy = jest.spyOn(subprocessHelpers, 'execDockerCommand').mockReturnValue({ ok: true, stdout: '', stderr: '' });
  readHostSecretSpy = jest.spyOn(hostSecretsReader, 'readHostSecret').mockReturnValue(undefined);
  getSecretLocationsSpy = jest.spyOn(hostSecretsReader, 'getSecretLocations');
  jest.spyOn(hostSecretsReader, 'resolveHostSecretPath').mockReturnValue('/run/secrets/kaseki/llm_gateway_api_key');
  validateGitHubKeySpy = jest.spyOn(githubAppPrivateKey, 'validateGitHubAppPrivateKey').mockReturnValue({ ok: true });
  resolveGatewayKeySpy = jest.spyOn(gatewaySmoke, 'resolveGatewayApiKey').mockReturnValue({ configured: true, source: 'env-var' });
  isResponsesEndpointSpy = jest.spyOn(gatewaySmoke, 'isResponsesEndpoint').mockReturnValue(true);
  mockSecretLocations();
});

afterEach(() => {
  process.env = { ...savedEnv };
  jest.restoreAllMocks();
  mockSpawnSync.mockReset();
});

describe('checkDeletedBindMounts', () => {
  it('reports no deleted mounts for target paths', () => {
    spyFs('readFileSync').mockReturnValue('1 2 3 /mount1 /workspace - type opts');

    const result = checkDeletedBindMounts(['/workspace']);

    expect(result).toMatchObject({ name: 'bind-mounts', detail: 'No deleted bind mounts detected for Kaseki paths.' });
  });

  it('reports deleted backing source details and remediation', () => {
    spyFs('readFileSync').mockReturnValue('1 2 3 /path/deleted\\040(deleted) /workspace - type opts');

    const result = checkDeletedBindMounts(['/workspace/project']);

    expect(result.detail).toContain('/workspace is backed by deleted source');
    expect(result.remediation).toContain('kaseki-agent host setup --fix');
  });

  it('treats unreadable mountinfo as no matching deleted mounts', () => {
    spyFs('readFileSync').mockImplementation(() => { throw new Error('File not found'); });

    expect(checkDeletedBindMounts(['/workspace']).detail).toBe('No deleted bind mounts detected for Kaseki paths.');
  });
});

describe('checkWritableDirectory', () => {
  it('describes a readable and writable directory', () => {
    spyFs('mkdirSync').mockImplementation(() => '/tmp/test' as any);
    spyFs('accessSync').mockImplementation(() => undefined);

    const result = checkWritableDirectory('test-dir', '/tmp/test', 'Test remediation');

    expect(result).toMatchObject({ name: 'test-dir', detail: '/tmp/test is readable and writable.' });
  });

  it('returns access failure detail and caller remediation', () => {
    spyFs('mkdirSync').mockImplementation(() => '/tmp/test' as any);
    spyFs('accessSync').mockImplementation(() => { throw new Error('Permission denied'); });

    const result = checkWritableDirectory('test-dir', '/tmp/test', 'Test remediation');

    expect(result.detail).toContain('/tmp/test is not readable and writable: Permission denied');
    expect(result.remediation).toBe('Test remediation');
  });
});

describe('checkLLMGatewayKey', () => {
  it('skips gateway connectivity when gateway provider is disabled', () => {
    setEnv({ KASEKI_PROVIDER: 'openrouter' });

    expect(checkLLMGatewayKey().detail).toContain('not required for KASEKI_PROVIDER=openrouter');
  });

  it('confirms configured gateway URL and key prerequisites', () => {
    mockSecretReader({ llm_gateway_api_key: 'test-key' });

    expect(checkLLMGatewayKey().detail).toBe('Gateway URL/key connectivity prerequisites are configured for the API container.');
  });

  it('lists missing URL and secret sources', () => {
    setEnv({ LLM_GATEWAY_URL: '' });

    const result = checkLLMGatewayKey();

    expect(result.detail).toContain('LLM_GATEWAY_URL');
    expect(result.detail).toContain('LLM_GATEWAY_API_KEY or LLM_GATEWAY_API_KEY_FILE');
    expect(result.remediation).toContain('/run/secrets/kaseki/llm_gateway_api_key');
  });
});

describe('checkGatewayTestSecretConsistency', () => {
  it('reports both preflight and gateway test can resolve the key', () => {
    mockSecretReader({ llm_gateway_api_key: 'test-key' });

    expect(checkGatewayTestSecretConsistency().detail).toContain('can both resolve');
  });

  it('skips consistency check when gateway provider is disabled', () => {
    setEnv({ KASEKI_PROVIDER: 'openrouter' });

    expect(checkGatewayTestSecretConsistency().detail).toContain('not required for KASEKI_PROVIDER=openrouter');
  });

  it('reports neither boundary can resolve the key', () => {
    resolveGatewayKeySpy.mockReturnValue({ configured: false });

    const result = checkGatewayTestSecretConsistency();

    expect(result.detail).toBe('Neither preflight nor Gateway Test can resolve the LLM Gateway API key.');
    expect(result.remediation).toContain('Set LLM_GATEWAY_API_KEY');
  });

  it('reports disagreement between preflight and gateway test visibility', () => {
    mockSecretReader({ llm_gateway_api_key: 'test-key' });
    resolveGatewayKeySpy.mockReturnValue({ configured: false });

    expect(checkGatewayTestSecretConsistency().detail).toContain('preflight=configured, gatewayTest=undefined');
  });
});

describe('checkWorkerGatewayConfig', () => {
  it('skips worker gateway mount check when gateway provider is disabled', () => {
    setEnv({ KASEKI_PROVIDER: 'openrouter' });

    expect(checkWorkerGatewayConfig().detail).toContain('not required for KASEKI_PROVIDER=openrouter');
  });

  it('confirms URL and readable host secret path for workers', () => {
    spyFs('accessSync').mockImplementation(() => undefined);

    expect(checkWorkerGatewayConfig().detail).toContain('readable llm_gateway_api_key host mount source');
  });

  it('details missing gateway URL for worker configuration', () => {
    setEnv({ LLM_GATEWAY_URL: '' });
    spyFs('accessSync').mockImplementation(() => undefined);

    expect(checkWorkerGatewayConfig().detail).toContain('LLM_GATEWAY_URL in the API environment');
  });
});

describe('checkGitHubAppCredentials', () => {
  it('confirms readable and structurally valid GitHub App credentials', () => {
    mockSecretReader({ github_app_id: '123456', github_app_client_id: 'client-id', github_app_private_key: '-----BEGIN RSA PRIVATE KEY-----' });

    expect(checkGitHubAppCredentials().detail).toBe('GitHub App credentials are readable and structurally valid for PR creation.');
  });

  it('reports that no GitHub App credentials are configured', () => {
    const result = checkGitHubAppCredentials();

    expect(result.detail).toContain('not configured');
    expect(result.remediation).toContain('github_app_private_key');
  });

  it('reports missing credential names when partially configured', () => {
    mockSecretReader({ github_app_id: '123456', github_app_private_key: 'key' });

    expect(checkGitHubAppCredentials().detail).toContain('missing github_app_client_id');
  });

  it('reports non-numeric app id', () => {
    mockSecretReader({ github_app_id: 'not-a-number', github_app_client_id: 'client-id', github_app_private_key: 'key' });

    expect(checkGitHubAppCredentials().detail).toBe('GitHub App ID is present but is not numeric.');
  });

  it('surfaces private key validation detail and remediation', () => {
    mockSecretReader({ github_app_id: '123456', github_app_client_id: 'client-id', github_app_private_key: 'invalid-key' });
    validateGitHubKeySpy.mockReturnValue({ ok: false, error: 'Invalid key format', remediation: 'Use a valid RSA private key' });

    const result = checkGitHubAppCredentials();

    expect(result.detail).toBe('Invalid key format');
    expect(result.remediation).toBe('Use a valid RSA private key');
  });
});

describe('checkWorkerSmokeTest', () => {
  const config = { resultsDir: '/agents/kaseki-results' } as any;

  it('confirms worker container startup prerequisites', () => {
    spyFs('mkdirSync').mockImplementation(() => undefined as any);
    spyFs('rmSync').mockImplementation(() => undefined);

    expect(checkWorkerSmokeTest(config, 'kaseki-agent:latest').detail).toContain('Worker container can start');
  });

  it('uses classified failure detail and remediation from Docker helper', () => {
    spyFs('mkdirSync').mockImplementation(() => undefined as any);
    spyFs('rmSync').mockImplementation(() => undefined);
    execDockerSpy.mockReturnValue({ ok: false, stdout: '', stderr: 'failed', classification: { detail: 'Container failed to start', remediation: 'Check Docker daemon' } });

    const result = checkWorkerSmokeTest(config, 'kaseki-agent:latest');

    expect(result.detail).toBe('Container failed to start');
    expect(result.remediation).toBe('Check Docker daemon');
  });

  it('cleans up the generated smoke root', () => {
    const rmSpy = spyFs('rmSync').mockImplementation(() => undefined);
    spyFs('mkdirSync').mockImplementation(() => undefined as any);
    execDockerSpy.mockReturnValue({ ok: false, stdout: '', stderr: 'Worker startup failed' });

    checkWorkerSmokeTest(config, 'kaseki-agent:latest');

    expect(rmSpy).toHaveBeenCalledWith(expect.stringContaining('.preflight-worker'), { recursive: true, force: true });
  });
});

describe('buildTemplateHealthStatus', () => {
  it('returns doctor success detail and stdout tail', () => {
    healthyTemplateFs();

    const result = buildTemplateHealthStatus();

    expect(result.detail).toContain('passed doctor check');
    expect(result.doctorStdoutTail).toBe('Doctor OK');
  });

  it('reports missing run script remediation', () => {
    spyFs('existsSync').mockReturnValue(false);

    const result = buildTemplateHealthStatus();

    expect(result.detail).toContain('Missing template runner');
    expect(result.remediation).toBe(TEMPLATE_REMEDIATION);
  });

  it('reports incomplete required template files', () => {
    spyFs('existsSync').mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(buildTemplateHealthStatus().detail).toContain('Template is incomplete');
  });

  it('reports doctor failure exit status', () => {
    spyFs('existsSync').mockReturnValue(true);
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'Doctor failed', signal: null, pid: 1234 } as any);

    const result = buildTemplateHealthStatus();

    expect(result.detail).toContain('exited with 1');
    expect(result.doctorStderrTail).toBe('Doctor failed');
  });

  it('reports doctor timeout using configured timeout', () => {
    setEnv({ KASEKI_TEMPLATE_DOCTOR_TIMEOUT_MS: '1234' });
    spyFs('existsSync').mockReturnValue(true);
    mockSpawnSync.mockReturnValue({ status: null, stdout: '', stderr: '', signal: 'SIGTERM', pid: 1234 } as any);

    expect(buildTemplateHealthStatus().detail).toContain('timed out after 1234ms');
  });
});

describe('resolveCheckoutFreshness', () => {
  it('skips freshness when checkout directory is not a git repo', () => {
    spyFs('existsSync').mockReturnValue(false);
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'not a git repository' } as any);

    const result = resolveCheckoutFreshness();

    expect(result.stale).toBe(false);
    expect(result.detail).toContain('not a git checkout');
  });
});

describe('checkTemplateActivatorParity', () => {
  it('confirms matching activator checksums', () => {
    spyFs('readFileSync').mockReturnValue(Buffer.from('#!/bin/bash\n'));

    expect(checkTemplateActivatorParity('/agents/kaseki-template', '/agents/kaseki-agent').detail).toBe('Template activator matches checkout activator.');
  });

  it('reports differing activator checksums', () => {
    spyFs('readFileSync').mockReturnValueOnce(Buffer.from('template')).mockReturnValueOnce(Buffer.from('checkout'));

    expect(checkTemplateActivatorParity('/agents/kaseki-template', '/agents/kaseki-agent').detail).toContain('differs');
  });

  it('reports unreadable activator path', () => {
    spyFs('readFileSync').mockImplementation(() => { throw new Error('Permission denied'); });

    const result = checkTemplateActivatorParity('/agents/kaseki-template', '/agents/kaseki-agent');

    expect(result.detail).toContain('not readable');
    expect(result.remediation).toBe(TEMPLATE_REMEDIATION);
  });
});

describe('getSubmissionTemplateHealthStatus', () => {
  it('caches successful template health status within the configured TTL', () => {
    setEnv({ KASEKI_TEMPLATE_HEALTH_CACHE_TTL_MS: '60000', KASEKI_TEMPLATE_DIR: '/template-cache-test' });
    healthyTemplateFs();

    const result1 = getSubmissionTemplateHealthStatus('/template-cache-test');
    const result2 = getSubmissionTemplateHealthStatus('/template-cache-test');

    expect(result1.fromCache).toBe(false);
    expect(result2.fromCache).toBe(true);
    expect(result2.status.detail).toBe(result1.status.detail);
  });
});

describe('checkTemplatePublishModeCompatibility', () => {
  it('allows legacy templates without metadata', () => {
    spyFs('existsSync').mockReturnValue(false);

    expect(checkTemplatePublishModeCompatibility('pr').metadataPath).toBe('/agents/kaseki-template/.kaseki-template-version');
  });

  it('returns supported publish modes when mode is compatible', () => {
    spyFs('existsSync').mockReturnValue(true);
    spyFs('readFileSync').mockReturnValue(JSON.stringify({ gitRef: 'abc123', supportedPublishModes: ['pr', 'branch'] }));

    expect(checkTemplatePublishModeCompatibility('branch').supportedPublishModes).toEqual(['pr', 'branch']);
  });

  it('reports unsupported publish mode with redeploy remediation', () => {
    spyFs('existsSync').mockReturnValue(true);
    spyFs('readFileSync').mockReturnValue(JSON.stringify({ gitRef: 'abc123', supportedPublishModes: ['pr'] }));

    const result = checkTemplatePublishModeCompatibility('branch');

    expect(result.detail).toContain('does not support publish mode `branch`');
    expect(result.remediation).toBe('Redeploy kaseki-agent.');
  });

  it('throws for invalid metadata JSON', () => {
    spyFs('existsSync').mockReturnValue(true);
    spyFs('readFileSync').mockReturnValue('invalid json');

    expect(() => checkTemplatePublishModeCompatibility('pr')).toThrow();
  });
});

describe('shouldBlockForFreshness', () => {
  it.each(['pr', 'draft_pr', 'branch', 'auto'])('blocks publish mode %s', (mode) => {
    expect(shouldBlockForFreshness(mode)).toBe(true);
  });

  it.each(['scouting', 'local'])('does not block non-publish mode %s', (mode) => {
    expect(shouldBlockForFreshness(mode)).toBe(false);
  });

  it('honors KASEKI_ENFORCE_FRESHNESS=0', () => {
    setEnv({ KASEKI_ENFORCE_FRESHNESS: '0' });

    expect(shouldBlockForFreshness('pr')).toBe(false);
  });
});

describe('isTemplateDoctorTimeout', () => {
  it('detects timeout detail', () => {
    expect(isTemplateDoctorTimeout(templateStatus({ detail: 'Template doctor timed out after 15000ms' }))).toBe(true);
  });

  it('does not mark non-timeout failure as timeout', () => {
    expect(isTemplateDoctorTimeout(templateStatus({ detail: 'Template files missing' }))).toBe(false);
  });

  it('detects ETIMEDOUT stderr', () => {
    expect(isTemplateDoctorTimeout(templateStatus({ doctorStderrTail: 'Error: ETIMEDOUT' }))).toBe(true);
  });

  it('detects SIGTERM signal', () => {
    expect(isTemplateDoctorTimeout(templateStatus({ doctorSignal: 'SIGTERM' as NodeJS.Signals }))).toBe(true);
  });
});

describe('exported constants', () => {
  it('documents the template activation remediation command', () => {
    expect(TEMPLATE_REMEDIATION).toBe('Run scripts/kaseki-activate.sh --controller bootstrap.');
  });
});
