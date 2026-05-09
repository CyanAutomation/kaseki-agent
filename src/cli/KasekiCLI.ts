/**
 * KasekiCLI - Main command router
 *
 * Dispatches CLI subcommands to their respective handlers
 */

import { createLogger } from '../logger';
import { ConfigManager } from '../config/ConfigManager';

const logger = createLogger('kaseki-cli');

export interface CLICommand {
  name: string;
  description: string;
  execute(args: string[]): Promise<number>;
}

export class KasekiCLI {
  private configManager: ConfigManager;
  private commands: Map<string, CLICommand>;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.commands = new Map();
    this.registerCommands();
  }

  /**
   * Register all available commands
   * These will be lazily loaded when needed
   */
  private registerCommands(): void {
    // Commands will be loaded dynamically to avoid circular dependencies
    // and reduce startup time
    this.commands.set('setup', {
      name: 'setup',
      description: 'Interactive setup wizard (first-time configuration)',
      execute: async (args) => {
        const { SetupCommand } = await import('./commands/SetupCommand.js');
        const cmd = new SetupCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('run', {
      name: 'run',
      description: 'Run kaseki agent on target repository',
      execute: async (args) => {
        const { RunCommand } = await import('./commands/RunCommand.js');
        const cmd = new RunCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('doctor', {
      name: 'doctor',
      description: 'Health checks and dependency validation',
      execute: async (args) => {
        const { DoctorCommand } = await import('./commands/DoctorCommand.js');
        const cmd = new DoctorCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('serve', {
      name: 'serve',
      description: 'Start REST API service for async execution',
      execute: async (args) => {
        const { ServeCommand } = await import('./commands/ServeCommand.js');
        const cmd = new ServeCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('config', {
      name: 'config',
      description: 'Manage configuration',
      execute: async (args) => {
        const { ConfigCommand } = await import('./commands/ConfigCommand.js');
        const cmd = new ConfigCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('list', {
      name: 'list',
      description: 'List all kaseki instances',
      execute: async (args) => {
        const { ListCommand } = await import('./commands/ListCommand.js');
        const cmd = new ListCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('report', {
      name: 'report',
      description: 'Generate report for completed instance',
      execute: async (args) => {
        const { ReportCommand } = await import('./commands/ReportCommand.js');
        const cmd = new ReportCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('secrets', {
      name: 'secrets',
      description: 'Manage stored secrets (keyring/file)',
      execute: async (args) => {
        const { SecretsCommand } = await import('./commands/SecretsCommand.js');
        const cmd = new SecretsCommand(this.configManager);
        return cmd.execute(args);
      },
    });
  }

  /**
   * Dispatch to appropriate subcommand
   */
  async dispatch(subcommand: string | undefined, args: string[]): Promise<number> {
    if (!subcommand) {
      console.error('No command specified');
      return 1;
    }

    const command = this.commands.get(subcommand);
    if (!command) {
      console.error(`Unknown command: ${subcommand}`);
      console.error('\nRun \'kaseki-agent --help\' for available commands');
      return 1;
    }

    try {
      logger.debug(`Executing command: ${subcommand}`);
      return await command.execute(args);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Command failed: ${error.message}`);
        if (process.env.DEBUG === '1') {
          console.error(error.stack);
        }
      } else {
        logger.error('Unknown error in command execution');
      }
      return 1;
    }
  }

  /**
   * Get list of available commands
   */
  getCommands(): CLICommand[] {
    return Array.from(this.commands.values());
  }
}
