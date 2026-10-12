import { getConfig } from './summarizer-config';

describe('summarizer environment configuration', () => {
  const names = [
    'KASEKI_SUMMARY_MIN_BYTES',
    'KASEKI_SUMMARY_MAX_BYTES',
    'KASEKI_SUMMARY_PARSE_TIMEOUT',
    'KASEKI_SUMMARY_LLM_TIMEOUT',
    'KASEKI_SUMMARY_LLM_FALLBACK',
    'KASEKI_SUMMARY_CACHE',
    'KASEKI_SUMMARY_CACHE_DIR',
    'KASEKI_SUMMARY_CACHE_TTL_MS',
    'KASEKI_SUMMARY_CACHE_MAX_ENTRIES',
    'KASEKI_SUMMARY_CACHE_MAX_SIZE_BYTES',
  ] as const;
  let originalEnvironment: Record<string, string | undefined>;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    originalEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const name of names) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    consoleWarn.mockRestore();
  });

  test('retains defaults when no overrides are configured', () => {
    expect(getConfig()).toMatchObject({
      minSizeBytes: 2048,
      maxSizeBytes: 1048576,
      parseTimeoutMs: 2000,
      llmFallbackTimeoutMs: 5000,
      cacheTTLMs: 24 * 60 * 60 * 1000,
      cacheMaxEntries: 1000,
      cacheMaxSizeBytes: 50 * 1024 * 1024,
    });
  });

  test('applies valid integer overrides', () => {
    process.env.KASEKI_SUMMARY_MIN_BYTES = '1024';
    process.env.KASEKI_SUMMARY_CACHE_MAX_ENTRIES = '0';

    expect(getConfig()).toMatchObject({ minSizeBytes: 1024, cacheMaxEntries: 0 });
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test('uses the default size range when minimum exceeds maximum', () => {
    process.env.KASEKI_SUMMARY_MIN_BYTES = '2000000';
    process.env.KASEKI_SUMMARY_MAX_BYTES = '1000000';

    expect(getConfig()).toMatchObject({ minSizeBytes: 2048, maxSizeBytes: 1048576 });
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('KASEKI_SUMMARY_MIN_BYTES'));
  });

  test.each([
    ['KASEKI_SUMMARY_MIN_BYTES', '-1'],
    ['KASEKI_SUMMARY_MAX_BYTES', '1.5'],
    ['KASEKI_SUMMARY_PARSE_TIMEOUT', 'NaN'],
    ['KASEKI_SUMMARY_CACHE_MAX_ENTRIES', '12garbage'],
  ])('ignores invalid %s override and warns without poisoning config', (name, value) => {
    process.env[name] = value;

    const config = getConfig();

    expect(Number.isFinite(config.minSizeBytes)).toBe(true);
    expect(Number.isFinite(config.maxSizeBytes)).toBe(true);
    expect(Number.isFinite(config.parseTimeoutMs)).toBe(true);
    expect(Number.isFinite(config.cacheMaxEntries)).toBe(true);
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining(name));
  });
});
