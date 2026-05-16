import { configureHostSecretsDirForPreflight } from './host-secrets-path';

describe('configureHostSecretsDirForPreflight', () => {
  test('prefers KASEKI_HOST_SECRETS_DIR when KASEKI_SECRETS_DIR is unset', () => {
    const env: NodeJS.ProcessEnv = {
      KASEKI_HOST_SECRETS_DIR: '/home/pi/secrets',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/home/pi/secrets');
  });

  test('preserves an explicit KASEKI_SECRETS_DIR', () => {
    const env: NodeJS.ProcessEnv = {
      KASEKI_SECRETS_DIR: '/custom/secrets',
      KASEKI_HOST_SECRETS_DIR: '/home/pi/secrets',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/custom/secrets');
  });

  test('falls back to the sudo user home for sudo preflight', () => {
    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'kasekiuser',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBe('/home/kasekiuser/secrets');
  });

  test('rejects invalid SUDO_USER values', () => {
    const env: NodeJS.ProcessEnv = {
      SUDO_USER: 'user; rm -rf /',
    };

    configureHostSecretsDirForPreflight(env);

    expect(env.KASEKI_SECRETS_DIR).toBeUndefined();
  });
});
