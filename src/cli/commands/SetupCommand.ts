/**
 * Setup Command
 * Interactive setup wizard for first-time configuration
 */

import readline from 'readline';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
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
  private rl: readline.Interface | null = null;

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
    } finally {
      this.closeReadline();
    }
  }

  /**
   * Prompt user for configuration answers
   */
  private async promptForAnswers(): Promise<SetupAnswers | null> {
    try {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Prompt for API key
      const apiKey = await this.prompt(
        '📌 Enter your OpenRouter API key (sk-or-...): ',
        true
      );

      if (!apiKey) {
        console.error('API key is required.');
        return null;
      }

      // Verify API key format
      if (!apiKey.startsWith('sk-or-')) {
        console.warn('⚠️  API key should start with "sk-or-". Continuing anyway...');
      }

      // Prompt for config location
      const configLocation = await this.promptChoice(
        'Where should config be stored?',
        [
          { label: 'Project-local (./kaseki-agent.json)', value: 'project' },
          { label: 'User home (~/.kaseki/config.json)', value: 'global' },
        ]
      );

      if (!configLocation) {
        return null;
      }

      // Prompt for model
      const modelName = await this.prompt(
        'Model identifier (default: openrouter/free): ',
        false
      );

      return {
        apiKey,
        configLocation: configLocation as 'project' | 'global',
        validationCommands: [
          'npm run check',
          'npm run test',
          'npm run build',
        ],
        modelName: modelName || 'openrouter/free',
      };
    } finally {
      this.closeReadline();
    }
  }

  /**
   * Prompt for single answer with optional masking
   */
  private prompt(question: string, mask: boolean = false): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve(null);
        return;
      }

      if (mask) {
        // Mask password input
        process.stdout.write(question);
        const stdin = process.stdin;
        stdin.resume();
        stdin.setRawMode(true);

        let password = '';
        stdin.on('data', (char: Buffer) => {
          const charStr = char.toString('utf-8');
          if (charStr === '\n' || charStr === '\r' || charStr === '\u0004') {
            // Enter key or Ctrl-D
            stdin.setRawMode(false);
            stdin.pause();
            console.log(); // Newline for cleanliness
            resolve(password);
          } else if (charStr === '\u0003') {
            // Ctrl-C
            process.exit();
          } else {
            password += charStr;
            process.stdout.write('*');
          }
        });
      } else {
        this.rl!.question(question, (answer) => {
          resolve(answer || null);
        });
      }
    });
  }

  /**
   * Prompt for choice from list
   */
  private async promptChoice(
    question: string,
    choices: Array<{ label: string; value: string }>
  ): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve(null);
        return;
      }

      console.log(`\n${question}`);
      choices.forEach((choice, index) => {
        console.log(`  ${index + 1}) ${choice.label}`);
      });

      this.rl!.question('Enter number (1-' + choices.length + '): ', (answer) => {
        const index = parseInt(answer, 10) - 1;
        if (index >= 0 && index < choices.length) {
          resolve(choices[index].value);
        } else {
          resolve(null);
        }
      });
    });
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

  /**
   * Close readline interface
   */
  private closeReadline(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
