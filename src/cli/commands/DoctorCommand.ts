/**
 * Doctor Command
 * Health checks and dependency validation
 */

import { execSync } from 'child_process';
import { BaseCommand } from '../BaseCommand';
import { SecretsManager } from '../../secrets/SecretsManager';
import { createLogger } from '../../logger';

const logger = createLogger('doctor-cmd');

interface Check {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fixable?: boolean;
}

export class DoctorCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      const { flags } = this.parseArgs(args);
      const isJson = flags.has('json');
      const _isFix = flags.has('fix');
      // Note: --verbose is parsed but not yet used in non-verbose output

      console.log('🏥 Kaseki Agent Health Check\n');

      // Load configuration
      await this.configManager.load();

      // Run all checks
      const checks: Check[] = [
        await this.checkDocker(),
        await this.checkNodejs(),
        await this.checkNpm(),
        await this.checkGit(),
        await this.checkAPIKey(),
        await this.checkDockkerImage(),
        await this.checkDiskSpace(),
      ];

      // Output results
      if (isJson) {
        console.log(JSON.stringify(checks, null, 2));
      } else {
        this.printResults(checks);
      }

      // Attempt fixes if requested
      if (_isFix) {
        console.log('\n🔧 Attempting auto-remediation...\n');
        for (const check of checks) {
          if (check.status !== 'pass' && check.fixable) {
            await this.attemptFix(check);
          }
        }

        // Re-run checks after fixes
        console.log('\n🏥 Running checks again...\n');
        const rechecks: Check[] = [
          await this.checkDocker(),
          await this.checkDockkerImage(),
        ];
        this.printResults(rechecks);
      }

      // Return exit code based on failures
      const failures = checks.filter((c) => c.status === 'fail').length;
      return failures > 0 ? 1 : 0;
    } catch (error) {
      logger.error(`Doctor check failed: ${error}`);
      return 1;
    }
  }

  /**
   * Check Docker installation and daemon
   */
  private async checkDocker(): Promise<Check> {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      execSync('docker ps', { stdio: 'ignore' });
      return {
        name: 'Docker',
        status: 'pass',
        message: '✓ Docker installed and daemon running',
      };
    } catch {
      return {
        name: 'Docker',
        status: 'fail',
        message: '❌ Docker not installed or daemon not running',
        fixable: true,
      };
    }
  }

  /**
   * Check Node.js version
   */
  private async checkNodejs(): Promise<Check> {
    try {
      const version = execSync('node --version', { encoding: 'utf-8' }).trim();
      const major = parseInt(version.replace('v', '').split('.')[0], 10);
      if (major >= 24) {
        return {
          name: 'Node.js',
          status: 'pass',
          message: `✓ Node.js ${version}`,
        };
      } else {
        return {
          name: 'Node.js',
          status: 'fail',
          message: `❌ Node.js v24+ required, found ${version}`,
        };
      }
    } catch {
      return {
        name: 'Node.js',
        status: 'fail',
        message: '❌ Node.js not installed',
      };
    }
  }

  /**
   * Check npm installation
   */
  private async checkNpm(): Promise<Check> {
    try {
      const version = execSync('npm --version', { encoding: 'utf-8' }).trim();
      return {
        name: 'npm',
        status: 'pass',
        message: `✓ npm ${version}`,
      };
    } catch {
      return {
        name: 'npm',
        status: 'fail',
        message: '❌ npm not installed',
      };
    }
  }

  /**
   * Check git installation
   */
  private async checkGit(): Promise<Check> {
    try {
      const version = execSync('git --version', { encoding: 'utf-8' }).trim();
      return {
        name: 'git',
        status: 'pass',
        message: `✓ ${version}`,
      };
    } catch {
      return {
        name: 'git',
        status: 'fail',
        message: '❌ git not installed',
      };
    }
  }

  /**
   * Check API key accessibility
   */
  private async checkAPIKey(): Promise<Check> {
    try {
      const secretsManager = new SecretsManager();
      const apiKeyFile = this.configManager.get('auth.openrouter_api_key_file', '');

      if (!apiKeyFile) {
        return {
          name: 'OpenRouter API Key',
          status: 'warn',
          message: '⚠️  API key file path not configured',
        };
      }

      const key = await secretsManager.retrieve('openrouter_api_key');
      if (key) {
        return {
          name: 'OpenRouter API Key',
          status: 'pass',
          message: '✓ API key found and readable',
        };
      } else {
        return {
          name: 'OpenRouter API Key',
          status: 'fail',
          message: '❌ API key not found. Run: kaseki-agent setup',
        };
      }
    } catch (error) {
      return {
        name: 'OpenRouter API Key',
        status: 'fail',
        message: `❌ API key check failed: ${error}`,
      };
    }
  }

  /**
   * Check Docker image availability
   */
  private async checkDockkerImage(): Promise<Check> {
    try {
      const image = this.configManager.get('docker.image', '');

      if (!image) {
        return {
          name: 'Docker Image',
          status: 'fail',
          message: '❌ Docker image not configured',
        };
      }

      // Check if image exists locally
      try {
        execSync(`docker inspect ${image} > /dev/null 2>&1`, { stdio: 'ignore' });
        return {
          name: 'Docker Image',
          status: 'pass',
          message: `✓ Docker image available: ${image}`,
        };
      } catch {
        return {
          name: 'Docker Image',
          status: 'warn',
          message: `⚠️  Docker image not found locally: ${image}. Will auto-pull on first run.`,
          fixable: true,
        };
      }
    } catch (error) {
      return {
        name: 'Docker Image',
        status: 'fail',
        message: `❌ Docker image check failed: ${error}`,
      };
    }
  }

  /**
   * Check disk space
   */
  private async checkDiskSpace(): Promise<Check> {
    try {
      const kasekiRoot = this.configManager.get('directories.root', '/agents');
      const result = execSync(`df -B1 ${kasekiRoot} | awk 'NR==2 {print $4}'`, {
        encoding: 'utf-8',
      }).trim();

      const availableBytes = parseInt(result, 10);
      const availableGB = availableBytes / (1024 ** 3);

      if (availableGB > 10) {
        return {
          name: 'Disk Space',
          status: 'pass',
          message: `✓ Sufficient disk space available (${availableGB.toFixed(1)} GB)`,
        };
      } else if (availableGB > 1) {
        return {
          name: 'Disk Space',
          status: 'warn',
          message: `⚠️  Limited disk space: ${availableGB.toFixed(1)} GB available`,
        };
      } else {
        return {
          name: 'Disk Space',
          status: 'fail',
          message: `❌ Insufficient disk space: ${availableGB.toFixed(2)} GB available`,
        };
      }
    } catch {
      return {
        name: 'Disk Space',
        status: 'warn',
        message: '⚠️  Could not determine disk space',
      };
    }
  }

  /**
   * Print check results in human-readable format
   */
  private printResults(checks: Check[]): void {
    for (const check of checks) {
      console.log(`${check.message}`);
    }

    const summary = {
      pass: checks.filter((c) => c.status === 'pass').length,
      warn: checks.filter((c) => c.status === 'warn').length,
      fail: checks.filter((c) => c.status === 'fail').length,
    };

    console.log(
      `\nSummary: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed`
    );

    if (summary.fail > 0) {
      console.log('Fix issues with: kaseki-agent doctor --fix');
    }
  }

  /**
   * Attempt to fix identified issues
   */
  private async attemptFix(check: Check): Promise<void> {
    if (check.name === 'Docker') {
      console.log('Install Docker from: https://docs.docker.com/install/');
    } else if (check.name === 'Docker Image') {
      try {
        console.log(`Pulling Docker image: ${this.configManager.get('docker.image')}...`);
        const image = this.configManager.get('docker.image', '');
        execSync(`docker pull ${image}`, { stdio: 'inherit' });
        console.log('✓ Image pulled successfully');
      } catch {
        console.log('❌ Failed to pull Docker image');
      }
    }
  }
}
