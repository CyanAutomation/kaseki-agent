import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigManager } from '../../config/ConfigManager';
import { QuickstartCommand } from './QuickstartCommand';
import type { DiscoveredSecrets } from '../resolvers/SecretResolver';

describe('QuickstartCommand credential requirements', () => {
  const gatewayUrlBefore = process.env.LLM_GATEWAY_URL;
  let command: QuickstartCommand;
  let errorLog: jest.SpyInstance;
  let normalLog: jest.SpyInstance;
  let launch: jest.Mock;

  beforeEach(() => {
    process.env.LLM_GATEWAY_URL = 'https://gateway.example/v1';
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    normalLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    command = new QuickstartCommand(new ConfigManager());
    const secrets: DiscoveredSecrets = {
      llmGatewayKeyFile: { filePath: '/home/pi/secrets/llm_gateway_api_key', source: '~/secrets' },
      githubAppIdFile: null,
      githubAppClientIdFile: null,
      githubAppPrivateKeyFile: null,
      kasekiApiKeysFile: { filePath: '/home/pi/secrets/kaseki_api_keys', source: '~/secrets' },
    };
    launch = jest.fn(() => ({ ok: true }));
    (command as any).environmentValidator = {
      check: () => ({ hasDocker: true, nodeVersion: 'v24.0.0', hasSudo: true, agentsWritable: true }),
      printSummary: jest.fn(),
    };
    (command as any).secretResolver = {
      discover: () => secrets,
      printSummary: jest.fn(),
      readApiKey: () => 'test-api-key',
    };
    (command as any).agentsBootstrapper = {
      writeConfig: jest.fn(async () => undefined),
      bootstrap: jest.fn(async () => ({ ok: true })),
    };
    (command as any).containerLauncher = {
      launch,
      waitForReadiness: jest.fn(async () => ({ ok: true })),
      smokeTest: jest.fn(async () => ({ ok: true })),
    };
  });

  afterEach(() => {
    if (gatewayUrlBefore === undefined) delete process.env.LLM_GATEWAY_URL;
    else process.env.LLM_GATEWAY_URL = gatewayUrlBefore;
    errorLog.mockRestore();
    normalLog.mockRestore();
  });

  it('starts without GitHub App credentials and does not pass the API token to Docker', async () => {
    await expect(command.execute([])).resolves.toBe(0);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      llmGatewayKeyFile: '/home/pi/secrets/llm_gateway_api_key',
      kasekiApiKeysFile: '/home/pi/secrets/kaseki_api_keys',
    }));
    expect(JSON.stringify(launch.mock.calls[0])).not.toContain('test-api-key');
  });

  it('fails before launch with a clear error when the gateway URL is missing', async () => {
    delete process.env.LLM_GATEWAY_URL;

    await expect(command.execute([])).resolves.toBe(1);
    expect(launch).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('LLM_GATEWAY_URL'));
  });
});
