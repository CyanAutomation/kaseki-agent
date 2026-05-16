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

const logger = createLogger('host-cmd');

export class HostCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    const [subcommand, action, ...rest] = args;

    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
      this.printHelp();
      return 0;
    }

    if (subcommand !== 'setup' || (action && action !== '--fix' && action !== '--recreate-api' && action !== '--help')) {
      console.error('Usage: kaseki-agent host setup [--fix] [--recreate-api]');
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

    const result = spawnSync(scriptPath, setupArgs, {
      stdio: 'inherit',
      env: process.env,
    });

    if (result.error) {
      logger.error(`Host setup failed: ${result.error.message}`);
      console.error(`Host setup failed: ${result.error.message}`);
      return 1;
    }

    return result.status ?? 1;
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
  kaseki-agent host setup [--fix] [--recreate-api]

OPTIONS
  --fix           Create/fix /agents, normalize secrets, and bootstrap the template.
  --recreate-api  Recreate the kaseki-api container after host paths are fixed.

EXAMPLES
  kaseki-agent host setup
  sudo kaseki-agent host setup --fix --recreate-api
  sudo KASEKI_HOST_SECRETS_DIR=/home/pi/secrets kaseki-agent host setup --fix
`);
  }
}
