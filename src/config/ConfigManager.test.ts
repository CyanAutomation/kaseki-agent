import { ConfigManager } from './ConfigManager';

describe('ConfigManager', () => {
  let configManager: ConfigManager;

  beforeEach(async () => {
    configManager = new ConfigManager();
    // Load to initialize config with defaults
    await configManager.load();
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
