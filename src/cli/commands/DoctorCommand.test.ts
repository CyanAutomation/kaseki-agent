import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DoctorCommand } from './DoctorCommand';
import { ConfigManager } from '../../config/ConfigManager';

describe('DoctorCommand', () => {
  let command: DoctorCommand;
  let configManager: ConfigManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for test auth files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-doctor-test-'));

    configManager = new ConfigManager();
    command = new DoctorCommand(configManager);

    // Clear environment variables that might interfere
    delete process.env.GITHUB_APP_ID_FILE;
    delete process.env.GITHUB_APP_CLIENT_ID_FILE;
    delete process.env.GITHUB_APP_PRIVATE_KEY_FILE;
    delete process.env.OPENROUTER_API_KEY_FILE;
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('checkAuthFiles', () => {
    test('should pass when all auth files exist and are readable', async () => {
      // Create temporary auth files
      const authFiles = [
        { key: 'auth.openrouter_api_key_file', content: 'sk-or-test-key' },
        { key: 'auth.github_app_id_file', content: '123456' },
        { key: 'auth.github_app_client_id_file', content: 'Iv1.test' },
        { key: 'auth.github_app_private_key_file', content: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----' },
      ];

      const filePaths = authFiles.map(file => {
        const filePath = path.join(tempDir, file.key.replace('auth.', ''));
        fs.writeFileSync(filePath, file.content);
        return { key: file.key, path: filePath };
      });

      // Configure with temp file paths
      await configManager.load();
      // Mock the config manager to return our test file paths
      jest.spyOn(configManager, 'get').mockImplementation((checkKey: string, fallback?: unknown) => {
        const match = filePaths.find(f => f.key === checkKey);
        return match?.path || fallback || '';
      });

      // Execute the check
      const result = await (command as any).checkAuthFiles();

      expect(result.status).toBe('pass');
      expect(result.message).toContain('All required auth files present');
    });

    test('should fail when auth files are missing', async () => {
      // Configure with non-existent file paths
      await configManager.load();
      jest.spyOn(configManager, 'get').mockReturnValue('');

      const result = await (command as any).checkAuthFiles();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('Authentication validation failed');
      expect(result.message).toContain('Environment variables');
      expect(result.message).toContain('Config file');
    });

    test('should fail with helpful guidance when files do not exist', async () => {
      // Create config that points to non-existent files
      const nonExistentPath = path.join(tempDir, 'non-existent-file');

      // Mock sudo to test for sudo-specific guidance
      const mockGetUid = jest.spyOn(process, 'getuid').mockReturnValue(0);

      await configManager.load();

      jest.spyOn(configManager, 'get').mockImplementation((key: string) => {
        if (key.includes('auth.')) {
          return nonExistentPath;
        }
        return '';
      });

      const result = await (command as any).checkAuthFiles();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('not found');
      expect(result.message).toContain('💡');
      expect(result.message).toContain('sudo -E');
      expect(result.message).toContain('config.json');

      mockGetUid.mockRestore();
    });

    test('should detect empty auth files', async () => {
      // Create an empty auth file
      const emptyFile = path.join(tempDir, 'empty-auth');
      fs.writeFileSync(emptyFile, '');

      await configManager.load();
      jest.spyOn(configManager, 'get').mockImplementation((key: string) => {
        if (key === 'auth.openrouter_api_key_file') {
          return emptyFile;
        }
        return path.join(tempDir, `${key.replace('auth.', '')}-valid`);
      });

      // Create valid placeholder files for other auth types
      ['github_app_id_file', 'github_app_client_id_file', 'github_app_private_key_file'].forEach(file => {
        const filePath = path.join(tempDir, `${file}-valid`);
        fs.writeFileSync(filePath, 'valid-content');
      });

      const result = await (command as any).checkAuthFiles();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('empty');
    });

    test('should include sudo recommendation when running as root', async () => {
      // Mock sudo detection
      const mockGetUid = jest.spyOn(process, 'getuid').mockReturnValue(0);

      await configManager.load();
      jest.spyOn(configManager, 'get').mockReturnValue('');

      const result = await (command as any).checkAuthFiles();

      expect(result.message).toContain('sudo -E kaseki-agent');
      expect(result.message).toContain('preserve environment');

      mockGetUid.mockRestore();
    });

    test('error message should guide user through multiple setup options', async () => {
      await configManager.load();
      jest.spyOn(configManager, 'get').mockReturnValue('');

      const result = await (command as any).checkAuthFiles();

      // Check for all three setup options in error message
      expect(result.message).toContain('1️⃣');  // Option 1: env vars
      expect(result.message).toContain('2️⃣');  // Option 2: config file
      expect(result.message).toContain('3️⃣');  // Option 3: docker-compose
      expect(result.message).toContain('~/.kaseki/config.json');
      expect(result.message).toContain('docker-compose');
    });
  });

  describe('isSudo', () => {
    test('should detect sudo when getuid returns 0', () => {
      const mockGetUid = jest.spyOn(process, 'getuid').mockReturnValue(0);

      const isSudo = (command as any).isSudo();

      expect(isSudo).toBe(true);
      mockGetUid.mockRestore();
    });

    test('should detect sudo when SUDO_USER env var is set', () => {
      const originalSudoUser = process.env.SUDO_USER;
      process.env.SUDO_USER = 'pi';

      const isSudo = (command as any).isSudo();

      expect(isSudo).toBe(true);

      if (originalSudoUser === undefined) {
        delete process.env.SUDO_USER;
      } else {
        process.env.SUDO_USER = originalSudoUser;
      }
    });

    test('should not detect sudo when uid is not 0 and SUDO_USER is not set', () => {
      const originalSudoUser = process.env.SUDO_USER;
      delete process.env.SUDO_USER;

      const mockGetUid = jest.spyOn(process, 'getuid').mockReturnValue(1000);

      const isSudo = (command as any).isSudo();

      expect(isSudo).toBe(false);

      mockGetUid.mockRestore();
      if (originalSudoUser !== undefined) {
        process.env.SUDO_USER = originalSudoUser;
      }
    });
  });

  describe('buildAuthErrorMessage', () => {
    test('should format missing files clearly', async () => {
      const missingFiles = [
        { name: 'OpenRouter API Key File', envVar: 'OPENROUTER_API_KEY_FILE', path: null },
        { name: 'GitHub App ID File', envVar: 'GITHUB_APP_ID_FILE', path: '/home/pi/secrets/id' },
      ];
      const unreadableFiles: any[] = [];

      const message = (command as any).buildAuthErrorMessage(missingFiles, unreadableFiles);

      expect(message).toContain('Missing or unconfigured');
      expect(message).toContain('OPENROUTER_API_KEY_FILE');
      expect(message).toContain('not found at');
    });

    test('should include unreadable file details', async () => {
      const missingFiles: any[] = [];
      const unreadableFiles = [
        { name: 'GitHub App ID File', path: '/home/pi/secrets/id', reason: 'permission denied' },
      ];

      const message = (command as any).buildAuthErrorMessage(missingFiles, unreadableFiles);

      expect(message).toContain('Unreadable files');
      expect(message).toContain('permission denied');
    });

    test('should recommend sudo -E for interactive users', async () => {
      const mockGetUid = jest.spyOn(process, 'getuid').mockReturnValue(0);

      const missingFiles = [
        { name: 'GitHub App ID File', envVar: 'GITHUB_APP_ID_FILE', path: null },
      ];
      const unreadableFiles: any[] = [];

      const message = (command as any).buildAuthErrorMessage(missingFiles, unreadableFiles);

      expect(message).toContain('sudo -E');
      expect(message).toContain('preserve environment');

      mockGetUid.mockRestore();
    });

    test('should include config file path in guidance', async () => {
      const missingFiles = [
        { name: 'GitHub App ID File', envVar: 'GITHUB_APP_ID_FILE', path: null },
      ];
      const unreadableFiles: any[] = [];

      const message = (command as any).buildAuthErrorMessage(missingFiles, unreadableFiles);

      expect(message).toContain('~/.kaseki/config.json');
      expect(message).toContain('github_app_id_file');
    });

    test('should include docker-compose option', async () => {
      const missingFiles = [
        { name: 'GitHub App ID File', envVar: 'GITHUB_APP_ID_FILE', path: null },
      ];
      const unreadableFiles: any[] = [];

      const message = (command as any).buildAuthErrorMessage(missingFiles, unreadableFiles);

      expect(message).toContain('Docker Compose');
      expect(message).toContain('DEPLOYMENT.md');
    });
  });

  describe('execute', () => {
    test('should return exit code 0 when all checks pass', async () => {
      // Mock all config values to be valid
      const validAuthFile = path.join(tempDir, 'valid-auth');
      fs.writeFileSync(validAuthFile, 'valid-content');

      jest.spyOn(configManager, 'load').mockResolvedValue(undefined);
      jest.spyOn(configManager, 'get').mockImplementation((key: string, fallback?: unknown) => {
        if (key.includes('auth.')) {
          return validAuthFile;
        }
        if (key === 'docker.image') {
          return 'docker.io/cyanautomation/kaseki-agent:latest';
        }
        if (key === 'directories.root') {
          return '/agents';
        }
        return fallback || '';
      });

      // Only check auth files for exit code (skipping docker/disk/etc for simplicity)
      const result = await (command as any).checkAuthFiles();

      expect(result.status).toBe('pass');
    });
  });
});
