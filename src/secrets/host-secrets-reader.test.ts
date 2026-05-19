import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSecretLocations, readHostSecret, resolveHostSecretPath } from './host-secrets-reader';

describe('host secrets reader', () => {
  let secretsDir: string;
  let originalKasekiSecretsDir: string | undefined;

  beforeEach(() => {
    secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-secrets-test-'));
    originalKasekiSecretsDir = process.env.KASEKI_SECRETS_DIR;
    process.env.KASEKI_SECRETS_DIR = secretsDir;
  });

  afterEach(() => {
    if (originalKasekiSecretsDir !== undefined) {
      process.env.KASEKI_SECRETS_DIR = originalKasekiSecretsDir;
    } else {
      delete process.env.KASEKI_SECRETS_DIR;
    }
    fs.rmSync(secretsDir, { recursive: true, force: true });
  });

  test('reads secrets from configured secrets directory', () => {
    fs.writeFileSync(path.join(secretsDir, 'openrouter_api_key'), 'test-key\n', { mode: 0o600 });

    expect(readHostSecret('openrouter_api_key')).toBe('test-key');
    expect(getSecretLocations('openrouter_api_key').primary).toBe(
      path.join(secretsDir, 'openrouter_api_key'),
    );
  });

  test('trims whitespace from secret files', () => {
    fs.writeFileSync(path.join(secretsDir, 'test-key'), '  secret-value  \n\n', { mode: 0o600 });

    expect(readHostSecret('test-key')).toBe('secret-value');
  });

  test('returns null if secret not found in any location', () => {
    expect(readHostSecret('nonexistent-key')).toBeNull();
  });

  test('rejects path traversal secret names', () => {
    expect(() => readHostSecret('../openrouter_api_key')).toThrow('Invalid secret name');
  });

  test('rejects secret names with slashes', () => {
    expect(() => readHostSecret('foo/bar')).toThrow('Invalid secret name');
  });

  test('reports when a configured secret path is a directory', () => {
    fs.mkdirSync(path.join(secretsDir, 'openrouter_api_key'));

    expect(() => readHostSecret('openrouter_api_key')).toThrow(/Secret path is a directory: .*openrouter_api_key .*Replace it with a file/);
  });

  test('resolves the selected host secret path without reading the value', () => {
    const secretPath = path.join(secretsDir, 'openrouter_api_key');
    fs.writeFileSync(secretPath, 'test-key\n', { mode: 0o600 });

    expect(resolveHostSecretPath('openrouter_api_key')).toBe(secretPath);
  });
});

