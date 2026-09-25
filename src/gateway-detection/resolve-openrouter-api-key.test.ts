import * as fs from 'node:fs';

import { resolveOpenRouterApiKey } from './resolve-openrouter-api-key';

jest.mock('node:fs');

/**
 * OpenRouter credentials in kaseki-agent should resolve with the same precedence as
 * other gateway provider secrets: prefer a mounted file when present, otherwise fall back
 * to the direct environment variable, and otherwise report that the key is not configured.
 *
 * This preserves secret management patterns used by the agent while keeping runtime config
 * explicit and easy to test in CI/local development.
 */
describe('resolveOpenRouterApiKey', () => {
  const originalEnv = { ...process.env };
  const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY_FILE;
    delete process.env.KASEKI_DECISION_API_KEY_FILE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should resolve from OPENROUTER_API_KEY env var', () => {
    process.env.OPENROUTER_API_KEY = 'env-openrouter-key';

    const result = resolveOpenRouterApiKey();

    expect(result).toEqual({
      value: 'env-openrouter-key',
      configured: true,
      source: 'env_var',
    });
  });

  it('prefers a dedicated mounted JEV key over the general OpenRouter key', () => {
    process.env.OPENROUTER_API_KEY = 'general-openrouter-key';
    process.env.KASEKI_DECISION_API_KEY_FILE = '/tmp/jev-api-key';
    mockReadFileSync.mockReturnValue('dedicated-jev-key\n' as any);

    expect(resolveOpenRouterApiKey()).toEqual({
      value: 'dedicated-jev-key',
      configured: true,
      source: 'file',
    });
    expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/jev-api-key', 'utf8');
  });

  it('should prefer OPENROUTER_API_KEY_FILE over env var', () => {
    process.env.OPENROUTER_API_KEY = 'env-openrouter-key';
    process.env.OPENROUTER_API_KEY_FILE = '/tmp/openrouter-api-key';

    mockReadFileSync.mockReturnValue('file-openrouter-key\n' as any);

    const result = resolveOpenRouterApiKey();

    expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/openrouter-api-key', 'utf8');
    expect(result).toEqual({
      value: 'file-openrouter-key',
      configured: true,
      source: 'file',
    });
  });

  it('should return configured:false when neither env var nor file is set', () => {
    const result = resolveOpenRouterApiKey();

    expect(result).toEqual({
      configured: false,
      source: 'none',
    });
  });

  it('should include source metadata in result', () => {
    process.env.OPENROUTER_API_KEY = 'source-metadata-key';

    const result = resolveOpenRouterApiKey();

    expect(result).toMatchObject({
      value: 'source-metadata-key',
      configured: true,
      source: 'env_var',
    });
  });

  it('should handle file read errors gracefully', () => {
    process.env.OPENROUTER_API_KEY_FILE = '/tmp/missing-openrouter-api-key';

    mockReadFileSync.mockImplementation(() => {
      const error = new Error('ENOENT: no such file or directory');
      throw error;
    });

    const result = resolveOpenRouterApiKey();

    expect(result).toMatchObject({
      configured: false,
      source: 'none',
      error: expect.stringContaining('ENOENT'),
    });
  });

  it('should trim whitespace from file contents', () => {
    process.env.OPENROUTER_API_KEY_FILE = '/tmp/openrouter-api-key-trimmed';

    mockReadFileSync.mockReturnValue('  trimmed-openrouter-key  \n' as any);

    const result = resolveOpenRouterApiKey();

    expect(result).toEqual({
      value: 'trimmed-openrouter-key',
      configured: true,
      source: 'file',
    });
  });
});
