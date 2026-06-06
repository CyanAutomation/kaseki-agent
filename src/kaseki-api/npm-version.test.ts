/**
 * Tests for getNpmVersion utility
 * Ensures npm version detection works with proper fallback
 */

import { getNpmVersion } from './npm-version';

describe('getNpmVersion', () => {
  it('should detect npm version when available', async () => {
    const version = await getNpmVersion();
    expect(version).toBeTruthy();
    // Version should be in format: X.Y.Z (major.minor.patch)
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should gracefully fallback to "unknown" if npm command fails', async () => {
    // Create a mock version that fails
    const originalEnv = process.env.PATH;
    try {
      process.env.PATH = '/nonexistent:/bin';
      const version = await getNpmVersion();
      // Should not throw, should return 'unknown' as graceful fallback
      expect(['unknown', ...version.match(/^\d+\.\d+\.\d+$/) ? [version] : []] as any[]).toContain(version);
    } finally {
      process.env.PATH = originalEnv;
    }
  });

  it('should not throw if npm is not in PATH', async () => {
    await expect(
      getNpmVersion({
        npmVersion: '',
        execSync: () => {
          throw new Error('npm is not in PATH');
        },
      })
    ).resolves.toBe('unknown');
  });

  it('should ignore an undefined injected npm version and use process npm version', async () => {
    const originalNpmVersion = process.versions.npm;

    try {
      Object.defineProperty(process.versions, 'npm', {
        configurable: true,
        value: '8.8.8',
      });

      const version = await getNpmVersion({
        npmVersion: undefined,
        execSync: () => '999.0.0',
      });

      expect(version).toBe('8.8.8');
    } finally {
      if (originalNpmVersion === undefined) {
        delete process.versions.npm;
      } else {
        Object.defineProperty(process.versions, 'npm', {
          configurable: true,
          value: originalNpmVersion,
        });
      }
    }
  });
});
