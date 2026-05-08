/**
 * Base class for all CLI commands
 */

import { ConfigManager } from '../config/ConfigManager';

export abstract class BaseCommand {
  protected configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  abstract execute(args: string[]): Promise<number>;

  /**
   * Parse simple arguments
   * Handles: command arg1 arg2 --flag --key=value
   */
  protected parseArgs(args: string[]): {
    positional: string[];
    flags: Map<string, string | boolean>;
  } {
    const positional: string[] = [];
    const flags = new Map<string, string | boolean>();

    for (const arg of args) {
      if (arg.startsWith('--')) {
        const [key, value] = arg.substring(2).split('=');
        flags.set(key, value || true);
      } else if (arg.startsWith('-') && arg.length === 2) {
        flags.set(arg.substring(1), true);
      } else {
        positional.push(arg);
      }
    }

    return { positional, flags };
  }
}
