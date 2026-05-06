import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, validateApiKey } from './kaseki-api-config';
import { secretValueCache } from './secret-value-cache';

describe('kaseki-api-config load configuration', () => {
  const originalEnv = process.env;
  let testDir: string;

  beforeEach(() => {
    jest.resetModules();
    secretValueCache.clear();
    process.env = { ...originalEnv };
    testDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-config-test-'));
  });

  afterEach(() => {
    secretValueCache.clear();
    process.env = originalEnv;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('loadConfig loads valid configuration from environment variables', () => {
    process.env.KASEKI_API_KEYS = 'key1,key2,key3';
    process.env.KASEKI_API_PORT = '3000';
    process.env.KASEKI_API_MAX_CONCURRENT_RUNS = '5';
    process.env.KASEKI_AGENT_TIMEOUT_SECONDS = '600';
    process.env.KASEKI_MAX_DIFF_BYTES = '500000';
    process.env.KASEKI_TASK_MODE = 'inspect';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_LOG_LEVEL = 'debug';
    process.env.KASEKI_API_JOB_INDEX_MAX_ENTRIES = '250';

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

    const config = loadConfig();

    expect(config.port).toBe(8080); // default
    expect(config.maxConcurrentRuns).toBe(3); // default
    expect(config.agentTimeoutSeconds).toBe(1800); // default
    expect(config.maxDiffBytes).toBe(200000); // default
    expect(config.defaultTaskMode).toBe('patch'); // default
    expect(config.logLevel).toBe('info'); // default
    expect(config.jobIndexMaxEntries).toBe(1000); // default
  });

  test('loadConfig throws when KASEKI_API_KEYS is not set', () => {
    delete process.env.KASEKI_API_KEYS;
    delete process.env.KASEKI_API_KEYS_FILE;
    process.env.KASEKI_RESULTS_DIR = testDir;

    expect(() => loadConfig()).toThrow('KASEKI_API_KEYS environment variable is required');
  });

  test('loadConfig throws when KASEKI_API_PORT is invalid', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_PORT = 'not-a-port';

    expect(() => loadConfig()).toThrow('KASEKI_API_PORT must be a valid port number');
  });

  test('loadConfig throws when KASEKI_API_PORT is out of range', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_PORT = '99999';

    expect(() => loadConfig()).toThrow('KASEKI_API_PORT must be a valid port number');
  });

  test('loadConfig throws when KASEKI_API_MAX_CONCURRENT_RUNS is invalid', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_MAX_CONCURRENT_RUNS = '-1';

    expect(() => loadConfig()).toThrow('KASEKI_API_MAX_CONCURRENT_RUNS must be >= 1');
  });

  test('loadConfig throws when KASEKI_AGENT_TIMEOUT_SECONDS is invalid', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_AGENT_TIMEOUT_SECONDS = 'not-a-number';

    expect(() => loadConfig()).toThrow('KASEKI_AGENT_TIMEOUT_SECONDS must be >= 1');
  });

  test('loadConfig throws when KASEKI_MAX_DIFF_BYTES is invalid', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_MAX_DIFF_BYTES = '0';

    expect(() => loadConfig()).toThrow('KASEKI_MAX_DIFF_BYTES must be >= 1');
  });

  test('loadConfig throws when KASEKI_API_JOB_INDEX_MAX_ENTRIES is invalid', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_JOB_INDEX_MAX_ENTRIES = '-1';

    expect(() => loadConfig()).toThrow('KASEKI_API_JOB_INDEX_MAX_ENTRIES must be >= 0');
  });

  test('loadConfig throws when KASEKI_TASK_MODE is invalid', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_TASK_MODE = 'invalid-mode';

    expect(() => loadConfig()).toThrow("KASEKI_TASK_MODE must be 'patch' or 'inspect'");
  });

  test('loadConfig throws when KASEKI_RESULTS_DIR does not exist', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_RESULTS_DIR = '/nonexistent/path/to/dir';

    expect(() => loadConfig()).toThrow('KASEKI_RESULTS_DIR does not exist');
  });

  test('loadConfig throws when KASEKI_API_LOG_LEVEL is invalid', () => {
    process.env.KASEKI_API_KEYS = 'test-key';
    process.env.KASEKI_RESULTS_DIR = testDir;
    process.env.KASEKI_API_LOG_LEVEL = 'verbose';

    expect(() => loadConfig()).toThrow('KASEKI_API_LOG_LEVEL must be debug/info/warn/error');
  });

  test('loadConfig strips whitespace from API keys', () => {
    process.env.KASEKI_API_KEYS = '  key1  ,  key2  ,  key3  ';
    process.env.KASEKI_RESULTS_DIR = testDir;

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
  });
});

