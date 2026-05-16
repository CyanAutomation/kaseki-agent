import { configureHostSecretsDirForPreflight, getDiscoveredSecretsPath } from './host-secrets-path';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs');

describe('configureHostSecretsDirForPreflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('prefers KASEKI_SECRETS_DIR (explicit override, highest priority)', () => {
    const env: NodeJS.ProcessEnv = {
      KASEKI_SECRETS_DIR: '/custom/secrets',
      KASEKI_HOST_SECRETS_DIR: '/home/pi/secrets',
      SUDO_USER: 'pi',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/custom/secrets');
  });

  test('uses KASEKI_HOST_SECRETS_DIR when KASEKI_SECRETS_DIR is unset', () => {
    const env: NodeJS.ProcessEnv = {
      KASEKI_HOST_SECRETS_DIR: '/home/pi/secrets',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/home/pi/secrets');
  });

  test('discovers path from state file if it exists and is valid', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({
        normalized_secrets_dir: '/home/pi/secrets',
        timestamp: '2026-05-16T12:00:00Z',
        version: '1',
      })
    );

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'pi',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/home/pi/secrets');
  });

  test('discovers path from state file for normal user preflight', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({
        normalized_secrets_dir: '/home/pi/secrets',
        timestamp: '2026-05-16T12:00:00Z',
        version: '1',
      })
    );

    const env: NodeJS.ProcessEnv = {
      HOME: '/home/pi',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/home/pi/secrets');
    expect(fs.existsSync).toHaveBeenCalledWith('/home/pi/.kaseki-host-state.json');
  });

  test('skips state file if it does not exist, falls back to sudo home', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'kasekiuser',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/home/kasekiuser/secrets');
  });

  test('skips invalid state file JSON, falls back to sudo home', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('{ invalid json }');

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'kasekiuser',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/home/kasekiuser/secrets');
  });

  test('skips state file if normalized_secrets_dir path does not exist', () => {
    (fs.existsSync as jest.Mock)
      .mockReturnValueOnce(true) // state file exists
      .mockReturnValueOnce(false); // normalized_secrets_dir does not exist

    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({
        normalized_secrets_dir: '/nonexistent/path',
        timestamp: '2026-05-16T12:00:00Z',
        version: '1',
      })
    );

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'kasekiuser',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/home/kasekiuser/secrets');
  });

  test('falls back to the sudo user home for sudo preflight', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false); // No state file

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'kasekiuser',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/home/kasekiuser/secrets');
  });

  test('rejects invalid SUDO_USER values', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'user; rm -rf /',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBeUndefined();
  });

  test('sets KASEKI_SECRETS_DIR from discovered path', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({
        normalized_secrets_dir: '/discovered/secrets',
        timestamp: '2026-05-16T12:00:00Z',
        version: '1',
      })
    );

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'pi',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/discovered/secrets');
  });
});

describe('getDiscoveredSecretsPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns discovered path from state file if valid', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({
        normalized_secrets_dir: '/home/pi/secrets',
        timestamp: '2026-05-16T12:00:00Z',
        version: '1',
      })
    );

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'pi',
    };

    const path = getDiscoveredSecretsPath(env);

    expect(path).toBe('/home/pi/secrets');
  });

  test('returns null if state file does not exist', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'pi',
    };

    const discovered = getDiscoveredSecretsPath(env);

    expect(discovered).toBeNull();
  });

  test('returns null if state file is malformed', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('{ invalid }');

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'pi',
    };

    const discovered = getDiscoveredSecretsPath(env);

    expect(discovered).toBeNull();
  });

  test('returns null if normalized_secrets_dir does not exist', () => {
    (fs.existsSync as jest.Mock)
      .mockReturnValueOnce(true) // state file exists
      .mockReturnValueOnce(false); // normalized_secrets_dir does not exist

    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({
        normalized_secrets_dir: '/nonexistent/path',
      })
    );

    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'pi',
    };

    const discovered = getDiscoveredSecretsPath(env);

    expect(discovered).toBeNull();
  });
});
