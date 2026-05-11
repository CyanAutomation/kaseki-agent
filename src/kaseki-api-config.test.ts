import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, validateApiKey } from './kaseki-api-config';

// Mock the host-secrets-reader module
jest.mock('./secrets/host-secrets-reader', () => ({
  readHostSecret: jest.fn(),
  getSecretLocations: jest.fn((name) => ({
    primary: `/agents/secrets/${name}`,
    secondary: `/home/user/secrets/${name}`,
  })),
  clearSecretCache: jest.fn(),
}));

describe('kaseki-api-config load configuration', () => {
  const originalEnv = process.env;
  let testDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    testDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-config-test-'));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('loadConfig loads API keys from host secrets', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('key1\nkey2\nkey3');

    process.env.KASEKI_API_PORT = '3000';
    process.env.KASEKI_API_MAX_CONCURRENT_RUNS = '5';
    process.env.KASEKI_AGENT_TIMEOUT_SECONDS = '600';
    process.env.KASEKI_MAX_DIFF_BYTES = '500000';
    process.env.KASEKI_TASK_MODE = 'inspect';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_LOG_LEVEL = 'debug';
    process.env.KASEKI_API_JOB_INDEX_MAX_ENTRIES = '250';
    process.env.KASEKI_ARTIFACT_CACHE_MAX_ENTRIES = '7';
    process.env.KASEKI_ARTIFACT_CACHE_TTL_MS = '12345';
    process.env.KASEKI_ARTIFACT_CACHE_MAX_FILE_BYTES = '4096';

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
    expect(config.port).toBe(3000);
    expect(config.maxConcurrentRuns).toBe(5);
    expect(config.agentTimeoutSeconds).toBe(600);
    expect(config.maxDiffBytes).toBe(500000);
    expect(config.defaultTaskMode).toBe('inspect');
    expect(config.resultsDir).toBe(testDir);
    expect(config.logLevel).toBe('debug');
    expect(config.jobIndexMaxEntries).toBe(250);
    expect(config.artifactCacheMaxEntries).toBe(7);
    expect(config.artifactCacheTtlMs).toBe(12345);
    expect(config.artifactCacheMaxFileBytes).toBe(4096);
  });

  test('loadConfig uses default values when env vars are not set', () => {
    process.env.KASEKI_API_KEYS = 'default-key';
    process.env.KASEKI_RESULTS_DIR = testDir;
    delete process.env.KASEKI_API_PORT;
    delete process.env.KASEKI_API_MAX_CONCURRENT_RUNS;
    delete process.env.KASEKI_AGENT_TIMEOUT_SECONDS;
    delete process.env.KASEKI_MAX_DIFF_BYTES;
    delete process.env.KASEKI_TASK_MODE;
    delete process.env.KASEKI_API_LOG_LEVEL;
    delete process.env.KASEKI_API_JOB_INDEX_MAX_ENTRIES;
    delete process.env.KASEKI_ARTIFACT_CACHE_MAX_ENTRIES;
    delete process.env.KASEKI_ARTIFACT_CACHE_TTL_MS;
    delete process.env.KASEKI_ARTIFACT_CACHE_MAX_FILE_BYTES;

    const config = loadConfig();

    expect(config.port).toBe(8080); // default
    expect(config.maxConcurrentRuns).toBe(3); // default
    expect(config.agentTimeoutSeconds).toBe(5700); // default
    expect(config.maxDiffBytes).toBe(200000); // default
    expect(config.defaultTaskMode).toBe('patch'); // default
    expect(config.logLevel).toBe('info'); // default
    expect(config.jobIndexMaxEntries).toBe(1000); // default
    expect(config.artifactCacheMaxEntries).toBe(20); // default
    expect(config.artifactCacheTtlMs).toBe(5 * 60 * 1000); // default
    expect(config.artifactCacheMaxFileBytes).toBe(10 * 1024 * 1024); // default
  });

  test('loadConfig throws when KASEKI_API_KEYS is not set', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue(null);

    process.env.KASEKI_RESULTS_DIR = testDir;

    expect(() => loadConfig()).toThrow('KASEKI_API_KEYS is required');
  });

  test('loadConfig throws when KASEKI_API_PORT is invalid', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_PORT = 'not-a-port';

    expect(() => loadConfig()).toThrow('KASEKI_API_PORT must be a valid port number');
  });

  test('loadConfig throws when KASEKI_API_PORT is out of range', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_PORT = '99999';

    expect(() => loadConfig()).toThrow('KASEKI_API_PORT must be a valid port number');
  });

  test('loadConfig throws when KASEKI_API_MAX_CONCURRENT_RUNS is invalid', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_MAX_CONCURRENT_RUNS = '-1';

    expect(() => loadConfig()).toThrow('KASEKI_API_MAX_CONCURRENT_RUNS must be >= 1');
  });

  test('loadConfig throws when KASEKI_AGENT_TIMEOUT_SECONDS is invalid', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_AGENT_TIMEOUT_SECONDS = 'not-a-number';

    expect(() => loadConfig()).toThrow('KASEKI_AGENT_TIMEOUT_SECONDS must be >= 1');
  });

  test('loadConfig throws when KASEKI_MAX_DIFF_BYTES is invalid', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_MAX_DIFF_BYTES = '0';

    expect(() => loadConfig()).toThrow('KASEKI_MAX_DIFF_BYTES must be >= 1');
  });

  test('loadConfig throws when KASEKI_API_JOB_INDEX_MAX_ENTRIES is invalid', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_JOB_INDEX_MAX_ENTRIES = '-1';

    expect(() => loadConfig()).toThrow('KASEKI_API_JOB_INDEX_MAX_ENTRIES must be >= 0');
  });

  test('loadConfig throws when artifact cache configuration is invalid', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_ARTIFACT_CACHE_MAX_ENTRIES = '-1';
    expect(() => loadConfig()).toThrow('KASEKI_ARTIFACT_CACHE_MAX_ENTRIES must be >= 0');

    process.env.KASEKI_ARTIFACT_CACHE_MAX_ENTRIES = '1';
    process.env.KASEKI_ARTIFACT_CACHE_TTL_MS = '-1';
    expect(() => loadConfig()).toThrow('KASEKI_ARTIFACT_CACHE_TTL_MS must be >= 0');

    process.env.KASEKI_ARTIFACT_CACHE_TTL_MS = '1';
    process.env.KASEKI_ARTIFACT_CACHE_MAX_FILE_BYTES = '-1';
    expect(() => loadConfig()).toThrow('KASEKI_ARTIFACT_CACHE_MAX_FILE_BYTES must be >= 0');
  });

  test('loadConfig throws when KASEKI_TASK_MODE is invalid', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_TASK_MODE = 'invalid-mode';

    expect(() => loadConfig()).toThrow("KASEKI_TASK_MODE must be 'patch' or 'inspect'");
  });

  test('loadConfig auto-creates KASEKI_RESULTS_DIR if it does not exist', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    const newDir = path.join(testDir, 'new', 'nested', 'dir');
    process.env.KASEKI_RESULTS_DIR = newDir;

    const config = loadConfig();

    expect(config.resultsDir).toBe(newDir);
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.statSync(newDir).isDirectory()).toBe(true);
  });

  test('loadConfig throws when KASEKI_API_LOG_LEVEL is invalid', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('test-key');

    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_LOG_LEVEL = 'verbose';

    expect(() => loadConfig()).toThrow('KASEKI_API_LOG_LEVEL must be debug/info/warn/error');
  });
});

