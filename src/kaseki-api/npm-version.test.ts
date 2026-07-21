/**
 * Tests for getNpmVersion utility
 * Ensures npm version detection works with proper fallback
 */

import { getNpmVersion } from './npm-version';

describe('getNpmVersion', () => {
  it('should detect npm version when available', async () => {
    const execSync = jest.fn(() => '999.0.0');

    const version = await getNpmVersion({
      npmVersion: '10.2.4',
      execSync,
    });

    expect(version).toBe('10.2.4');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('should detect npm version with the command fallback', async () => {
    const execSync = jest.fn(() => '10.2.4\n');

    const version = await getNpmVersion({
      npmVersion: '',
      execSync,
    });

    expect(version).toBe('10.2.4');
    expect(execSync).toHaveBeenCalledWith('npm --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
  });

  it('should gracefully fallback to "unknown" if npm command fails', async () => {
    const version = await getNpmVersion({
      npmVersion: '',
      execSync: () => {
        throw new Error('npm command failed');
      },
    });

    expect(version).toBe('unknown');
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

});
