/**
 * Setup Command
 * Interactive setup wizard for first-time configuration
 */

import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import Enquirer from 'enquirer';
import { SecretsManager } from '../../secrets/SecretsManager';
import { DoctorCommand } from './DoctorCommand';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';

const logger = createLogger('setup-cmd');

interface SetupAnswers {
  apiKey: string;
  configLocation: 'project' | 'global';
  validationCommands: string[];
  modelName: string;
}

export class SetupCommand extends BaseCommand {
  async execute(_args: string[]): Promise<number> {
    try {
      console.log('\n🔧 Kaseki Agent Setup Wizard\n');
      console.log('This will configure kaseki-agent for your system.\n');

      // Step 1: Check Docker
      console.log('Step 1/5: Checking Docker installation...');
      if (!this.isDockerInstalled()) {
        console.error(
          '❌ Docker is not installed or not accessible.\n' +
          'Please install Docker and ensure the daemon is running:\n' +
          '  https://docs.docker.com/install/\n\n' +
          'After installation, run: kaseki-agent setup\n'
        );
        return 1;
      }
      console.log('✓ Docker found and accessible\n');

      // Step 2: Check Node.js
      console.log('Step 2/5: Checking Node.js...');
      const nodeVersion = this.getNodeVersion();
      if (!nodeVersion || !this.isNodeVersionValid(nodeVersion)) {
        console.error(`❌ Node.js v24+ is required. Found: ${nodeVersion || 'not installed'}`);
        return 1;
      }
      console.log(`✓ Node.js ${nodeVersion} detected\n`);

      // Step 3: Collect configuration
      console.log('Step 3/5: Configuring OpenRouter API key...');
      const answers = await this.promptForAnswers();
      if (!answers) {
        console.log('Setup cancelled.');
        return 1;
      }

      // Step 4: Store configuration
      console.log('\nStep 4/5: Saving configuration...');
      await this.saveConfiguration(answers);
      console.log('✓ Configuration saved\n');

      // Step 5: Run health check
      console.log('Step 5/5: Running health check...\n');
      const doctorCmd = new DoctorCommand(this.configManager);
      const doctorResult = await doctorCmd.execute(['--verbose']);
      if (doctorResult !== 0) {
        console.log(
          '\n⚠️  Health check found issues. Review the output above.\n' +
          'You can run "kaseki-agent doctor --fix" to auto-remediate.\n'
        );
        // Don't fail - configuration is still valid even if some checks failed
      }

      console.log(
        '\n✅ Setup complete!\n\n' +
        'You can now use kaseki-agent:\n' +
        '  kaseki-agent run <repo-url> <git-ref>     # Run agent\n' +
        '  kaseki-agent doctor --verbose             # Health check\n' +
        '  kaseki-agent serve --port 8080            # Start API\n\n' +
        'For help: kaseki-agent --help\n'
      );

      return 0;
    } catch (error) {
      logger.error(`Setup failed: ${error}`);
      return 1;
    }
  }

  /**
   * Prompt user for configuration answers using enquirer
   */
  private async promptForAnswers(): Promise<SetupAnswers | null> {
    try {
      const enquirer = new Enquirer();

      const answers = await enquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: '📌 Enter your OpenRouter API key (sk-or-...)',
          validate: (value: string) => {
            if (!value) {
              return 'API key is required.';
            }
            if (!value.startsWith('sk-or-')) {
              return 'API key should start with "sk-or-"';
            }
            return true;
          },
        },
        {
          type: 'select',
          name: 'configLocation',
          message: 'Where should config be stored?',
          choices: [
            { name: 'project', message: 'Project-local (./kaseki-agent.json)' },
            { name: 'global', message: 'User home (~/.kaseki/config.json)' },
          ],
        },
        {
          type: 'input',
          name: 'modelName',
          message: 'Model identifier (default: openrouter/free): ',
          initial: 'openrouter/free',
        },
      ]) as any;

      if (!answers) {
        return null;
      }

      return {
        apiKey: answers.apiKey,
        configLocation: answers.configLocation as 'project' | 'global',
        validationCommands: [
          'npm run check',
          'npm run test',
          'npm run build',
        ],
        modelName: answers.modelName || 'openrouter/free',
      };
    } catch (error) {
      logger.error(`Failed to prompt for answers: ${error}`);
      return null;
    }
  }

  /**
   * Save configuration to file and secrets
   */
  private async saveConfiguration(answers: SetupAnswers): Promise<void> {
    // Store API key securely
    const secretsManager = new SecretsManager();
    await secretsManager.store('openrouter_api_key', answers.apiKey);

    // Determine config file path
    const configPath = answers.configLocation === 'project'
      ? path.join(process.cwd(), 'kaseki-agent.json')
      : path.join(os.homedir(), '.kaseki', 'config.json');

    // Load current configuration
    await this.configManager.load();

    // Update configuration
    this.configManager.set('agent.model', answers.modelName);
    this.configManager.set('auth.openrouter_api_key_file',
      path.join(os.homedir(), '.kaseki', 'secrets', 'openrouter_api_key')
    );
    this.configManager.set('validation.commands', answers.validationCommands);

    // Save configuration
    await this.configManager.save(configPath);

    logger.debug(`Configuration saved to: ${configPath}`);
    console.log(`Config saved: ${configPath}`);
  }

  /**
   * Check if Docker is installed and running
   */
  private isDockerInstalled(): boolean {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      // Also check if daemon is accessible
      execSync('docker ps', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get installed Node.js version
   */
  private getNodeVersion(): string | null {
    try {
      const version = execSync('node --version', { encoding: 'utf-8' }).trim();
      return version.replace('v', '');
    } catch {
      return null;
    }
  }

  /**
   * Check if Node.js version is v24+
   */
  private isNodeVersionValid(version: string): boolean {
    const major = parseInt(version.split('.')[0], 10);
    return major >= 24;
  }
}