describe('kaseki-api-config API key parsing from host secrets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loadConfig parses newline-separated API keys from host secrets', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('key1\nkey2\nkey3');

    process.env.KASEKI_RESULTS_DIR = '/tmp';

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
  });

  test('loadConfig skips comments and empty lines in API keys', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('# Comment\nkey1\n\n# Another\nkey2\n');

    process.env.KASEKI_RESULTS_DIR = '/tmp';

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['key1', 'key2']);
  });

  test('loadConfig strips whitespace from API keys', () => {
    const { readHostSecret } = jest.requireActual('./secrets/host-secrets-reader') as typeof import('./secrets/host-secrets-reader');
    (readHostSecret as jest.Mock).mockReturnValue('  key1  \n  key2  \n  key3  ');

    process.env.KASEKI_RESULTS_DIR = '/tmp';

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
  });
});

describe('kaseki-api-config validate API key', () => {
  const config = {
    port: 8080,
    apiKeys: ['valid-key-1', 'valid-key-2'],
    resultsDir: '/tmp',
    maxConcurrentRuns: 3,
    defaultTaskMode: 'patch' as const,
    maxDiffBytes: 200000,
    agentTimeoutSeconds: 1200,
    logLevel: 'info' as const,
  };

  test('validateApiKey returns true for valid API key', () => {
    expect(validateApiKey(config, 'valid-key-1')).toBe(true);
    expect(validateApiKey(config, 'valid-key-2')).toBe(true);
  });

  test('validateApiKey returns false for invalid API key', () => {
    expect(validateApiKey(config, 'invalid-key')).toBe(false);
    expect(validateApiKey(config, '')).toBe(false);
  });

  test('validateApiKey is case-sensitive', () => {
    expect(validateApiKey(config, 'VALID-KEY-1')).toBe(false);
    expect(validateApiKey(config, 'Valid-Key-1')).toBe(false);
  });
});
