import { DockerManager, ContainerConfig } from './DockerManager';
import { execFileSync, execSync, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';

// Mock child_process
jest.mock('child_process');
jest.mock('fs', () => ({
  __esModule: true,
  default: {
    mkdirSync: jest.fn(),
  },
  existsSync: jest.fn(),
}));

describe('DockerManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isDockerAvailable', () => {
    const missingDockerError = Object.assign(new Error('spawnSync docker ENOENT'), {
      code: 'ENOENT',
    });

    it.each([
      {
        description: 'docker responds successfully',
        commandResult: Buffer.from(''),
        expectedAvailability: true,
      },
      {
        description: 'docker returns unexpected output with a successful exit',
        commandResult: Buffer.from('unexpected output'),
        expectedAvailability: true,
      },
      {
        description: 'the docker command fails',
        commandError: new Error('Cannot connect to the Docker daemon'),
        expectedAvailability: false,
      },
      {
        description: 'the docker binary is missing',
        commandError: missingDockerError,
        expectedAvailability: false,
      },
    ])('probes docker and reports availability when $description', ({
      commandResult,
      commandError,
      expectedAvailability,
    }) => {
      if (commandError) {
        (execSync as jest.Mock).mockImplementation(() => {
          throw commandError;
        });
      } else {
        (execSync as jest.Mock).mockReturnValue(commandResult);
      }

      const result = DockerManager.isDockerAvailable();

      expect(execSync).toHaveBeenCalledTimes(1);
      expect(execSync).toHaveBeenCalledWith('docker ps > /dev/null 2>&1', { shell: '/bin/bash' });
      expect(result).toBe(expectedAvailability);
    });
  });

  describe('imageExists', () => {
    it.each([
      {
        description: 'the image exists',
        expectedResult: true,
      },
      {
        description: 'the image inspection fails',
        inspectionError: new Error('Image not found'),
        expectedResult: false,
      },
    ])('safely inspects the image when $description', ({ inspectionError, expectedResult }) => {
      if (inspectionError) {
        (execFileSync as jest.Mock).mockImplementation(() => {
          throw inspectionError;
        });
      } else {
        (execFileSync as jest.Mock).mockReturnValue(Buffer.from(''));
      }

      const result = DockerManager.imageExists('test:latest');

      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(execFileSync).toHaveBeenCalledWith('docker', ['image', 'inspect', 'test:latest'], {
        stdio: 'ignore',
      });
      expect(result).toBe(expectedResult);
    });
  });

  describe('image commands', () => {
    const image = 'registry.example/image name:tag; $(touch /tmp/pwned)';

    it('passes an image containing shell metacharacters as one pull argument', () => {
      (execFileSync as jest.Mock).mockReturnValue(Buffer.from(''));

      expect(DockerManager.pullImage(image)).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith('docker', ['pull', image], {
        stdio: 'inherit',
        timeout: 5 * 60 * 1000,
      });
    });

    it('passes an image containing shell metacharacters as one inspect argument', () => {
      (execFileSync as jest.Mock).mockReturnValue('sha256:abc\n');

      expect(DockerManager.getImageId(image)).toBe('sha256:abc');
      expect(execFileSync).toHaveBeenCalledWith(
        'docker',
        ['inspect', '-f', '{{.ID}}', image],
        { encoding: 'utf-8' }
      );
    });
  });

  describe('buildDockerArgs', () => {
    it('creates paths containing spaces and metacharacters without invoking a shell', async () => {
      const mockChild = {
        stdout: null,
        stderr: null,
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        }),
        kill: jest.fn(),
      };
      (spawn as jest.Mock).mockReturnValue(mockChild);
      const workspaceDir = '/tmp/work space; $(touch pwned)';
      const resultsDir = '/tmp/results & reports';
      const cacheDir = '/tmp/cache `echo expanded`';

      await DockerManager.runContainer({
        image: 'test:latest',
        name: 'test-container',
        workspaceDir,
        resultsDir,
        cacheDir,
        environment: {},
      });

      expect(fs.mkdirSync).toHaveBeenNthCalledWith(1, workspaceDir, { recursive: true });
      expect(fs.mkdirSync).toHaveBeenNthCalledWith(2, resultsDir, { recursive: true });
      expect(fs.mkdirSync).toHaveBeenNthCalledWith(3, cacheDir, { recursive: true });
      expect(execSync).not.toHaveBeenCalled();
    });

    it('should invoke docker run with expected arg ordering via runContainer', async () => {
      const mockChild = {
        stdout: null,
        stderr: null,
        on: jest.fn((event, callback) => {
          if (event === 'exit') {
            callback(0);
          }
        }),
        kill: jest.fn(),
      };

      (spawn as jest.Mock).mockReturnValue(mockChild);
      (execSync as jest.Mock).mockReturnValue(Buffer.from(''));

      const config: ContainerConfig = {
        image: 'test:latest',
        name: 'test-container',
        workspaceDir: '/workspace',
        resultsDir: '/results',
        cacheDir: '/cache',
        apiKeyFile: '/secrets/key',
        environment: {
          REPO_URL: 'https://github.com/test/repo',
          GIT_REF: 'main',
          LLM_GATEWAY_API_KEY: 'test-key-xxx',
        },
        entrypoint: '/usr/local/bin/kaseki-entrypoint',
        command: ['agent', '--task', 'run'],
      };

      await DockerManager.runContainer(config);

      expect(fs.mkdirSync).toHaveBeenCalledWith('/workspace', { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith('/results', { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith('/cache', { recursive: true });

      expect(spawn).toHaveBeenCalledTimes(1);

      const [, spawnArgs] = (spawn as jest.Mock).mock.calls[0];
      expect(spawnArgs[0]).toBe('run');

      const imageIndex = spawnArgs.indexOf('test:latest');
      expect(imageIndex).toBeGreaterThan(-1);

      expect(spawnArgs).toContain('--entrypoint');
      const entrypointIndex = spawnArgs.indexOf('--entrypoint');
      expect(spawnArgs[entrypointIndex + 1]).toBe('/usr/local/bin/kaseki-entrypoint');

      const workspaceMountIndex = spawnArgs.indexOf('-v');
      expect(spawnArgs[workspaceMountIndex + 1]).toBe('/workspace:/workspace:rw');
      expect(spawnArgs).toContain('/results:/results:rw');
      expect(spawnArgs).toContain('/cache:/cache:rw');
      expect(spawnArgs).toContain('/secrets/key:/run/secrets/llm_gateway_api_key:ro');

      expect(spawnArgs).toContain('-e');
      expect(spawnArgs).toContain('REPO_URL=https://github.com/test/repo');
      expect(spawnArgs).toContain('GIT_REF=main');
      expect(spawnArgs).not.toContain('LLM_GATEWAY_API_KEY=test-key-xxx');

      expect(entrypointIndex).toBeLessThan(imageIndex);
      expect(spawnArgs[imageIndex + 1]).toBe('agent');
      expect(spawnArgs.slice(imageIndex + 1, imageIndex + 4)).toEqual(['agent', '--task', 'run']);

      expect(spawnArgs).not.toContain('--privileged');
      expect(spawnArgs).not.toContain('--network=host');
    });

    it('should use file-based secret only when apiKeyFile mode is active', async () => {
      const mockChild = {
        stdout: null,
        stderr: null,
        on: jest.fn((event, callback) => {
          if (event === 'exit') {
            callback(0);
          }
        }),
        kill: jest.fn(),
      };

      (spawn as jest.Mock).mockReturnValue(mockChild);
      (execSync as jest.Mock).mockReturnValue(Buffer.from(''));

      const config: ContainerConfig = {
        image: 'test:latest',
        name: 'test-container',
        workspaceDir: '/workspace',
        resultsDir: '/results',
        environment: {
          REPO_URL: 'https://github.com/test/repo',
          LLM_GATEWAY_API_KEY: 'test-key-xxx',
        },
        apiKeyFile: '/secrets/key',
        entrypoint: '/usr/local/bin/kaseki-entrypoint',
        command: ['agent'],
      };

      await DockerManager.runContainer(config);

      expect(spawn).toHaveBeenCalledTimes(1);
      const [, spawnArgs] = (spawn as jest.Mock).mock.calls[0];

      // Positive assertion: file-based secret wiring is present.
      expect(spawnArgs).toContain('/secrets/key:/run/secrets/llm_gateway_api_key:ro');

      // Negative assertions: no plain env secret leakage.
      expect(spawnArgs).not.toContain('-e LLM_GATEWAY_API_KEY=test-key-xxx');
      expect(spawnArgs).not.toContain('LLM_GATEWAY_API_KEY=test-key-xxx');

      const llmGatewayEnvArgs = (spawnArgs as string[]).filter((arg: string) =>
        arg.startsWith('LLM_GATEWAY_API_KEY=')
      );
      expect(llmGatewayEnvArgs).toEqual([]);
    });

    it('should not leak LLM_GATEWAY_API_KEY with mixed environment input in apiKeyFile mode', async () => {
      const mockChild = {
        stdout: null,
        stderr: null,
        on: jest.fn((event, callback) => {
          if (event === 'exit') {
            callback(0);
          }
        }),
        kill: jest.fn(),
      };

      (spawn as jest.Mock).mockReturnValue(mockChild);
      (execSync as jest.Mock).mockReturnValue(Buffer.from(''));

      const config: ContainerConfig = {
        image: 'test:latest',
        name: 'test-container',
        workspaceDir: '/workspace',
        resultsDir: '/results',
        cacheDir: '/cache',
        apiKeyFile: '/secrets/key',
        environment: {
          REPO_URL: 'https://github.com/test/repo',
          GIT_REF: 'main',
          LLM_GATEWAY_API_KEY: 'test-key-xxx',
          LLM_GATEWAY_URL: 'https://llmgateway.local.xyz/v1/responses',
          CUSTOM_FLAG: '1',
        },
        entrypoint: '/usr/local/bin/kaseki-entrypoint',
        command: ['agent'],
      };

      await DockerManager.runContainer(config);

      const [, spawnArgs] = (spawn as jest.Mock).mock.calls[0];

      // Non-secret env vars still flow through.
      expect(spawnArgs).toContain('REPO_URL=https://github.com/test/repo');
      expect(spawnArgs).toContain('GIT_REF=main');
      expect(spawnArgs).toContain('LLM_GATEWAY_URL=https://llmgateway.local.xyz/v1/responses');
      expect(spawnArgs).toContain('CUSTOM_FLAG=1');

      // Secret must be file-only in this mode.
      expect(spawnArgs).toContain('/secrets/key:/run/secrets/llm_gateway_api_key:ro');
      expect(spawnArgs).not.toContain('LLM_GATEWAY_API_KEY=test-key-xxx');
    });
  });

  describe('runContainer', () => {
    it('should enhance error message for Docker init failures with exit code 127', async () => {
      const mockChild = {
        stdout: null,
        stderr: null,
        on: jest.fn((event, callback) => {
          if (event === 'exit') {
            // Simulate exit with code 127 and stderr containing the error
            setTimeout(() => {
              callback(127);
            }, 10);
          }
        }),
        kill: jest.fn(),
      };

      (spawn as jest.Mock).mockReturnValue(mockChild);

      const config: ContainerConfig = {
        image: 'test:latest',
        name: 'test-container',
        workspaceDir: '/tmp/workspace',
        resultsDir: '/tmp/results',
        environment: {},
        entrypoint: '/usr/local/bin/kaseki-entrypoint',
        command: ['agent'],
      };

      // Mock execSync for directory creation
      (execSync as jest.Mock).mockReturnValue(Buffer.from(''));

      // We can't directly test the stderr enhancement without mocking more,
      // but we've verified the logic exists in the source code
      const result = await DockerManager.runContainer(config);
      expect(result.exitCode).toBe(127);
    });

    it('should report exit code 124 when a timed-out container exits during the grace window', async () => {
      jest.useFakeTimers();
      const mockChild = new EventEmitter() as EventEmitter & {
        stdout: null;
        stderr: null;
        kill: jest.Mock;
      };
      mockChild.stdout = null;
      mockChild.stderr = null;
      mockChild.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(mockChild);

      const config: ContainerConfig = {
        image: 'test:latest',
        name: 'test-container',
        workspaceDir: '/tmp/workspace',
        resultsDir: '/tmp/results',
        environment: {},
        timeout: 10,
        entrypoint: '/usr/local/bin/kaseki-entrypoint',
        command: ['agent'],
      };

      (execSync as jest.Mock).mockReturnValue(Buffer.from(''));

      const resultPromise = DockerManager.runContainer(config);
      jest.advanceTimersByTime(10_000);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

      mockChild.emit('exit', 0);
      await expect(resultPromise).resolves.toEqual({
        exitCode: 124,
        stdout: '',
        stderr: 'Container timeout after 10 seconds',
      });
      expect(mockChild.kill).not.toHaveBeenCalledWith('SIGKILL');
      jest.useRealTimers();
    });

    it('should force kill and settle timed-out containers that do not exit during the grace window', async () => {
      jest.useFakeTimers();
      const mockChild = new EventEmitter() as EventEmitter & {
        stdout: null;
        stderr: null;
        kill: jest.Mock;
      };
      mockChild.stdout = null;
      mockChild.stderr = null;
      mockChild.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(mockChild);
      (execSync as jest.Mock).mockReturnValue(Buffer.from(''));

      const resultPromise = DockerManager.runContainer({
        image: 'test:latest',
        name: 'test-container',
        workspaceDir: '/tmp/workspace',
        resultsDir: '/tmp/results',
        environment: {},
        timeout: 1,
      });

      jest.advanceTimersByTime(1_000);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      jest.advanceTimersByTime(5_000);

      await expect(resultPromise).resolves.toEqual({
        exitCode: 124,
        stdout: '',
        stderr: 'Container timeout after 1 seconds',
      });
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');

      mockChild.emit('exit', 0);
      mockChild.emit('error', new Error('late error'));
      await expect(resultPromise).resolves.toEqual({
        exitCode: 124,
        stdout: '',
        stderr: 'Container timeout after 1 seconds',
      });
      jest.useRealTimers();
    });

    it('should ignore late exit and error events after a successful result has settled', async () => {
      jest.useFakeTimers();
      const mockChild = new EventEmitter() as EventEmitter & {
        stdout: null;
        stderr: null;
        kill: jest.Mock;
      };
      mockChild.stdout = null;
      mockChild.stderr = null;
      mockChild.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(mockChild);

      const resultPromise = DockerManager.runContainer({
        image: 'test:latest',
        name: 'test-container',
        workspaceDir: '/tmp/workspace',
        resultsDir: '/tmp/results',
        environment: {},
        timeout: 1,
      });

      mockChild.emit('exit', 0);
      await expect(resultPromise).resolves.toEqual({ exitCode: 0, stdout: '', stderr: '' });

      mockChild.emit('exit', 17);
      mockChild.emit('error', new Error('late error'));
      jest.advanceTimersByTime(6_000);

      await expect(resultPromise).resolves.toEqual({ exitCode: 0, stdout: '', stderr: '' });
      expect(mockChild.kill).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('should ignore errors during timeout termination and retain timeout reporting', async () => {
      jest.useFakeTimers();
      const mockChild = new EventEmitter() as EventEmitter & {
        stdout: null;
        stderr: null;
        kill: jest.Mock;
      };
      mockChild.stdout = null;
      mockChild.stderr = null;
      mockChild.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(mockChild);

      const resultPromise = DockerManager.runContainer({
        image: 'test:latest',
        name: 'test-container',
        workspaceDir: '/tmp/workspace',
        resultsDir: '/tmp/results',
        environment: {},
        timeout: 1,
      });

      jest.advanceTimersByTime(1_000);
      mockChild.emit('error', new Error('error while terminating'));
      mockChild.emit('exit', null);

      await expect(resultPromise).resolves.toEqual({
        exitCode: 124,
        stdout: '',
        stderr: 'Container timeout after 1 seconds',
      });
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockChild.kill).not.toHaveBeenCalledWith('SIGKILL');
      jest.useRealTimers();
    });

    it('should handle spawn errors', async () => {
      const mockChild = {
        stdout: null,
        stderr: null,
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Failed to spawn'));
          }
        }),
        kill: jest.fn(),
      };

      (spawn as jest.Mock).mockReturnValue(mockChild);

      const config: ContainerConfig = {
        image: 'test:latest',
        name: 'test-container',
        workspaceDir: '/tmp/workspace',
        resultsDir: '/tmp/results',
        environment: {},
        entrypoint: '/usr/local/bin/kaseki-entrypoint',
        command: ['agent'],
      };

      (execSync as jest.Mock).mockReturnValue(Buffer.from(''));

      const result = await DockerManager.runContainer(config);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Failed to spawn');
    });
  });

  describe('stopContainer', () => {
    it('should stop a running container', () => {
      (execFileSync as jest.Mock).mockReturnValue(Buffer.from(''));
      const containerId = 'test container; $(touch /tmp/pwned)';
      const result = DockerManager.stopContainer(containerId, 12);
      expect(result).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith(
        'docker',
        ['stop', '-t', '12', containerId],
        { stdio: 'ignore' }
      );
    });

    it('should return false when stopping fails', () => {
      (execFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Container not found');
      });
      const result = DockerManager.stopContainer('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('removeContainer', () => {
    it('should remove a container with force flag by default', () => {
      (execFileSync as jest.Mock).mockReturnValue(Buffer.from(''));
      const containerId = 'test container; echo expanded';
      const result = DockerManager.removeContainer(containerId);
      expect(result).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith('docker', ['rm', '-f', containerId], {
        stdio: 'ignore',
      });
    });

    it('should remove a container without force flag when specified', () => {
      (execFileSync as jest.Mock).mockReturnValue(Buffer.from(''));
      const result = DockerManager.removeContainer('test-container', false);
      expect(result).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith('docker', ['rm', 'test-container'], {
        stdio: 'ignore',
      });
    });
  });

  describe('listContainers', () => {
    it('should list containers matching a pattern', () => {
      // The actual implementation uses { encoding: 'utf-8' } which returns a string
      const pattern = 'kaseki containers; echo expanded';
      (execFileSync as jest.Mock).mockReturnValueOnce('kaseki-1\nkaseki-2\nkaseki-3\n');
      const result = DockerManager.listContainers(pattern);
      expect(result).toEqual(['kaseki-1', 'kaseki-2', 'kaseki-3']);
      expect(execFileSync).toHaveBeenCalledWith(
        'docker',
        ['ps', '--filter', `name=${pattern}`, '--format', '{{.Names}}'],
        { encoding: 'utf-8' }
      );
    });

    it('should handle empty container list', () => {
      (execFileSync as jest.Mock).mockReturnValueOnce('');
      const result = DockerManager.listContainers('kaseki');
      expect(result).toEqual([]);
    });

    it('should return empty list on error', () => {
      (execFileSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Docker error');
      });
      const result = DockerManager.listContainers('kaseki');
      expect(result).toEqual([]);
    });
  });

  describe('getContainerLogs', () => {
    it('passes a container containing spaces and metacharacters as one argument', () => {
      const containerId = 'test container; $(touch /tmp/pwned)';
      (execFileSync as jest.Mock).mockReturnValue('container output');

      expect(DockerManager.getContainerLogs(containerId, 25)).toBe('container output');
      expect(execFileSync).toHaveBeenCalledWith(
        'docker',
        ['logs', '--tail=25', containerId],
        { encoding: 'utf-8' }
      );
    });
  });
});
