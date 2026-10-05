import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { execSync, spawnSync } from 'child_process';
import { ContainerLauncher, buildDockerArgs } from './ContainerLauncher';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));

describe('buildDockerArgs', () => {
  it('keeps API credentials in mounted files and passes the selected gateway and image', () => {
    const args = buildDockerArgs({
      image: 'example/kaseki@sha256:abc123',
      secretsDir: '/home/pi/secrets',
      dockerGid: '985',
      gatewayUrl: 'https://gateway.example/v1',
      gatewayModel: 'vendor/model',
    });
    const joined = args.join('\n');

    expect(joined).toContain('KASEKI_IMAGE=example/kaseki@sha256:abc123');
    expect(joined).toContain('LLM_GATEWAY_URL=https://gateway.example/v1');
    expect(joined).toContain('LLM_GATEWAY_MODEL=vendor/model');
    expect(joined).toContain('KASEKI_API_MAX_CONCURRENT_RUNS=1');
    expect(joined).toContain('/home/pi/secrets:/run/secrets/kaseki:ro');
    expect(joined).not.toContain('KASEKI_API_KEYS=');
  });

  it('binds the published API port to loopback by default', () => {
    const args = buildDockerArgs({
      image: 'example/kaseki:latest',
      secretsDir: '/home/pi/secrets',
      dockerGid: '985',
    });

    expect(args).toContain('127.0.0.1:8080:8080');
  });

  describe('launch', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (execSync as jest.Mock).mockReturnValue('985\n');
      (spawnSync as jest.Mock).mockReturnValue({ status: 0, stderr: '' });
    });

    afterEach(() => {
      delete process.env.LLM_GATEWAY_URL;
      delete process.env.KASEKI_HOST_SECRETS_DIR;
    });

    it('does not delete an existing container before attempting to run', () => {
      const configManager = { get: jest.fn(() => 'kaseki:test') };
      const launcher = new ContainerLauncher(configManager as any);

      expect(launcher.launch()).toEqual({ ok: true });
      expect(spawnSync).toHaveBeenCalledTimes(1);
      expect(spawnSync).toHaveBeenCalledWith('docker', expect.arrayContaining(['run', '-d']), {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    });
  });
});
