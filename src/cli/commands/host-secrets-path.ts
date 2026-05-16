import { spawnSync } from 'child_process';
import { resolve } from 'path';

export function configureHostSecretsDirForPreflight(env: NodeJS.ProcessEnv = process.env): void {
  if (env.KASEKI_SECRETS_DIR) {
    return;
  }

  if (env.KASEKI_HOST_SECRETS_DIR) {
    env.KASEKI_SECRETS_DIR = env.KASEKI_HOST_SECRETS_DIR;
    return;
  }

  const sudoHome = getSudoUserHome(env);
  if (sudoHome) {
    env.KASEKI_SECRETS_DIR = resolve(sudoHome, 'secrets');
  }
}

function getSudoUserHome(env: NodeJS.ProcessEnv): string | null {
  const sudoUser = env.SUDO_USER;
  if (!sudoUser || sudoUser === 'root' || !/^[a-z_][a-z0-9_-]*\$?$/.test(sudoUser)) {
    return null;
  }

  const getent = spawnSync('getent', ['passwd', sudoUser], {
    encoding: 'utf8',
  });
  if (getent.status === 0 && getent.stdout) {
    const home = getent.stdout.trim().split(':')[5];
    if (home) {
      return home;
    }
  }

  return `/home/${sudoUser}`;
}
