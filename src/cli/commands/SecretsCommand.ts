/**
 * Secrets Command
 * Manage secrets (API keys, credentials)
 */

import { BaseCommand } from '../BaseCommand';
import { SecretsManager } from '../../secrets/SecretsManager';
import { createLogger } from '../../logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const logger = createLogger('secrets-cmd');
const REQUIRED_HOST_SECRET_FILES = [
  'openrouter_api_key',
  'github_app_id',
  'github_app_client_id',
  'github_app_private_key',
  'kaseki_api_keys',
] as const;

export class SecretsCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      const { positional, flags } = this.parseArgs(args);
      const subcommand = positional[0];
      const secretKey = positional[1];
      const secretValue = positional[2];

      const secretsManager = new SecretsManager();

      switch (subcommand) {
      case 'init': {
        console.log('🔐 Initializing secrets directories...\n');
        
        // Create the fallback secrets directory (~/.kaseki/secrets)
        try {
          const secretsDir = path.join(process.env.HOME || os.homedir(), '.kaseki', 'secrets');
          if (!fs.existsSync(secretsDir)) {
            fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
            console.log(`✓ Created ${secretsDir}`);
          } else {
            console.log(`✓ Directory exists: ${secretsDir}`);
          }
        } catch (error) {
          console.error(`✗ Failed to initialize secrets: ${error}`);
          return 1;
        }
        
        console.log('\nNext: Add your secrets with: kaseki-agent secrets set KEY VALUE');
        console.log('Example: kaseki-agent secrets set openrouter_api_key sk-or-...');
        return 0;
      }

      case 'set': {
        if (!secretKey || !secretValue) {
          console.error('Usage: kaseki-agent secrets set <KEY> <VALUE>');
          console.error('Example: kaseki-agent secrets set openrouter-api-key sk-or-...');
          return 1;
        }

        await secretsManager.store(secretKey, secretValue);
        console.log(`✓ Stored secret: ${secretKey}`);
        return 0;
      }

      case 'get': {
        if (!secretKey) {
          console.error('Usage: kaseki-agent secrets get <KEY>');
          return 1;
        }

        const value = await secretsManager.retrieve(secretKey);
        if (value) {
          // Only show if explicitly requested with --show
          if (flags.has('show')) {
            console.log(value);
          } else {
            console.log(`✓ Secret exists: ${secretKey}`);
            console.log('(Use --show to display the value)');
          }
        } else {
          console.log(`Secret not found: ${secretKey}`);
          return 1;
        }
        return 0;
      }

      case 'delete': {
        if (!secretKey) {
          console.error('Usage: kaseki-agent secrets delete <KEY>');
          return 1;
        }

        await secretsManager.delete(secretKey);
        console.log(`✓ Deleted secret: ${secretKey}`);
        return 0;
      }

      case 'list': {
        const secrets = await secretsManager.list();
        if (secrets.size === 0) {
          console.log('No secrets stored');
          return 0;
        }

        console.log('📋 Stored Secrets\n');
        for (const key of secrets.keys()) {
          console.log(`  • ${key}`);
        }
        console.log(`\nTotal: ${secrets.size} secret(s)`);
        return 0;
      }

      case 'doctor':
        return this.runPermissionsDoctor(false);

      case 'fix-permissions':
        return this.runPermissionsDoctor(true);

      case 'help': {
        console.log('🔐 Secrets Management\n');
        console.log('Usage:');
        console.log('  kaseki-agent secrets init                    Initialize keyring');
        console.log('  kaseki-agent secrets set <KEY> <VALUE>       Store a secret');
        console.log('  kaseki-agent secrets get <KEY> [--show]      Retrieve a secret');
        console.log('  kaseki-agent secrets delete <KEY>            Delete a secret');
        console.log('  kaseki-agent secrets list                    List all secret keys');
        console.log('  kaseki-agent secrets doctor                  Check host secret file permissions');
        console.log('  kaseki-agent secrets fix-permissions         Normalize host secret file permissions');
        console.log('\nCommon Keys:');
        console.log('  openrouter-api-key    OpenRouter API key');
        console.log('  github-app-id         GitHub App ID');
        console.log('  github-app-client-id  GitHub App Client ID');
        console.log('  github-app-private-key GitHub App Private Key\n');
        console.log('Storage:');
        console.log('  - Uses Linux pass (password-store) by default');
        console.log('  - Falls back to ~/.kaseki/secrets/ with 0600 permissions');
        console.log('  - Keys are never exposed via environment variables');
        return 0;
      }

      default:
        console.error('Unknown subcommand: ' + subcommand);
        console.error('\nRun: kaseki-agent secrets help');
        return 1;
      }
    } catch (error) {
      logger.error(`Secrets command failed: ${error}`);
      return 1;
    }
  }

  private runPermissionsDoctor(fix: boolean): number {
    const secretsDir = process.env.KASEKI_HOST_SECRETS_DIR || process.env.KASEKI_SECRETS_DIR || path.join(process.env.HOME || '.', 'secrets');
    const containerGid = Number.parseInt(process.env.KASEKI_CONTAINER_GID || '10000', 10);
    const groupName = process.env.KASEKI_SECRETS_GROUP || 'kaseki-secrets';
    let status = 0;

    if (fix) {
      this.ensureSecretsGroup(groupName, containerGid);
    }

    if (!fs.existsSync(secretsDir)) {
      console.error(`missing: ${secretsDir}`);
      console.error('remediation: create the directory and add required secret files.');
      return 1;
    }

    if (fix) {
      this.tryChgrp(secretsDir, groupName, containerGid);
      this.tryChmod(secretsDir, 0o750);
    }

    status = this.checkPath(secretsDir, {
      type: 'directory',
      expectedMode: 0o750,
      expectedGid: containerGid,
      groupName,
      containerGid,
      fix,
    }) || status;

    for (const secretName of REQUIRED_HOST_SECRET_FILES) {
      const secretPath = path.join(secretsDir, secretName);
      if (!fs.existsSync(secretPath)) {
        console.warn(`warning: secret missing: ${secretName}`);
        continue;
      }

      if (fix) {
        this.tryChgrp(secretPath, groupName, containerGid);
        this.tryChmod(secretPath, 0o640);
      }

      status = this.checkPath(secretPath, {
        type: 'file',
        expectedMode: 0o640,
        expectedGid: containerGid,
        groupName,
        containerGid,
        fix,
      }) || status;
    }

    if (status === 0) {
      console.log(`ok: host secrets permissions are ready for container gid ${containerGid}.`);
    } else if (!fix) {
      console.error(`remediation: run sudo KASEKI_HOST_SECRETS_DIR=${secretsDir} kaseki-agent secrets fix-permissions`);
    }

    return status;
  }

  private checkPath(filePath: string, options: {
    type: 'directory' | 'file';
    expectedMode: number;
    expectedGid: number;
    groupName: string;
    containerGid: number;
    fix: boolean;
  }): number {
    const stat = fs.statSync(filePath);
    const mode = stat.mode & 0o777;
    const typeOk = options.type === 'directory' ? stat.isDirectory() : stat.isFile();
    const modeOk = mode === options.expectedMode;
    const gidOk = stat.gid === options.expectedGid;

    if (typeOk && modeOk && gidOk) {
      console.log(`ok: ${filePath} mode=${mode.toString(8)} gid=${stat.gid}`);
      return 0;
    }

    const problems = [];
    if (!typeOk) problems.push(`expected ${options.type}`);
    if (!modeOk) problems.push(`mode ${mode.toString(8)} blocks the standard container contract; expected ${options.expectedMode.toString(8)}`);
    if (!gidOk) problems.push(`gid ${stat.gid} does not match ${options.groupName}/${options.containerGid}`);

    console.error(`problem: ${filePath}: ${problems.join('; ')}`);
    return 1;
  }

  private ensureSecretsGroup(groupName: string, gid: number): void {
    if (spawnSync('getent', ['group', groupName], { stdio: 'ignore' }).status === 0) {
      return;
    }

    const result = spawnSync('groupadd', ['--gid', String(gid), groupName], { stdio: 'ignore' });
    if (result.status !== 0) {
      spawnSync('groupadd', [groupName], { stdio: 'ignore' });
    }
  }

  private tryChgrp(filePath: string, groupName: string, gid: number): void {
    let result = spawnSync('chgrp', [groupName, filePath], { stdio: 'ignore' });
    if (result.status !== 0) {
      result = spawnSync('chgrp', [String(gid), filePath], { stdio: 'ignore' });
    }
  }

  private tryChmod(filePath: string, mode: number): void {
    try {
      fs.chmodSync(filePath, mode);
    } catch {
      // checkPath reports the remaining problem with actionable detail.
    }
  }
}