describe('kaseki-api-config load API keys from file', () => {
  const originalEnv = process.env;
  let testDir: string;

  beforeEach(() => {
    jest.resetModules();
    secretValueCache.clear();
    process.env = { ...originalEnv };
    testDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-config-keys-test-'));
  });

  afterEach(() => {
    secretValueCache.clear();
    process.env = originalEnv;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('loadConfig reads API keys from KASEKI_API_KEYS_FILE', () => {
    const keysFile = path.join(testDir, 'api-keys.txt');
    fs.writeFileSync(keysFile, 'file-key-1\nfile-key-2\nfile-key-3\n');

    process.env.KASEKI_API_KEYS_FILE = keysFile;
    process.env.KASEKI_RESULTS_DIR = testDir;

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['file-key-1', 'file-key-2', 'file-key-3']);
  });

  test('loadConfig prefers KASEKI_API_KEYS over KASEKI_API_KEYS_FILE', () => {
    const keysFile = path.join(testDir, 'api-keys.txt');
    fs.writeFileSync(keysFile, 'file-key-1\nfile-key-2\n');

    process.env.KASEKI_API_KEYS = 'env-key-1,env-key-2';
    process.env.KASEKI_API_KEYS_FILE = keysFile;
    process.env.KASEKI_RESULTS_DIR = testDir;

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['env-key-1', 'env-key-2']);
  });

  test('loadConfig reuses cached API key file contents when metadata is unchanged', () => {
    const keysFile = path.join(testDir, 'api-keys.txt');
    const fixedTime = new Date('2020-01-01T00:00:00.000Z');
    fs.writeFileSync(keysFile, 'file-key-1\nfile-key-2\n');
    fs.utimesSync(keysFile, fixedTime, fixedTime);

    process.env.KASEKI_API_KEYS_FILE = keysFile;
    process.env.KASEKI_RESULTS_DIR = testDir;

    expect(loadConfig().apiKeys).toEqual(['file-key-1', 'file-key-2']);

    fs.writeFileSync(keysFile, 'file-key-3\nfile-key-4\n');
    fs.utimesSync(keysFile, fixedTime, fixedTime);

    expect(loadConfig().apiKeys).toEqual(['file-key-1', 'file-key-2']);
  });

  test('loadConfig skips comments and empty lines in API keys file', () => {
    const keysFile = path.join(testDir, 'api-keys.txt');
    fs.writeFileSync(keysFile, '# This is a comment\nfile-key-1\n\n# Another comment\nfile-key-2\n');

    process.env.KASEKI_API_KEYS_FILE = keysFile;
    process.env.KASEKI_RESULTS_DIR = testDir;

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['file-key-1', 'file-key-2']);
  });

  test('loadConfig strips whitespace from keys in file', () => {
    const keysFile = path.join(testDir, 'api-keys.txt');
    fs.writeFileSync(keysFile, '  file-key-1  \n  file-key-2  \n  file-key-3  \n');

    process.env.KASEKI_API_KEYS_FILE = keysFile;
    process.env.KASEKI_RESULTS_DIR = testDir;

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['file-key-1', 'file-key-2', 'file-key-3']);
  });

  test('loadConfig falls back to KASEKI_API_KEYS when file is empty', () => {
    const keysFile = path.join(testDir, 'api-keys.txt');
    fs.writeFileSync(keysFile, '');

    process.env.KASEKI_API_KEYS_FILE = keysFile;
    process.env.KASEKI_API_KEYS = 'fallback-key';
    process.env.KASEKI_RESULTS_DIR = testDir;

    const config = loadConfig();

    expect(config.apiKeys).toEqual(['fallback-key']);
  });

  test('loadConfig throws when KASEKI_API_KEYS_FILE is unreadable', () => {
    process.env.KASEKI_API_KEYS_FILE = '/nonexistent/path/keys.txt';
    process.env.KASEKI_RESULTS_DIR = testDir;

    expect(() => loadConfig()).toThrow('Failed to read KASEKI_API_KEYS_FILE');
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
