import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { createGatewayProviderConfig } from '../src/gateway/create-provider-config.js';

describe('Pi gateway provider configuration', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    temporaryDirectories.splice(0).forEach((directory) => {
      rmSync(directory, { recursive: true, force: true });
    });
  });

  it('creates provider configuration from an isolated environment and key file', () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'pi-gateway-provider-'));
    temporaryDirectories.push(temporaryDirectory);
    const keyFile = path.join(temporaryDirectory, 'gateway-key');
    writeFileSync(keyFile, '  file-backed-gateway-key\n', 'utf8');

    const config = createGatewayProviderConfig(
      {
        LLM_GATEWAY_URL: 'https://gateway.example.invalid/v1',
        LLM_GATEWAY_API_KEY_FILE: keyFile,
        LLM_GATEWAY_MODEL: 'fixture/gateway-model',
      },
      readFileSync
    );

    expect(config).toBeDefined();
    expect(config?.name).toBe('LLM Gateway (CloudFlare)');
    expect(config?.baseUrl).toBe('https://gateway.example.invalid/v1');
    expect(config?.api).toBe('openai-completions');
    expect(config?.models[0].id).toBe('fixture/gateway-model');
    expect(config?.apiKey).toBe('file-backed-gateway-key');
  });
});
