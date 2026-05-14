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
      description: 'Submit a task run through the local Kaseki API',
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
      description: 'Start the local REST API service for async task execution',
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
      description: 'List task runs through the local Kaseki API',
      execute: async (args) => {
        const { ListCommand } = await import('./commands/ListCommand.js');
        const cmd = new ListCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('report', {
      name: 'report',
      description: 'Generate a task report through the local Kaseki API',
      execute: async (args) => {
        const { ReportCommand } = await import('./commands/ReportCommand.js');
        const cmd = new ReportCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('status', {
      name: 'status',
      description: 'Poll task status through the local Kaseki API',
      execute: async (args) => {
        const { StatusCommand } = await import('./commands/StatusCommand.js');
        const cmd = new StatusCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('cancel', {
      name: 'cancel',
      description: 'Cancel a queued or running task through the local Kaseki API',
      execute: async (args) => {
        const { CancelCommand } = await import('./commands/CancelCommand.js');
        const cmd = new CancelCommand(this.configManager);
        return cmd.execute(args);
      },
    });

    this.commands.set('stop', {
      name: 'stop',
      description: 'Alias for cancel; stops a task through the local Kaseki API',
      execute: async (args) => {
        const { CancelCommand } = await import('./commands/CancelCommand.js');
        const cmd = new CancelCommand(this.configManager, undefined, 'stop');
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

    if (args.includes('--help') || args.includes('-h')) {
      this.printCommandHelp(command.name);
      return 0;
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
   * Print command-specific help without executing checks or API calls.
   */
  private printCommandHelp(commandName: string): void {
    const help: Record<string, string> = {
      doctor: `doctor - diagnose host, dependencies, templates, and configuration

USAGE
  kaseki-agent doctor [--json] [--fix] [--verbose]

OPTIONS
  --json       Emit machine-readable check results
  --fix        Attempt safe auto-remediation for fixable checks
  --verbose    Include more diagnostic context where available`,
      setup: `setup - interactive first-time configuration wizard

USAGE
  kaseki-agent setup`,
      config: `config - manage Kaseki configuration

USAGE
  kaseki-agent config get <KEY> [--global]
  kaseki-agent config set <KEY> <VALUE> [--global]
  kaseki-agent config show [--global]
  kaseki-agent config locations`,
      secrets: `secrets - manage stored secrets

USAGE
  kaseki-agent secrets init
  kaseki-agent secrets set <NAME> <VALUE>
  kaseki-agent secrets get <NAME> [--show]
  kaseki-agent secrets list
  kaseki-agent secrets delete <NAME>`,
      serve: `serve - start the local REST API service

USAGE
  kaseki-agent serve [--port PORT]`,
      run: `run - submit a task run through the configured Kaseki API

USAGE
  kaseki-agent run <REPO_URL> [GIT_REF] [TASK_PROMPT]

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.
  Set KASEKI_API_KEY when the API requires bearer-token authentication.`,
      list: `list - list task runs through the configured Kaseki API

USAGE
  kaseki-agent list [--status queued|running|completed|failed]

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.`,
      report: `report - generate a run report

USAGE
  kaseki-agent report <RUN_ID> [--from-disk]

REQUIRES
  API mode requires a local API service or KASEKI_API_URL. Use --from-disk to inspect local result files without API access.`,
      status: `status - poll task status through the configured Kaseki API

USAGE
  kaseki-agent status <RUN_ID> [--json]

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.`,
      cancel: `cancel - cancel a queued or running task through the configured Kaseki API

USAGE
  kaseki-agent cancel <RUN_ID>

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.`,
      stop: `stop - alias for cancel

USAGE
  kaseki-agent stop <RUN_ID>

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.`,
    };

    console.log(help[commandName] || `${commandName} - no detailed help available`);
  }

  /**
   * Get list of available commands
   */
  getCommands(): CLICommand[] {
    return Array.from(this.commands.values());
  }
}
