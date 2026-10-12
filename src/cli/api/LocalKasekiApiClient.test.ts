import { LocalKasekiApiClient } from './LocalKasekiApiClient';
import type { ConfigManager } from '../../config/ConfigManager';

describe('LocalKasekiApiClient.fromConfig environment precedence', () => {
  const environmentNames = ['KASEKI_API_URL', 'KASEKI_API_BASE_URL', 'KASEKI_API_KEY'] as const;
  let originalEnvironment: Record<string, string | undefined>;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
    for (const name of environmentNames) delete process.env[name];
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const name of environmentNames) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    consoleWarn.mockRestore();
  });

  function configManager(baseUrl = 'http://config.example/api/v1'): ConfigManager {
    return {
      get: (key: string, fallback: unknown) => key === 'api.base_url' ? baseUrl : fallback,
    } as unknown as ConfigManager;
  }

  test('prefers KASEKI_API_URL over the legacy alias and config', () => {
    process.env.KASEKI_API_URL = 'https://canonical.example/api/v1';
    process.env.KASEKI_API_BASE_URL = 'https://legacy.example/api/v1';

    const client = LocalKasekiApiClient.fromConfig(configManager());

    expect(client.baseUrl).toBe('https://canonical.example/api/v1');
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test('uses the legacy alias with a value-free deprecation warning when canonical URL is absent', () => {
    process.env.KASEKI_API_BASE_URL = 'https://legacy.example/api/v1?token=secret';

    const client = LocalKasekiApiClient.fromConfig(configManager());

    expect(client.baseUrl).toBe('https://legacy.example/api/v1?token=secret');
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('KASEKI_API_BASE_URL'));
    expect(consoleWarn.mock.calls.flat().join(' ')).not.toContain('token=secret');
  });

  test('uses configured URL without a warning when neither environment variable is set', () => {
    const client = LocalKasekiApiClient.fromConfig(configManager('https://config.example/api/v1'));

    expect(client.baseUrl).toBe('https://config.example/api/v1');
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
