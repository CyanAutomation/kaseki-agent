import { createLogger } from './logger';

describe('logger environment precedence', () => {
  const environmentNames = ['LOG_LEVEL', 'KASEKI_API_LOG_LEVEL'] as const;
  let originalEnvironment: Record<string, string | undefined>;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
    for (const name of environmentNames) delete process.env[name];
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const name of environmentNames) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  test('uses API-specific level before the generic compatibility fallback', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.KASEKI_API_LOG_LEVEL = 'error';

    const logger = createLogger('test');
    logger.info('hidden');
    logger.error('visible');

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('visible'));
  });

  test('uses LOG_LEVEL when API-specific level is unset', () => {
    process.env.LOG_LEVEL = 'error';

    const logger = createLogger('test');
    logger.warn('hidden');
    logger.error('visible');

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('visible'));
  });
});
