export const INLINE_SECRET_ENV_VARS = [
  'OPENROUTER_API_KEY',
  'GITHUB_APP_ID',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_PRIVATE_KEY',
] as const;

export const snapshotEnv = (keys: readonly string[]): Record<string, string | undefined> =>
  Object.fromEntries(keys.map((key) => [key, process.env[key]]));

export const clearEnv = (keys: readonly string[]): void => {
  for (const key of keys) {
    delete process.env[key];
  }
};

export const restoreEnv = (snapshot: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};
