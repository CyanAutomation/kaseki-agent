/**
 * ContainerLauncher - Launches and manages the kaseki-api Docker container
 * Handles docker run, readiness polling, and smoke testing
 */

import { execSync, spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { ConfigManager } from '../../config/ConfigManager';
import { createLogger } from '../../logger';

const logger = createLogger('container-launcher');

const CONTAINER_UID = 10000;
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 2_000;

export interface LaunchResult {
  ok: boolean;
  error?: string;
}

export interface ReadinessResult {
  ok: boolean;
  error?: string;
}

export interface SmokeTestResult {
  ok: boolean;
  error?: string;
}

export class ContainerLauncher {
  constructor(private configManager: ConfigManager) {}

  /**
   * Start the kaseki-api Docker container
   */
  launch(apiKey: string): LaunchResult {
    // Remove any existing broken container
    spawnSync('docker', ['rm', '-f', 'kaseki-api'], { stdio: 'ignore' });

    const image = this.configManager.get('docker.image', 'docker.io/cyanautomation/kaseki-agent:latest');
    const secretsDir = path.join(os.homedir(), 'secrets');

    // Get docker GID for socket access
    let dockerGid = '985';
    try {
      const result = execSync('getent group docker | cut -d: -f3', { encoding: 'utf-8' }).trim();
      if (result) dockerGid = result;
    } catch {
      logger.debug('Could not determine docker GID, using default');
    }

    const args = this.buildDockerArgs(image, secretsDir, apiKey, dockerGid);

    logger.debug(`Launching container with image: ${image}`);
    const result = spawnSync('docker', args, { stdio: 'pipe', encoding: 'utf-8' });
    if (result.status !== 0) {
      const error = result.stderr?.trim() || 'docker run failed';
      logger.error(`Failed to launch container: ${error}`);
      return { ok: false, error };
    }

    logger.info('Container launched successfully');
    return { ok: true };
  }

  /**
   * Wait for the API to become ready (polling /ready endpoint)
   */
  async waitForReadiness(): Promise<ReadinessResult> {
    const url = 'http://127.0.0.1:8080/ready';
    const deadline = Date.now() + READY_TIMEOUT_MS;

    logger.info('Waiting for API readiness...');

    while (Date.now() < deadline) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        try {
          const body = (await res.json()) as { status?: string };
          if (body.status === 'ready') {
            logger.info('API is ready');
            return { ok: true };
          }
        } catch {
          // If JSON parsing fails, ensure body is still drained
          await res.text().catch(() => {});
        }
      } catch {
        // Container still starting
      }

      await new Promise((r) => setTimeout(r, READY_POLL_MS));
      process.stdout.write('.');
    }

    process.stdout.write('\n');
    const error = 'API did not become ready within 60s';
    logger.error(error);
    return { ok: false, error };
  }

  /**
   * Run a smoke test on the authenticated /api/runs endpoint
   */
  async smokeTest(apiKey: string): Promise<SmokeTestResult> {
    try {
      logger.debug('Running smoke test...');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const res = await fetch('http://127.0.0.1:8080/api/runs', {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      clearTimeout(timer);

      // Always drain response body to prevent handle leaks
      await res.text().catch(() => {});

      if (res.ok) {
        logger.info('Smoke test passed');
        return { ok: true };
      } else {
        const error = `Smoke test failed with status ${res.status}`;
        logger.warn(error);
        return { ok: false, error };
      }
    } catch (e) {
      const error = `Smoke test error: ${(e as Error).message}`;
      logger.warn(error);
      return { ok: false, error };
    }
  }

  /**
   * Build docker run arguments for the kaseki-api container
   */
  private buildDockerArgs(image: string, secretsDir: string, apiKey: string, dockerGid: string): string[] {
    return [
      'run', '-d',
      '--name', 'kaseki-api',
      '--restart', 'unless-stopped',
      '--user', `${CONTAINER_UID}:${CONTAINER_UID}`,
      '--group-add', dockerGid,
      '-p', '8080:8080',
      '-e', 'KASEKI_API_PORT=8080',
      '-e', 'KASEKI_API_LOG_LEVEL=info',
      '-e', 'KASEKI_API_MAX_CONCURRENT_RUNS=3',
      '-e', 'KASEKI_RESULTS_DIR=/agents/kaseki-results',
      '-e', 'KASEKI_SECRETS_DIR=/run/secrets/kaseki',
      '-e', `KASEKI_HOST_SECRETS_DIR=${secretsDir}`,
      '-e', `KASEKI_CONTAINER_USER=${CONTAINER_UID}:${CONTAINER_UID}`,
      '-e', `KASEKI_CONTAINER_UID=${CONTAINER_UID}`,
      '-e', `KASEKI_CONTAINER_GID=${CONTAINER_UID}`,
      '-e', 'KASEKI_AGENT_TIMEOUT_SECONDS=10800',
      '-e', 'KASEKI_MAX_DIFF_BYTES=400000',
      '-e', `KASEKI_API_KEYS=${apiKey}`,
      '-e', 'OPENROUTER_API_KEY_FILE=/run/secrets/kaseki/openrouter_api_key',
      '-e', 'GITHUB_APP_ID_FILE=/run/secrets/kaseki/github_app_id',
      '-e', 'GITHUB_APP_CLIENT_ID_FILE=/run/secrets/kaseki/github_app_client_id',
      '-e', 'GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/kaseki/github_app_private_key',
      '-v', '/agents:/agents:rw',
      '-v', `${secretsDir}:/run/secrets/kaseki:ro`,
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--read-only',
      '--tmpfs', '/tmp',
      '--tmpfs', '/var/tmp',
      '--tmpfs', '/run',
      '--tmpfs', '/results',
      image,
      'api',
    ];
  }
}
