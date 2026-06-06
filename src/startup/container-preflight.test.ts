/**
 * Container Preflight Diagnostics - Test Suite
 *
 * Tests for git safe.directory configuration and auto-remediation behavior.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { ContainerPreflightDiagnostics, clearContainerPreflightResults } from './container-preflight';
import { KasekiApiConfig } from '../kaseki-api-config';

// Mock child_process.spawnSync for git operations
jest.mock('child_process');

// Mock fs for filesystem operations
jest.mock('fs');

describe('ContainerPreflightDiagnostics', () => {
  let diagnostics: ContainerPreflightDiagnostics;
  let mockConfig: Partial<KasekiApiConfig>;

  beforeEach(() => {
    jest.clearAllMocks();
    clearContainerPreflightResults();

    // Create a minimal mock config
    mockConfig = {
      port: 8080,
      logLevel: 'info',
    };

    diagnostics = new ContainerPreflightDiagnostics(mockConfig as KasekiApiConfig);

    // Reset environment
    delete process.env.KASEKI_STARTUP_CHECK_AUTO_REMEDIATE;
    delete process.env.KASEKI_SAFE_DIRECTORY_SCOPE;
    process.env.KASEKI_CHECKOUT_DIR = '/agents/kaseki-agent';
    process.env.KASEKI_ROOT = '/agents';
    process.env.KASEKI_SECRETS_DIR = '/run/secrets/kaseki';
    process.env.KASEKI_TEMPLATE_DIR = '/agents/kaseki-template';
  });

  describe('checkGitSafeDirectory - Read-Only Mode', () => {
    it('should return ok=true when git safe.directory is already configured', () => {
      const checkoutDir = '/agents/kaseki-agent';

      // Mock fs.existsSync to return true for .git directory
      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath === path.join(checkoutDir, '.git');
      });

      // Mock spawnSync to return the configured directory
      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stdout: `${checkoutDir}\n`,
        stderr: '',
      });

      const result = diagnostics['checkGitSafeDirectory']();

      expect(result.ok).toBe(true);
      expect(result.name).toBe('git-safe-directory');
      expect(result.detail).toContain('Git safe.directory is configured');
      expect(result.remediation).toBeUndefined();
    });

    it('should return ok=false when git safe.directory is not configured', () => {
      process.env.KASEKI_STARTUP_CHECK_AUTO_REMEDIATE = '0';
      const checkoutDir = '/agents/kaseki-agent';

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath === path.join(checkoutDir, '.git');
      });

      // Mock spawnSync to return empty output (not configured)
      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stdout: '',
        stderr: '',
      });

      const result = diagnostics['checkGitSafeDirectory']();

      expect(result.ok).toBe(false);
      expect(result.name).toBe('git-safe-directory');
      expect(result.detail).toContain('Git safe.directory not configured');
      expect(result.remediation).toContain('git config --global --add safe.directory');
    });

    it('should show currently configured directories in diagnostic message', () => {
      process.env.KASEKI_STARTUP_CHECK_AUTO_REMEDIATE = '0';
      const checkoutDir = '/agents/kaseki-agent';

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath === path.join(checkoutDir, '.git');
      });

      // Mock spawnSync to return different configured directory
      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stdout: '/some/other/path\n',
        stderr: '',
      });

      const result = diagnostics['checkGitSafeDirectory']();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('Currently: /some/other/path');
    });

    it('should return ok=false when .git directory does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = diagnostics['checkGitSafeDirectory']();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('Git directory missing');
      expect(result.remediation).toContain('sudo kaseki-agent host setup --fix');
    });
  });

  describe('checkGitSafeDirectory - Auto-Remediation', () => {
    it('should auto-remediate when config is missing and auto-remediate is enabled (default)', () => {
      const checkoutDir = '/agents/kaseki-agent';

      // Setup: .git exists, but safe.directory not configured
      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath === path.join(checkoutDir, '.git');
      });

      let callCount = 0;
      (spawnSync as jest.Mock).mockImplementation((_cmd: string, _args: string[]) => {
        callCount++;
        // First call: check if already configured (returns empty)
        if (callCount === 1 && _cmd === 'git' && _args[2] === '--get-all') {
          return {
            status: 0,
            stdout: '',
            stderr: '',
          };
        }
        // Second call: attempt to configure (succeeds)
        if (callCount === 2 && _cmd === 'git' && _args[2] === '--add') {
          return {
            status: 0,
            stdout: '',
            stderr: '',
          };
        }
        return { status: 1, stdout: '', stderr: '' };
      });

      const result = diagnostics['checkGitSafeDirectory']();

      // Should succeed because auto-remediation was performed
      expect(result.ok).toBe(true);
      expect(result.detail).toContain('auto-configured');

      // Verify git config --add was called
      expect(spawnSync).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['config', '--global', '--add', 'safe.directory', checkoutDir]),
        expect.any(Object),
      );
    });

    it('should respect KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0 to skip remediation', () => {
      process.env.KASEKI_STARTUP_CHECK_AUTO_REMEDIATE = '0';
      const checkoutDir = '/agents/kaseki-agent';

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath === path.join(checkoutDir, '.git');
      });

      // Return not-configured
      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stdout: '',
        stderr: '',
      });

      const result = diagnostics['checkGitSafeDirectory']();

      // Should fail, not attempt remediation
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('Git safe.directory not configured');

      // Verify only one git call (the check, not the remediation)
      const gitCalls = (spawnSync as jest.Mock).mock.calls.filter(
        (call: any[]) => call[0] === 'git',
      );
      expect(gitCalls.length).toBe(1);
      expect(gitCalls[0][1]).toContain('--get-all');
    });

    it('should gracefully handle remediation failure', () => {
      const checkoutDir = '/agents/kaseki-agent';

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath === path.join(checkoutDir, '.git');
      });

      let callCount = 0;
      (spawnSync as jest.Mock).mockImplementation((_cmd: string, _args: string[]) => {
        callCount++;
        // First call: check returns empty (not configured)
        if (callCount === 1) {
          return {
            status: 0,
            stdout: '',
            stderr: '',
          };
        }
        // Second call: remediation fails (e.g., no write permission)
        if (callCount === 2) {
          return {
            status: 1,
            stdout: '',
            stderr: 'fatal: cannot write to /root/.gitconfig: Permission denied\n',
          };
        }
        return { status: 1, stdout: '', stderr: '' };
      });

      const result = diagnostics['checkGitSafeDirectory']();

      // Should return ok=false with remediation hint
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('Git safe.directory not configured');
      expect(result.remediation).toContain('git config --global --add safe.directory');

      // Should include error detail in response
      if (result.remediationAttemptError) {
        expect(result.remediationAttemptError).toContain('Permission denied');
      }
    });

    it('should use --system config if KASEKI_SAFE_DIRECTORY_SCOPE=system', () => {
      process.env.KASEKI_SAFE_DIRECTORY_SCOPE = 'system';
      const checkoutDir = '/agents/kaseki-agent';

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath === path.join(checkoutDir, '.git');
      });

      let callCount = 0;
      (spawnSync as jest.Mock).mockImplementation((_cmd: string, _args: string[]) => {
        callCount++;
        if (callCount === 1) {
          // First call: check with --system scope
          return {
            status: 0,
            stdout: '',
            stderr: '',
          };
        }
        if (callCount === 2) {
          // Second call: configure with --system scope
          return {
            status: 0,
            stdout: '',
            stderr: '',
          };
        }
        return { status: 1, stdout: '', stderr: '' };
      });

      const result = diagnostics['checkGitSafeDirectory']();

      expect(result.ok).toBe(true);

      // Verify --system flag was used instead of --global
      const configCalls = (spawnSync as jest.Mock).mock.calls.filter(
        (call: any[]) => call[0] === 'git' && call[1].includes('config'),
      );
      expect(configCalls[configCalls.length - 1][1]).toContain('--system');
    });
  });

  describe('checkGitSafeDirectory - Custom Scope', () => {
    it('should detect checkout directory from environment variable', () => {
      const customDir = '/custom/checkout';
      process.env.KASEKI_CHECKOUT_DIR = customDir;

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath === path.join(customDir, '.git');
      });

      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stdout: `${customDir}\n`,
        stderr: '',
      });

      const result = diagnostics['checkGitSafeDirectory']();

      expect(result.ok).toBe(true);
      expect(result.detail).toContain(customDir);
    });
  });

  describe('Full diagnostics run', () => {
    it('should include checkGitSafeDirectory in full run', () => {
      // Setup basic mocks for all checks to pass
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.accessSync as jest.Mock).mockReturnValue(undefined); // No error = accessible

      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stdout: '/agents/kaseki-agent\n',
        stderr: '',
      });

      const checks = diagnostics.run();

      const gitSafeDirCheck = checks.find((c) => c.name === 'git-safe-directory');
      expect(gitSafeDirCheck).toBeDefined();
      expect(gitSafeDirCheck?.ok).toBe(true);
    });
  });
});
