/**
 * Secrets Command
 * Manage secrets (API keys, credentials)
 */

import { BaseCommand } from '../BaseCommand';
import { SecretsManager } from '../../secrets/SecretsManager';
import { createLogger } from '../../logger';

const logger = createLogger('secrets-cmd');

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
        console.log('🔐 Initializing secrets store...\n');
        await secretsManager.initializeKeyring();
        console.log('✓ Secrets store initialized');
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

      case 'help': {
        console.log('🔐 Secrets Management\n');
        console.log('Usage:');
        console.log('  kaseki-agent secrets init                    Initialize keyring');
        console.log('  kaseki-agent secrets set <KEY> <VALUE>       Store a secret');
        console.log('  kaseki-agent secrets get <KEY> [--show]      Retrieve a secret');
        console.log('  kaseki-agent secrets delete <KEY>            Delete a secret');
        console.log('  kaseki-agent secrets list                    List all secret keys');
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
}
