import { ConfigManager } from './ConfigManager';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  const inlineSecretEnvVars = [
    'OPENROUTER_API_KEY',
    'GITHUB_APP_ID',
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_PRIVATE_KEY',
  ] as const;
  let originalInlineSecretEnv: Partial<Record<typeof inlineSecretEnvVars[number], string | undefined>>;

  beforeEach(async () => {
    originalInlineSecretEnv = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    };

    for (const envVar of inlineSecretEnvVars) {
      delete process.env[envVar];
    }

    configManager = new ConfigManager();
    // Load to initialize config with defaults
    await configManager.load();
  });

  afterEach(() => {
    for (const envVar of inlineSecretEnvVars) {
      const originalValue = originalInlineSecretEnv[envVar];
      if (originalValue === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = originalValue;
      }
    }
  });

  test('should reject inline OPENROUTER_API_KEY secret variable', async () => {
    process.env.OPENROUTER_API_KEY = 'inline-secret-value';

    const manager = new ConfigManager();

    await expect(manager.load()).rejects.toThrow(
      'Inline secret variable OPENROUTER_API_KEY is not allowed.'
    );
  });

  describe('validateAuthPaths', () => {
    test('should detect github_client_id naming mistake', () => {
      configManager.set('auth.github_app_client_id_file', '/home/pi/secrets/github_client_id');

      const result = configManager.validateAuthPaths();

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('github_client_id');
      expect(result.warnings[0]).toContain('github_app_client_id');
      expect(result.suggestions.has('/home/pi/secrets/github_client_id')).toBe(true);
      expect(result.suggestions.get('/home/pi/secrets/github_client_id')).toBe(
        '/home/pi/secrets/github_app_client_id'
      );
    });

    test('should not warn for correctly named paths', () => {
      configManager.set('auth.github_app_client_id_file', '/home/pi/secrets/github_app_client_id');

      const result = configManager.validateAuthPaths();

      expect(result.warnings.length).toBe(0);
      expect(result.suggestions.size).toBe(0);
    });

    test('should return empty warnings for unconfigured paths', () => {
      // Don't set any auth paths

      const result = configManager.validateAuthPaths();

      expect(result.warnings.length).toBe(0);
      expect(result.suggestions.size).toBe(0);
    });

    test('should handle multiple incorrect paths', () => {
      configManager.set('auth.github_app_client_id_file', '/home/pi/secrets/github_client_id');
      configManager.set('auth.github_app_id_file', '/agents/secrets/github_app_id');

      const result = configManager.validateAuthPaths();

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('github_client_id'))).toBe(true);
    });
  });

  describe('getPathDiagnostics', () => {
    test('should provide diagnostic for misconfigured path', () => {
      configManager.set(
        'auth.github_app_client_id_file',
        '/home/pi/secrets/github_client_id'
      );

      const diagnostic = configManager.getPathDiagnostics('auth.github_app_client_id_file');

      expect(diagnostic.path).toBe('/home/pi/secrets/github_client_id');
      expect(diagnostic.hasWarning).toBe(true);
      expect(diagnostic.suggestion).toBe('/home/pi/secrets/github_app_client_id');
    });

    test('should not provide suggestion for correct paths', () => {
      configManager.set(
        'auth.github_app_client_id_file',
        '/home/pi/secrets/github_app_client_id'
      );

      const diagnostic = configManager.getPathDiagnostics('auth.github_app_client_id_file');

      expect(diagnostic.path).toBe('/home/pi/secrets/github_app_client_id');
      expect(diagnostic.hasWarning).toBe(false);
      expect(diagnostic.suggestion).toBeNull();
    });

    test('should handle non-existent config keys gracefully', () => {
      const diagnostic = configManager.getPathDiagnostics('auth.nonexistent_file');

      expect(diagnostic.path).toBeNull();
      expect(diagnostic.hasWarning).toBe(false);
      expect(diagnostic.suggestion).toBeNull();
    });
  });
});
