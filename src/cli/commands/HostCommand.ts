/**
 * Host Command
 * First-run and recovery workflows for Docker Compose API hosts.
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';
import { readHostSecret, getSecretLocations } from '../../secrets/host-secrets-reader';
import { configureHostSecretsDirForPreflight, getDiscoveredSecretsPath } from './host-secrets-path';

const logger = createLogger('host-cmd');

export class HostCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    const [subcommand, action, ...rest] = args;

    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
      this.printHelp();
      return 0;
    }

    const validOptions = new Set(['--fix', '--recreate-api', '--wait-ready', '--help']);
    if (subcommand === 'preflight') {
      return this.runPreflight(action ? [action, ...rest] : rest);
    }

    if (subcommand !== 'setup' || [action, ...rest].filter(Boolean).some((arg) => !validOptions.has(arg))) {
      console.error('Usage: kaseki-agent host setup [--fix] [--recreate-api] [--wait-ready]');
      return 1;
    }

    const setupArgs = [action, ...rest].filter(Boolean);
    if (setupArgs.includes('--help')) {
      this.printHelp();
      return 0;
    }

    const scriptPath = this.findSetupScript();
    if (!scriptPath) {
      console.error('Could not find scripts/kaseki-setup-host.sh in this installation.');
      return 1;
    }

    console.log(`Running host setup helper: ${scriptPath}`);
    if (setupArgs.includes('--fix') && process.getuid?.() !== 0) {
      console.log('Tip: if /agents needs root-owned changes, rerun with sudo or allow sudo when prompted.');
    }

    const waitReady = setupArgs.includes('--wait-ready');
    const scriptArgs = setupArgs.filter((arg) => arg !== '--wait-ready');

    const result = spawnSync(scriptPath, scriptArgs, {
      stdio: 'inherit',
      env: process.env,
    });

    if (result.error) {
      logger.error(`Host setup failed: ${result.error.message}`);
      console.error(`Host setup failed: ${result.error.message}`);
      return 1;
    }

    const exitCode = result.status ?? 1;
    if (exitCode !== 0 || !waitReady) {
      return exitCode;
    }

    return this.waitForReady();
  }

  private findSetupScript(): string | null {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(process.cwd(), 'scripts/kaseki-setup-host.sh'),
      resolve(here, '../../../scripts/kaseki-setup-host.sh'),
      resolve(here, '../../../../scripts/kaseki-setup-host.sh'),
    ];

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  private printHelp(): void {
    console.log(`host - prepare or recover a Docker Compose API host

USAGE
  kaseki-agent host setup [--fix] [--recreate-api] [--wait-ready]
  kaseki-agent host preflight [--url URL]

OPTIONS
  --fix           Create/fix /agents, normalize secrets, and bootstrap the template.
  --recreate-api  Recreate the kaseki-api container after host paths are fixed.
  --wait-ready    Wait for http://127.0.0.1:8080/ready before returning.
  --url URL       Preflight URL. Defaults to http://127.0.0.1:8080/api/preflight.

EXAMPLES
  kaseki-agent host setup
  sudo kaseki-agent host setup --fix --recreate-api --wait-ready
  sudo kaseki-agent host preflight
  sudo KASEKI_HOST_SECRETS_DIR=/home/pi/secrets kaseki-agent host setup --fix
`);
  }

  private async waitForReady(): Promise<number> {
    const url = process.env.KASEKI_READY_URL || 'http://127.0.0.1:8080/ready';
    const timeoutMs = Number.parseInt(process.env.KASEKI_WAIT_READY_TIMEOUT_MS || '60000', 10);
    const startedAt = Date.now();

    console.log(`Waiting for Kaseki API readiness: ${url}`);

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          console.log('Kaseki API is ready.');
          return 0;
        }
      } catch {
        // Container may still be starting; retry until timeout.
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.error(`Kaseki API did not become ready within ${timeoutMs}ms. Check: docker logs kaseki-api`);
    return 1;
  }

  private async runPreflight(args: string[]): Promise<number> {
    if (args.includes('--help') || args.includes('-h')) {
      this.printHelp();
      return 0;
    }
    const allowedArgs = new Set(['--url']);
    const unknownOption = args.find((arg, index) => arg.startsWith('-') && !(allowedArgs.has(arg) || args[index - 1] === '--url'));
    if (unknownOption) {
      console.error(`Unknown host preflight option: ${unknownOption}`);
      console.error('Usage: kaseki-agent host preflight [--url URL]');
      return 1;
    }

    const urlArgIndex = args.indexOf('--url');
    const url = urlArgIndex >= 0 && args[urlArgIndex + 1]
      ? args[urlArgIndex + 1]
      : process.env.KASEKI_PREFLIGHT_URL || 'http://127.0.0.1:8080/api/preflight';
    configureHostSecretsDirForPreflight();

    // Check for discovered path from setup
    const discoveredPath = getDiscoveredSecretsPath();
    if (discoveredPath) {
      console.log(`Discovered secrets directory from setup: ${discoveredPath}`);
    }

    const token = readHostSecret('kaseki_api_keys')?.split(/\r?\n/).find((line) => line.trim())?.trim();

    if (!token) {
      const locations = getSecretLocations('kaseki_api_keys');
      console.error('Could not read kaseki_api_keys from host secrets.');
      console.error(`Checked: ${locations.primary} and ${locations.secondary}`);
      if (discoveredPath) {
        console.error(`(Setup discovered: ${discoveredPath})`);
      }
      console.error('');
      console.error('Troubleshooting:');
      console.error('  1. Verify secret files exist and are readable:');
      console.error(`     ls -la ${locations.primary.replace(/kaseki_api_keys$/, '')}`);
      console.error('  2. If using a custom path, run setup again:');
      console.error('     KASEKI_HOST_SECRETS_DIR=/your/path sudo kaseki-agent host setup --fix');
      console.error('  3. Or set the env var before preflight:');
      console.error('     KASEKI_SECRETS_DIR=/your/path sudo kaseki-agent host preflight');
      return 1;
    }

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const body = await response.text();
      console.log(body);
      return response.ok ? 0 : 1;
    } catch (err) {
      console.error(`Failed to call ${url}: ${(err as Error).message}`);
      return 1;
    }
  }

}
