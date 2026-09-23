import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { resolveGatewayApiKey, resolveGatewayMaxTokens } from './.extensions';
import piExtension from './.extensions';

describe('.extensions - CloudFlare Gateway Configuration', () => {
  describe('resolveGatewayApiKey', () => {
    const originalEnv = { ...process.env };
    const tempDirs: string[] = [];

    const createTempDir = () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-test-'));
      tempDirs.push(tempDir);
      return tempDir;
    };

    afterEach(() => {
      for (const tempDir of tempDirs.splice(0)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      // Restore original environment
      process.env = { ...originalEnv };
      delete process.env.LLM_GATEWAY_API_KEY;
      delete process.env.LLM_GATEWAY_API_KEY_FILE;
      delete process.env.HOME;
    });

    it('returns API key from LLM_GATEWAY_API_KEY environment variable', () => {
      process.env.LLM_GATEWAY_API_KEY = 'env-key-12345';
      expect(resolveGatewayApiKey()).toBe('env-key-12345');
    });

    it('prefers LLM_GATEWAY_API_KEY over file when both are set', () => {
      process.env.LLM_GATEWAY_API_KEY = 'env-key';
      process.env.LLM_GATEWAY_API_KEY_FILE = '/nonexistent/file';
      expect(resolveGatewayApiKey()).toBe('env-key');
    });

    it('reads API key from file when env var not set', () => {
      const tempDir = createTempDir();
      const keyFile = path.join(tempDir, 'api-key.txt');
      fs.writeFileSync(keyFile, 'file-key-67890\n');

      process.env.LLM_GATEWAY_API_KEY_FILE = keyFile;
      expect(resolveGatewayApiKey()).toBe('file-key-67890');
    });

    it('trims whitespace from file content', () => {
      const tempDir = createTempDir();
      const keyFile = path.join(tempDir, 'api-key.txt');
      fs.writeFileSync(keyFile, '  trimmed-key  \n\n');

      process.env.LLM_GATEWAY_API_KEY_FILE = keyFile;
      expect(resolveGatewayApiKey()).toBe('trimmed-key');
    });

    it('expands ~ to HOME directory in file path', () => {
      const tempDir = createTempDir();
      const keyFile = path.join(tempDir, 'api-key.txt');
      fs.writeFileSync(keyFile, 'home-expanded-key');

      process.env.HOME = tempDir;
      process.env.LLM_GATEWAY_API_KEY_FILE = `${tempDir}/api-key.txt`;

      expect(resolveGatewayApiKey()).toBe('home-expanded-key');
    });

    it('returns empty string when file does not exist', () => {
      process.env.LLM_GATEWAY_API_KEY_FILE = '/nonexistent/file/path';
      expect(resolveGatewayApiKey()).toBe('');
    });

    it('returns empty string when neither env var nor file is configured', () => {
      delete process.env.LLM_GATEWAY_API_KEY;
      delete process.env.LLM_GATEWAY_API_KEY_FILE;
      expect(resolveGatewayApiKey()).toBe('');
    });

    it('returns empty string when file contains only whitespace', () => {
      const tempDir = createTempDir();
      const keyFile = path.join(tempDir, 'api-key.txt');
      fs.writeFileSync(keyFile, '   \n\n   ');

      process.env.LLM_GATEWAY_API_KEY_FILE = keyFile;
      expect(resolveGatewayApiKey()).toBe('');
    });

    it('handles file read errors gracefully', () => {
      process.env.LLM_GATEWAY_API_KEY_FILE = '/root/forbidden/file';
      // This should not throw; instead return empty string
      expect(() => resolveGatewayApiKey()).not.toThrow();
      expect(resolveGatewayApiKey()).toBe('');
    });

    it('reads a plain-text API key from the default ~/.kaseki/secrets.json path', () => {
      const tempDir = createTempDir();
      delete process.env.LLM_GATEWAY_API_KEY;
      delete process.env.LLM_GATEWAY_API_KEY_FILE;
      process.env.HOME = tempDir;

      const defaultFile = path.join(tempDir, '.kaseki', 'secrets.json');
      fs.mkdirSync(path.dirname(defaultFile), { recursive: true });
      fs.writeFileSync(defaultFile, 'distinctive-default-gateway-key\n');

      expect(resolveGatewayApiKey()).toBe('distinctive-default-gateway-key');
    });

    it('handles empty LLM_GATEWAY_API_KEY_FILE as falsy', () => {
      process.env.LLM_GATEWAY_API_KEY_FILE = '';
      delete process.env.LLM_GATEWAY_API_KEY;
      expect(resolveGatewayApiKey()).toBe('');
    });
  });

  describe('resolveGatewayMaxTokens', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      delete process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS;
    });

    it('returns configured max tokens from environment', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '8192';
      expect(resolveGatewayMaxTokens()).toBe(8192);
    });

    it('returns default 4096 when not configured', () => {
      delete process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS;
      expect(resolveGatewayMaxTokens()).toBe(4096);
    });

    it('returns default when value is 0', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '0';
      expect(resolveGatewayMaxTokens()).toBe(4096);
    });

    it('returns default when value is negative', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '-100';
      expect(resolveGatewayMaxTokens()).toBe(4096);
    });

    it('returns default when value is not a valid integer', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = 'abc';
      expect(resolveGatewayMaxTokens()).toBe(4096);
    });

    it('returns default for NaN value', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = 'NaN';
      expect(resolveGatewayMaxTokens()).toBe(4096);
    });

    it('returns default for Infinity value', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = 'Infinity';
      expect(resolveGatewayMaxTokens()).toBe(4096);
    });

    it('parses large valid token counts', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '128000';
      expect(resolveGatewayMaxTokens()).toBe(128000);
    });

    it('parses token count with whitespace', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '  2048  ';
      expect(resolveGatewayMaxTokens()).toBe(2048);
    });

    it('ignores decimal values (parses as integer)', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '1024.5';
      expect(resolveGatewayMaxTokens()).toBe(1024); // parseInt truncates
    });

    it('handles empty string', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '';
      expect(resolveGatewayMaxTokens()).toBe(4096);
    });

    it('handles very large numbers within safe integer range', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = String(Number.MAX_SAFE_INTEGER);
      expect(resolveGatewayMaxTokens()).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('handles hexadecimal notation as invalid', () => {
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '0xFF';
      // parseInt('0xFF', 10) returns NaN in base 10
      expect(resolveGatewayMaxTokens()).toBe(4096);
    });
  });

  describe('Pi extension registration', () => {
    it('registers provider when LLM_GATEWAY_URL is set', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      process.env.LLM_GATEWAY_URL = 'https://api.example.com/v1';
      process.env.LLM_GATEWAY_API_KEY = 'test-key';
      process.env.LLM_GATEWAY_MODEL = 'gpt-4';

      piExtension(mockPi);

      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        'gateway',
        expect.objectContaining({
          name: 'LLM Gateway (CloudFlare)',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          api: 'openai-completions',
        }),
      );
    });

    it('does not register provider when LLM_GATEWAY_URL is not set', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      delete process.env.LLM_GATEWAY_URL;

      piExtension(mockPi);

      expect(mockPi.registerProvider).not.toHaveBeenCalled();
    });

    it('uses default model when not configured', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      process.env.LLM_GATEWAY_URL = 'https://api.example.com/v1';
      delete process.env.LLM_GATEWAY_MODEL;
      process.env.LLM_GATEWAY_API_KEY = 'key';

      piExtension(mockPi);

      const call = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      expect(call[1].models[0].id).toBe('dynamic/kaseki-agent');
    });

    it('uses configured model when set', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      process.env.LLM_GATEWAY_URL = 'https://api.example.com/v1';
      process.env.LLM_GATEWAY_MODEL = 'claude-3-opus';
      process.env.LLM_GATEWAY_API_KEY = 'key';

      piExtension(mockPi);

      const call = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      expect(call[1].models[0].id).toBe('claude-3-opus');
    });

    it('includes CloudFlare-specific headers for CloudFlare gateway', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      process.env.LLM_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/abc123/default/compat';
      process.env.LLM_GATEWAY_API_KEY = 'cf-token';
      process.env.KASEKI_INSTANCE = 'kaseki-42';
      process.env.KASEKI_INFERENCE_PHASE = 'scouting';

      piExtension(mockPi);

      const call = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const config = call[1];

      expect(config.headers).toBeDefined();
      expect(config.headers['cf-aig-authorization']).toBe('Bearer cf-token');
    });

    it('does not include CloudFlare headers for non-CloudFlare gateway', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      process.env.LLM_GATEWAY_URL = 'https://api.example.com/v1';
      process.env.LLM_GATEWAY_API_KEY = 'key';

      piExtension(mockPi);

      const call = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const config = call[1];

      expect(config.headers).toBeUndefined();
    });

    it('includes metadata in CloudFlare headers', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      process.env.LLM_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/abc/default/compat';
      process.env.LLM_GATEWAY_API_KEY = 'key';
      process.env.KASEKI_INSTANCE = 'kaseki-99';
      process.env.KASEKI_INFERENCE_PHASE = 'validation';
      process.env.KASEKI_INFERENCE_ATTEMPT = '2';

      piExtension(mockPi);

      const call = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const metadata = JSON.parse(call[1].headers['cf-aig-metadata']);

      expect(metadata.run_id).toBe('kaseki-99');
      expect(metadata.phase).toBe('validation');
      expect(metadata.attempt).toBe('2');
      expect(metadata.component).toBe('kaseki-agent');
    });

    it('uses sensible defaults for missing metadata fields', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      process.env.LLM_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/abc/default/compat';
      process.env.LLM_GATEWAY_API_KEY = 'key';
      delete process.env.KASEKI_INSTANCE;
      delete process.env.KASEKI_INFERENCE_PHASE;
      delete process.env.KASEKI_INFERENCE_ATTEMPT;
      delete process.env.KASEKI_INFERENCE_REQUEST_ID;

      piExtension(mockPi);

      const call = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const metadata = JSON.parse(call[1].headers['cf-aig-metadata']);

      expect(metadata.run_id).toBe('unknown');
      expect(metadata.phase).toBe('unknown');
      expect(metadata.attempt).toBe('unknown');
      expect(metadata.request_id).toBe('unknown');
    });

    it('sets model configuration correctly', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      process.env.LLM_GATEWAY_URL = 'https://api.example.com/v1';
      process.env.LLM_GATEWAY_API_KEY = 'key';
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '2048';

      piExtension(mockPi);

      const call = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const model = call[1].models[0];

      expect(model.reasoning).toBe(false);
      expect(model.input).toContain('text');
      expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      expect(model.contextWindow).toBe(128000);
      expect(model.maxTokens).toBe(2048);
    });

    it('handles missing API key gracefully', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      process.env.LLM_GATEWAY_URL = 'https://api.example.com/v1';
      delete process.env.LLM_GATEWAY_API_KEY;
      delete process.env.LLM_GATEWAY_API_KEY_FILE;

      piExtension(mockPi);

      const call = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      // Should register with empty or placeholder key
      expect(call[1].apiKey).toBeDefined();
    });
  });

  describe('Integration scenarios', () => {
    it('processes full CloudFlare gateway configuration flow', () => {
      const mockPi = {
        registerProvider: jest.fn(),
      } as unknown as ExtensionAPI;

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-integration-'));
      const keyFile = path.join(tempDir, 'api-key');
      fs.writeFileSync(keyFile, 'integration-test-key\n');

      process.env.LLM_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/cid/default/compat';
      process.env.LLM_GATEWAY_API_KEY_FILE = keyFile;
      process.env.LLM_GATEWAY_MODEL = 'gpt-4-turbo';
      process.env.LLM_GATEWAY_MAX_OUTPUT_TOKENS = '4096';
      process.env.KASEKI_INSTANCE = 'kaseki-integration';

      piExtension(mockPi);

      const call = (mockPi.registerProvider as jest.Mock).mock.calls[0];
      const config = call[1];

      expect(config.apiKey).toBe('integration-test-key');
      expect(config.models[0].id).toBe('gpt-4-turbo');
      expect(config.models[0].maxTokens).toBe(4096);
      expect(config.headers['cf-aig-authorization']).toBe('Bearer integration-test-key');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    });
  });
});
