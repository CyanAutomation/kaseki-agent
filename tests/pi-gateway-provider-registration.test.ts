import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

type RegisteredProvider = {
  name: string;
  config: {
    apiKey?: string;
    baseUrl?: string;
    api?: string;
    models?: Array<{ id?: string }>;
  };
};

describe('Pi gateway provider registration from .pi-extensions.js', () => {
  const originalEnv = {
    LLM_GATEWAY_URL: process.env.LLM_GATEWAY_URL,
    LLM_GATEWAY_API_KEY: process.env.LLM_GATEWAY_API_KEY,
    LLM_GATEWAY_API_KEY_FILE: process.env.LLM_GATEWAY_API_KEY_FILE,
    LLM_GATEWAY_MODEL: process.env.LLM_GATEWAY_MODEL,
    LLM_GATEWAY_MAX_OUTPUT_TOKENS: process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS,
    KASEKI_GATEWAY_DIAGNOSTICS_PATH: process.env.KASEKI_GATEWAY_DIAGNOSTICS_PATH,
    KASEKI_RESULTS_DIR: process.env.KASEKI_RESULTS_DIR,
  };

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'pi-gateway-provider-'));
    process.env.LLM_GATEWAY_URL = 'https://gateway.example.invalid/v1';
    delete process.env.LLM_GATEWAY_API_KEY;
    delete process.env.LLM_GATEWAY_MODEL;
    delete process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS;
    process.env.KASEKI_GATEWAY_DIAGNOSTICS_PATH = path.join(tmpDir, '.gateway-diagnostics.jsonl');
    delete process.env.KASEKI_RESULTS_DIR;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('registers gateway provider configuration from LLM_GATEWAY_API_KEY_FILE', async () => {
    const keyFile = path.join(tmpDir, 'llm_gateway_api_key');
    writeFileSync(keyFile, 'file-backed-gateway-key\n', 'utf8');
    chmodSync(keyFile, 0o600);
    process.env.LLM_GATEWAY_API_KEY_FILE = keyFile;

    let registered: RegisteredProvider | undefined;
    const pi = {
      registerProvider: jest.fn((name: string, config: RegisteredProvider['config']) => {
        registered = { name, config };
      }),
    };

    const source = readFileSync(path.join(process.cwd(), '.pi-extensions.js'), 'utf8')
      .replace("import fs from 'node:fs';", '')
      .replace("import path from 'node:path';", '')
      .replace('export default function (pi)', 'module.exports.default = function (pi)');
    const module = { exports: {} as { default?: (pi: typeof pi) => void } };

    const fsModule = await import('node:fs');
    
    vm.runInNewContext(source, {
      module,
      exports: module.exports,
      process,
      fs: fsModule,
      path,
      Date,
      JSON,
      Boolean,
      Number,
      Array,
    }, { filename: '.pi-extensions.js' });

    module.exports.default?.(pi);

    expect(registered).toBeDefined();
    expect(registered?.name).toBe('gateway');
    expect(registered?.config.apiKey).toBe('file-backed-gateway-key');
    expect(registered?.config.baseUrl).toBe('https://gateway.example.invalid/v1');
    expect(registered?.config.api).toBe('openai-completions');
    expect(registered?.config.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'dynamic/kaseki-agent' }),
      ])
    );
  });
});
