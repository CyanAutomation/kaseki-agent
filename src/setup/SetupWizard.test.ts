import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  renderSetupDotEnvContent,
  writeSetupSecretFiles,
  type Essential8Config,
} from './SetupWizard';

describe('SetupWizard generated configuration', () => {
  const config: Essential8Config = {
    llmGatewayUrl: 'https://gateway.example/v1',
    llmGatewayApiKey: 'gateway-secret-value',
    llmModel: 'dynamic/kaseki-agent',
    validationCommands: 'npm run check;npm test',
    kasekiMaxDiffBytes: 400000,
    kasekiAgentTimeoutSeconds: 10800,
    kasekiApiKeys: 'api-secret-value',
  };

  test('does not emit obsolete cache toggle, inline API keys, or invalid publish mode', () => {
    const content = renderSetupDotEnvContent(config, {
      KASEKI_PRE_AGENT_VALIDATION: false,
      KASEKI_STREAM_PROGRESS: true,
    });

    expect(content).not.toContain('KASEKI_CACHE_ENABLED');
    expect(content).not.toContain('KASEKI_API_KEYS=');
    expect(content).not.toContain('gateway-secret-value');
    expect(content).not.toContain('api-secret-value');
    expect(content).toContain('LLM_GATEWAY_API_KEY_FILE=${HOME}/.kaseki/secrets/llm_gateway_api_key');
    expect(content).not.toContain('KASEKI_PUBLISH_MODE=off');
    expect(content).toContain('KASEKI_PUBLISH_MODE=none');
  });

  test('writes credentials as individual owner-only secret files', async () => {
    const secretRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kaseki-setup-secrets-'));
    const secretsDir = path.join(secretRoot, 'secrets');
    try {
      await writeSetupSecretFiles(secretsDir, config);

      expect((await fs.stat(secretsDir)).mode & 0o777).toBe(0o700);
      expect(await fs.readFile(path.join(secretsDir, 'llm_gateway_api_key'), 'utf8')).toBe('gateway-secret-value');
      expect(await fs.readFile(path.join(secretsDir, 'kaseki_api_keys'), 'utf8')).toBe('api-secret-value');
      for (const name of ['llm_gateway_api_key', 'kaseki_api_keys']) {
        const mode = (await fs.stat(path.join(secretsDir, name))).mode & 0o777;
        expect(mode).toBe(0o600);
      }
    } finally {
      await fs.rm(secretRoot, { recursive: true, force: true });
    }
  });
});
