/**
 * Doctor Command
 * Health checks and dependency validation
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync, accessSync, readFileSync, constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';

const logger = createLogger('doctor-cmd');

interface Check {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fixable?: boolean;
}

export class DoctorCommand extends BaseCommand {
  private isJsonOutput = false;

  async execute(args: string[]): Promise<number> {
    try {
      const { flags } = this.parseArgs(args);
      const isJson = flags.has('json');
      this.isJsonOutput = isJson;
      const _isFix = flags.has('fix');
      // Note: --verbose is parsed but not yet used in non-verbose output

      // Banner goes to stderr when --json is set so stdout contains only valid JSON
      if (isJson) {
        process.stderr.write('🏥 Kaseki Agent Health Check\n\n');
      } else {
        console.log('🏥 Kaseki Agent Health Check\n');
      }

      // Load configuration
      await this.configManager.load();

      // Run all checks
      const checks: Check[] = [
        await this.checkDocker(),
        await this.checkNodejs(),
        await this.checkNpm(),
        await this.checkGit(),
        await this.checkAuthFiles(),
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
   * Child process stdio for commands that need stdout while keeping JSON stdout pure.
   */
  private getOutputStdio(): ['ignore', 'pipe', 'ignore' | 'pipe'] {
    return ['ignore', 'pipe', this.isJsonOutput ? 'ignore' : 'pipe'];
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
      const version = execSync('node --version', {
        encoding: 'utf-8',
        stdio: this.getOutputStdio(),
      }).trim();
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
      const version = execSync('npm --version', {
        encoding: 'utf-8',
        stdio: this.getOutputStdio(),
      }).trim();
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
      const version = execSync('git --version', {
        encoding: 'utf-8',
        stdio: this.getOutputStdio(),
      }).trim();
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
   * Resolve an auth file path using a priority-ordered discovery chain:
   * 1. config.json auth.* field
   * 2. environment variable
   * 3. ~/.kaseki/secrets/<filename>
   * 4. ~/secrets/<filename>
   * Returns the resolved path and which source matched, or null if none found.
   */
  private resolveAuthFilePath(
    configKey: string,
    envVar: string,
    filename: string
  ): { filePath: string; source: string } | null {
    const home = os.homedir();

    const candidates: Array<{ filePath: string; source: string }> = [
      {
        filePath: this.configManager.get(configKey, ''),
        source: `~/.kaseki/config.json (${configKey.replace(/[^\w.-]/g, '_')})`,
      },
      { filePath: process.env[envVar] ?? '', source: `$${envVar}` },
      { filePath: path.join(home, '.kaseki', 'secrets', filename), source: `~/.kaseki/secrets/${filename}` },
      { filePath: path.join(home, 'secrets', filename), source: `~/secrets/${filename}` },
    ];

    for (const candidate of candidates) {
      if (candidate.filePath && existsSync(candidate.filePath)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Check all required authentication files
   */
  private async checkAuthFiles(): Promise<Check> {
    const requiredAuthFiles = [
      { key: 'auth.llm_gateway_api_key_file', name: 'LLM Gateway API Key File', envVar: 'LLM_GATEWAY_API_KEY_FILE', filename: 'llm_gateway_api_key' },
      { key: 'auth.github_app_id_file', name: 'GitHub App ID File', envVar: 'GITHUB_APP_ID_FILE', filename: 'github_app_id' },
      { key: 'auth.github_app_client_id_file', name: 'GitHub App Client ID File', envVar: 'GITHUB_APP_CLIENT_ID_FILE', filename: 'github_app_client_id' },
      { key: 'auth.github_app_private_key_file', name: 'GitHub App Private Key File', envVar: 'GITHUB_APP_PRIVATE_KEY_FILE', filename: 'github_app_private_key' },
    ];

    const missingFiles: Array<{ name: string; envVar: string; path: string | null; checkedPaths: string[] }> = [];
    const unreadableFiles: Array<{ name: string; path: string; reason: string }> = [];
    const home = os.homedir();

    for (const authFile of requiredAuthFiles) {
      try {
        const resolved = this.resolveAuthFilePath(authFile.key, authFile.envVar, authFile.filename);

        if (!resolved) {
          const checkedPaths = [
            path.join(home, '.kaseki', 'secrets', authFile.filename),
            path.join(home, 'secrets', authFile.filename),
          ];
          missingFiles.push({ name: authFile.name, envVar: authFile.envVar, path: null, checkedPaths });
          continue;
        }

        // Check if file is readable
        try {
          accessSync(resolved.filePath, fsConstants.R_OK);
        } catch {
          unreadableFiles.push({ name: authFile.name, path: resolved.filePath, reason: 'permission denied' });
          continue;
        }

        // Check if file is not empty
        try {
          const content = readFileSync(resolved.filePath, 'utf-8').trim();
          if (!content) {
            unreadableFiles.push({ name: authFile.name, path: resolved.filePath, reason: 'file is empty' });
          }
        } catch {
          unreadableFiles.push({ name: authFile.name, path: resolved.filePath, reason: 'could not read content' });
        }
      } catch {
        missingFiles.push({ name: authFile.name, envVar: authFile.envVar, path: null, checkedPaths: [] });
      }
    }

    if (missingFiles.length > 0 || unreadableFiles.length > 0) {
      const errorMessage = this.buildAuthErrorMessage(missingFiles, unreadableFiles);
      return {
        name: 'Authentication Files',
        status: 'fail',
        message: errorMessage,
      };
    }

    return {
      name: 'Authentication Files',
      status: 'pass',
      message: '✓ All required auth files present and readable',
    };
  }

  /**
   * Detect if running under sudo
   */
  private isSudo(): boolean {
    return process.getuid?.() === 0 || !!process.env.SUDO_USER;
  }

  /**
   * Build comprehensive auth error message with guidance
   */
  private buildAuthErrorMessage(
    missingFiles: Array<{ name: string; envVar: string; path: string | null; checkedPaths: string[] }>,
    unreadableFiles: Array<{ name: string; path: string; reason: string }>
  ): string {
    const lines: string[] = ['❌ Authentication validation failed:'];
    lines.push('');

    // List missing/unreadable files
    if (missingFiles.length > 0) {
      lines.push('Missing or unconfigured:');
      for (const file of missingFiles) {
        if (file.path) {
          if (file.path.includes('github_client_id') && !file.path.includes('github_app_client_id')) {
            const replacement = file.path.replace(/github_client_id/g, 'github_app_client_id');
            lines.push(`  • ${file.name}: not found at ${file.path}`);
            lines.push(`    ⚠️  Hint: Did you mean '${replacement}'?`);
            lines.push('    The filename should be "github_app_client_id" (with "app_" prefix), not just "github_client_id".');
          } else {
            lines.push(`  • ${file.name}: not found at ${file.path}`);
          }
        } else {
          lines.push(`  • ${file.name} (set ${file.envVar})`);
          if (file.checkedPaths.length > 0) {
            lines.push(`    Looked in: ${file.checkedPaths.join(', ')}`);
          }
        }
      }
      lines.push('');
    }

    if (unreadableFiles.length > 0) {
      lines.push('Unreadable files:');
      for (const file of unreadableFiles) {
        lines.push(`  • ${file.name}: ${file.path} (${file.reason})`);
      }
      lines.push('');
    }

    // Add guidance
    lines.push('💡 To fix, choose one of these approaches:');
    lines.push('');

    lines.push('1️⃣  Config file (persistent, recommended):');
    lines.push('   $ mkdir -p ~/.kaseki');
    lines.push('   $ cat > ~/.kaseki/config.json << EOF');
    lines.push('   {');
    lines.push('     "auth": {');
    lines.push('       "openrouter_api_key_file": "~/secrets/openrouter_api_key",');
    lines.push('       "github_app_id_file": "~/secrets/github_app_id",');
    lines.push('       "github_app_client_id_file": "~/secrets/github_app_client_id",');
    lines.push('       "github_app_private_key_file": "~/secrets/github_app_private_key"');
    lines.push('     }');
    lines.push('   }');
    lines.push('   EOF');
    lines.push('   $ kaseki-agent run <repo> <branch> <task>');
    lines.push('');

    lines.push('2️⃣  Environment variables (one-off runs):');
    if (this.isSudo()) {
      lines.push('   Since you\'re running with sudo, preserve environment:');
      lines.push('   $ export OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key');
      lines.push('   $ sudo -E kaseki-agent run <repo> <branch> <task>');
    } else {
      lines.push('   $ export OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key');
      lines.push('   $ export GITHUB_APP_ID_FILE=~/secrets/github_app_id');
      lines.push('   $ export GITHUB_APP_CLIENT_ID_FILE=~/secrets/github_app_client_id');
      lines.push('   $ export GITHUB_APP_PRIVATE_KEY_FILE=~/secrets/github_app_private_key');
      lines.push('   $ kaseki-agent run <repo> <branch> <task>');
    }
    lines.push('');

    lines.push('3️⃣  Docker Compose (recommended for services):');
    lines.push('   Set env vars in .env or docker-compose.yml secrets');
    lines.push('   See docs/DEPLOYMENT.md for setup instructions');
    lines.push('');

    lines.push('📖 Run the unified setup wizard: kaseki-agent init');

    return lines.join('\n');
  }

  /**
   * Check Docker image availability and integrity
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
      let imageExists = false;
      try {
        execFileSync('docker', ['inspect', image], { stdio: 'ignore' });
        imageExists = true;
      } catch {
        return {
          name: 'Docker Image',
          status: 'warn',
          message: `⚠️  Docker image not found locally: ${image}. Will auto-pull on first run.`,
          fixable: true,
        };
      }

      // If image exists, verify entrypoint script is accessible
      if (imageExists) {
        try {
          execFileSync('docker', [
            'run',
            '--rm',
            '--entrypoint',
            '/bin/test',
            image,
            '-x',
            '/usr/local/bin/kaseki-entrypoint',
          ], {
            stdio: 'ignore',
            timeout: 5000,
          });
          return {
            name: 'Docker Image',
            status: 'pass',
            message: `✓ Docker image available: ${image}`,
          };
        } catch {
          return {
            name: 'Docker Image',
            status: 'fail',
            message: `❌ Docker image is missing critical scripts (kaseki-entrypoint not found). The image may be corrupted. Try rebuilding or pulling a fresh copy: docker pull ${image}`,
            fixable: true,
          };
        }
      }

      return {
        name: 'Docker Image',
        status: 'pass',
        message: `✓ Docker image available: ${image}`,
      };
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
    const kasekiRoot = this.configManager.get('directories.root', '/agents');
    const rootExists = existsSync(kasekiRoot);

    // Fall back to the filesystem root when kasekiRoot hasn't been created yet
    const checkPath = rootExists ? kasekiRoot : '/';
    const label = rootExists ? kasekiRoot : `/ (${kasekiRoot} not yet created)`;

    try {
      const result = execFileSync('df', ['-B1', checkPath], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const lines = result.split(/\r?\n/).filter(line => line.trim());
      const dataLine = lines.length > 1 ? lines[lines.length - 1] : '';
      const availableColumn = dataLine.trim().split(/\s+/)[3] ?? '';

      const availableBytes = parseInt(availableColumn, 10);
      if (isNaN(availableBytes)) {
        return {
          name: 'Disk Space',
          status: 'warn',
          message: `⚠️  Could not parse disk space for ${label}`,
        };
      }

      const availableGB = availableBytes / (1024 ** 3);
      const suffix = rootExists ? '' : ` (checking ${label})`;

      if (availableGB > 10) {
        return {
          name: 'Disk Space',
          status: 'pass',
          message: `✓ Sufficient disk space available (${availableGB.toFixed(1)} GB${suffix})`,
        };
      } else if (availableGB > 1) {
        return {
          name: 'Disk Space',
          status: 'warn',
          message: `⚠️  Limited disk space: ${availableGB.toFixed(1)} GB available${suffix}`,
        };
      } else {
        return {
          name: 'Disk Space',
          status: 'fail',
          message: `❌ Insufficient disk space: ${availableGB.toFixed(2)} GB available${suffix}`,
        };
      }
    } catch {
      return {
        name: 'Disk Space',
        status: 'warn',
        message: `⚠️  Could not determine disk space for ${label}`,
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
        execFileSync('docker', ['pull', image], { stdio: 'inherit' });
        console.log('✓ Image pulled successfully');
      } catch {
        console.log('❌ Failed to pull Docker image');
      }
    }
  }
}
