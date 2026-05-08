/**
 * Config Command
 * Manage configuration
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';

const logger = createLogger('config-cmd');

export class ConfigCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      const { positional, flags } = this.parseArgs(args);
      const subcommand = positional[0];
      const key = positional[1];
      const value = positional.slice(2).join(' ');

      await this.configManager.load();

      switch (subcommand) {
        case 'get': {
          if (!key) {
            console.error('Usage: kaseki-agent config get <KEY>');
            return 1;
          }
          const result = this.configManager.get(key);
          if (result === undefined) {
            console.log('(not set)');
          } else {
            console.log(result);
          }
          return 0;
        }

        case 'set': {
          if (!key || !value) {
            console.error('Usage: kaseki-agent config set <KEY> <VALUE>');
            return 1;
          }

          const useGlobal = flags.has('global');
          const configPath = useGlobal
            ? path.join(os.homedir(), '.kaseki', 'config.json')
            : 'kaseki-agent.json';

          // Ensure directory exists
          const configDir = path.dirname(configPath);
          await fs.mkdir(configDir, { recursive: true });

          // Read existing config
          let config = {};
          try {
            const content = await fs.readFile(configPath, 'utf-8');
            config = JSON.parse(content);
          } catch {
            // File doesn't exist, that's fine
          }

          // Set value using dot notation
          this.setNestedValue(config, key, value);

          // Write back
          await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

          console.log(`✓ Set ${key} = ${value}`);
          console.log(`  Config file: ${configPath}`);
          return 0;
        }

        case 'show': {
          const useGlobal = flags.has('global');
          const configPath = useGlobal
            ? path.join(os.homedir(), '.kaseki', 'config.json')
            : 'kaseki-agent.json';

          try {
            const content = await fs.readFile(configPath, 'utf-8');
            const config = JSON.parse(content);
            console.log(`Configuration from: ${configPath}\n`);
            console.log(JSON.stringify(config, null, 2));
          } catch (error) {
            console.log(`No configuration found at ${configPath}`);
            logger.debug(`Failed to read config: ${error}`);
          }
          return 0;
        }

        case 'locations': {
          console.log('Configuration locations (in precedence order):\n');
          console.log('1. CLI flags (--key=value)');
          console.log('2. kaseki-agent.json (project-local)');
          console.log('3. ~/.kaseki/config.json (user-global)');
          console.log('4. Environment variables (KASEKI_*, OPENROUTER_*)');
          console.log('5. Built-in defaults\n');

          console.log('Examples:');
          console.log('  kaseki-agent config set agent.timeout_seconds 1800 --global');
          console.log('  kaseki-agent config get agent.model');
          console.log('  kaseki-agent config show --global');
          return 0;
        }

        default:
          console.error('Unknown subcommand: ' + subcommand);
          console.error('\nUsage:');
          console.error('  kaseki-agent config get <KEY>');
          console.error('  kaseki-agent config set <KEY> <VALUE> [--global]');
          console.error('  kaseki-agent config show [--global]');
          console.error('  kaseki-agent config locations');
          return 1;
      }
    } catch (error) {
      logger.error(`Config command failed: ${error}`);
      return 1;
    }
  }

  /**
   * Set nested object value using dot notation
   */
  private setNestedValue(obj: any, path: string, value: string): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = keys[keys.length - 1];
    // Try to parse as JSON if possible
    try {
      current[lastKey] = JSON.parse(value);
    } catch {
      current[lastKey] = value;
    }
  }
}
