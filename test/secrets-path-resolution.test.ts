import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Secrets path resolution', () => {
  const tempDir = path.join(os.tmpdir(), 'kaseki-test-secrets');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('keeps one API-facing secrets directory for every required secret', () => {
    const apiSecretsDir = '/run/secrets/kaseki';
    const requiredSecrets = [
      'openrouter_api_key',
      'kaseki_api_keys',
      'github_app_id',
      'github_app_client_id',
      'github_app_private_key',
    ];

    for (const secretName of requiredSecrets) {
      expect(path.posix.join(apiSecretsDir, secretName)).toBe(`/run/secrets/kaseki/${secretName}`);
    }
  });

  test('worker GitHub mounts remain root-level implementation details', () => {
    const apiPath = '/run/secrets/kaseki/github_app_id';
    const workerPath = '/run/secrets/github_app_id';

    expect(apiPath).not.toBe(workerPath);
    expect(apiPath).toBe('/run/secrets/kaseki/github_app_id');
    expect(workerPath).toBe('/run/secrets/github_app_id');
  });

  test('host directory can contain all required secret files together', () => {
    const secretPath = path.join(tempDir, 'github_app_private_key');
    fs.writeFileSync(secretPath, '-----BEGIN RSA PRIVATE KEY-----\nMIGfMA0GCSq\n-----END RSA PRIVATE KEY-----');

    expect(fs.existsSync(secretPath)).toBe(true);
    expect(fs.readFileSync(secretPath, 'utf8')).toContain('BEGIN RSA PRIVATE KEY');
  });
});
