import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSecretLocations, readHostSecret } from './host-secrets-reader';

describe('host secrets reader', () => {
  const originalEnv = process.env;
  let secretsDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-secrets-test-'));
    process.env.KASEKI_SECRETS_DIR = secretsDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(secretsDir, { recursive: true, force: true });
  });

  test('reads secrets from configured secrets directory', () => {
    fs.writeFileSync(path.join(secretsDir, 'openrouter_api_key'), 'test-key\n', { mode: 0o600 });

    expect(readHostSecret('openrouter_api_key')).toBe('test-key');
    expect(getSecretLocations('openrouter_api_key').primary).toBe(
      path.join(secretsDir, 'openrouter_api_key'),
    );
  });

  test('rejects path traversal secret names', () => {
    expect(() => readHostSecret('../openrouter_api_key')).toThrow('Invalid secret name');
  });
});
