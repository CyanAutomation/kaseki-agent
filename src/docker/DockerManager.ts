/**
 * Docker Manager
 *
 * Handles Docker operations: image pulling, container spawning, log streaming
 */

import { execFileSync, execSync, spawn } from 'child_process';
import { createLogger } from '../logger';

const logger = createLogger('docker');

export interface ContainerConfig {
  image: string;
  name: string;
  workspaceDir: string;
  resultsDir: string;
  cacheDir?: string;
  apiKeyFile?: string;
  environment: Record<string, string>;
  timeout?: number; // in seconds
  entrypoint?: string;
  command?: string[];
}

export interface ContainerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class DockerManager {
  /**
   * Check if Docker is available and daemon is running
   */
  static isDockerAvailable(): boolean {
    try {
      execSync('docker ps > /dev/null 2>&1', { shell: '/bin/bash' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pull Docker image (with retry logic)
   */
  static pullImage(image: string, maxRetries: number = 3): boolean {
    logger.info(`Pulling Docker image: ${image}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        execSync(`docker pull ${image}`, {
          stdio: 'inherit',
          timeout: 5 * 60 * 1000, // 5 minute timeout
        });
        logger.info(`Successfully pulled image: ${image}`);
        return true;
      } catch (error) {
        if (attempt < maxRetries) {
          logger.warn(`Pull attempt ${attempt} failed. Retrying...`);
        } else {
          logger.error(`Failed to pull image after ${maxRetries} attempts: ${error}`);
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Check if Docker image exists locally
   */
  static imageExists(image: string): boolean {
    try {
      execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Docker image ID
   */
  static getImageId(image: string): string | null {
    try {
      const id = execSync(`docker inspect -f '{{.ID}}' ${image}`, {
        encoding: 'utf-8',
      }).trim();
      return id || null;
    } catch {
      return null;
    }
  }

  /**
   * Run Docker container and stream output
   */
  static async runContainer(config: ContainerConfig): Promise<ContainerResult> {
    logger.debug(`Running container: ${config.name}`);

    // Ensure directories exist
    this.ensureDirectories(config.workspaceDir, config.resultsDir, config.cacheDir);

    // Build Docker run command
    const dockerArgs = this.buildDockerArgs(config);

    logger.debug(`Docker command: docker run ${dockerArgs.join(' ')}`);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const timeoutSeconds = config.timeout || 1200;
      const timeoutMs = timeoutSeconds * 1000;
      const forceKillGraceMs = 5000;
      let settled = false;
      let timedOut = false;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const finish = (result: ContainerResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        resolve(result);
      };

      const child = spawn('docker', ['run', ...dockerArgs], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      timeoutTimer = setTimeout(() => {
        timedOut = true;
        logger.warn(`Container timeout after ${timeoutSeconds} seconds`);
        child.kill('SIGTERM');

        forceKillTimer = setTimeout(() => {
          child.kill('SIGKILL');
          finish({
            exitCode: 124,
            stdout,
            stderr: `Container timeout after ${timeoutSeconds} seconds`,
          });
        }, forceKillGraceMs);
      }, timeoutMs);

      // Collect stdout
      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          const text = data.toString();
          stdout += text;
          // Also stream to console for real-time feedback
          process.stdout.write(text);
        });
      }

      // Collect stderr
      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          const text = data.toString();
          stderr += text;
          process.stderr.write(text);
        });
      }

      // Handle completion with enhanced error context
      child.on('exit', (code: number | null) => {
        if (timedOut) {
          finish({
            exitCode: 124,
            stdout,
            stderr: `Container timeout after ${timeoutSeconds} seconds`,
          });
          return;
        }

        // Check for Docker init errors in stderr
        if (code === 127 && stderr.includes('no such file or directory')) {
          const enhancedStderr =
            stderr +
            '\n\n❌ DOCKER INITIALIZATION FAILED\n' +
            'This usually means the Docker image is missing critical scripts or is corrupted.\n\n' +
            'Troubleshooting steps:\n' +
            '1. Pull the latest image:\n' +
            '   docker pull docker.io/cyanautomation/kaseki-agent:latest\n' +
            '2. Verify the image is healthy:\n' +
            '   kaseki-agent doctor\n' +
            '3. Try running again:\n' +
            '   kaseki-agent run <repo> <ref> <task>\n\n' +
            'If the problem persists, the image may need to be rebuilt locally:\n' +
            '   docker build -t kaseki-template:latest .';

          finish({
            exitCode: code ?? 1,
            stdout,
            stderr: enhancedStderr,
          });
        } else {
          finish({
            exitCode: code ?? 1,
            stdout,
            stderr,
          });
        }
      });

      // Handle errors
      child.on('error', (error: Error) => {
        logger.error(`Failed to spawn docker: ${error.message}`);
        finish({
          exitCode: 1,
          stdout,
          stderr: error.message,
        });
      });
    });
  }

  /**
   * Build Docker run arguments
   */
  private static buildDockerArgs(config: ContainerConfig): string[] {
    const args: string[] = [];

    // Container name
    args.push('--name', config.name);

    // Security flags (from run-kaseki.sh)
    args.push('--read-only');
    args.push('--cap-drop=ALL');
    args.push('--security-opt', 'no-new-privileges:true');
    args.push('-u', '10000:10000');

    // Temporary filesystems for writable areas
    args.push('--tmpfs', '/tmp:rw,nosuid,nodev,noexec');
    args.push('--tmpfs', '/var/tmp:rw,nosuid,nodev,noexec');
    args.push('--tmpfs', '/run:rw,nosuid,nodev,noexec');

    // Mount workspace (rw for agent to clone repo)
    args.push('-v', `${config.workspaceDir}:/workspace:rw`);

    // Mount results (rw for writing outputs)
    args.push('-v', `${config.resultsDir}:/results:rw`);

    // Mount cache if provided
    if (config.cacheDir) {
      args.push('-v', `${config.cacheDir}:/cache:rw`);
    }

    // Mount API key file (ro for security)
    if (config.apiKeyFile) {
      args.push('-v', `${config.apiKeyFile}:/run/secrets/llm_gateway_api_key:ro`);
    }

    // Set environment variables (never pass API key via env)
    for (const [key, value] of Object.entries(config.environment)) {
      if (key !== 'LLM_GATEWAY_API_KEY') {
        // Skip inline API key
        args.push('-e', `${key}=${value}`);
      }
    }

    // Set entrypoint if provided
    if (config.entrypoint) {
      args.push('--entrypoint', config.entrypoint);
    }

    // Image
    args.push(config.image);

    // Command and arguments
    if (config.command) {
      args.push(...config.command);
    }

    return args;
  }

  /**
   * Ensure required directories exist with correct permissions
   */
  private static ensureDirectories(
    workspaceDir: string,
    resultsDir: string,
    cacheDir?: string
  ): void {
    const dirs = [workspaceDir, resultsDir];
    if (cacheDir) {
      dirs.push(cacheDir);
    }

    for (const dir of dirs) {
      try {
        execSync(`mkdir -p "${dir}"`, { shell: '/bin/bash' });
        logger.debug(`Created/verified directory: ${dir}`);
      } catch (error) {
        throw new Error(`Failed to create directory ${dir}: ${error}`);
      }
    }
  }

  /**
   * Stop a running container
   */
  static stopContainer(containerId: string, timeout: number = 10): boolean {
    try {
      execSync(`docker stop -t ${timeout} ${containerId}`, { stdio: 'ignore' });
      logger.debug(`Stopped container: ${containerId}`);
      return true;
    } catch {
      logger.warn(`Failed to stop container: ${containerId}`);
      return false;
    }
  }

  /**
   * Remove a container
   */
  static removeContainer(containerId: string, force: boolean = true): boolean {
    try {
      const args = ['rm'];
      if (force) args.push('-f');
      args.push(containerId);
      execSync(`docker ${args.join(' ')}`, { stdio: 'ignore' });
      logger.debug(`Removed container: ${containerId}`);
      return true;
    } catch {
      logger.warn(`Failed to remove container: ${containerId}`);
      return false;
    }
  }

  /**
   * List running containers matching a pattern
   */
  static listContainers(pattern: string = 'kaseki'): string[] {
    try {
      const output = execSync(
        `docker ps --filter "name=${pattern}" --format "{{.Names}}"`,
        { encoding: 'utf-8' }
      );
      return output
        .split('\n')
        .filter((name) => name.trim())
        .map((name) => name.trim());
    } catch {
      return [];
    }
  }

  /**
   * Get container logs
   */
  static getContainerLogs(containerId: string, tail?: number): string {
    try {
      const args = ['logs'];
      if (tail) {
        args.push(`--tail=${tail}`);
      }
      args.push(containerId);

      return execSync(`docker ${args.join(' ')}`, { encoding: 'utf-8' });
    } catch {
      return '';
    }
  }
}
