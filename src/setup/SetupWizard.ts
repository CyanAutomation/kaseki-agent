/**
 * Setup Wizard - Unified initialization flow for all kaseki-agent paths
 *
 * Provides:
 * 1. Environment detection (Docker? Node.js? Running in container?)
 * 2. Path auto-selection (single-run vs local API vs production API)
 * 3. Secure credential handling with unified storage
 * 4. .env file generation with smart defaults
 * 5. Validation and actionable error messages
 */

import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import Enquirer from 'enquirer';
import { createLogger } from '../logger';

const logger = createLogger('setup-wizard');

/**
 * Environment detection results
 */
export interface EnvironmentInfo {
  isContainer: boolean;
  hasDocker: boolean;
  hasNodeJs: boolean;
  nodeVersion: string | null;
  hasGit: boolean;
  platform: string;
  homeDir: string;
  agentsDir: string;
  hasWritePermissionToAgents: boolean; // Current user can write to /agents
  hasWritePermissionByContainerUid?: boolean; // Container UID 10000 can write to /agents
  hasSudo?: boolean; // Current user has sudo access
}

/**
 * Detected execution path
 */
export type ExecutionPath = 'single-run' | 'local-api' | 'production-api';

/**
 * Essential 8 variables for setup
 */
export interface Essential8Config {
  // Required: Authentication
  openRouterApiKey: string;
  openRouterApiKeyFile?: string;

  // Required: Execution context
  repoUrl?: string;
  gitRef?: string;
  taskPrompt?: string;

  // Required: Validation
  validationCommands: string;

  // Required: Quality gates
  kasekiMaxDiffBytes: number;
  kasekiAgentTimeoutSeconds: number;

  // API service only
  kasekiApiKeys?: string;
}

/**
 * Setup context with all collected configuration
 */
export interface SetupContext {
  path: ExecutionPath;
  essential8: Essential8Config;
  environment: EnvironmentInfo;
  autoDetectedDefaults: Record<string, string | number | boolean>;
  dotEnvPath: string;
  secretsPath: string;
  configPath: string;
}

/**
 * SetupWizard - Main orchestrator for unified setup flow
 */
export class SetupWizard {
  private enquirer: Enquirer;

  constructor() {
    this.enquirer = new Enquirer();
  }

  /**
   * Main setup flow - orchestrates all steps
   */
  async run(options?: { dryRun?: boolean; importLegacy?: boolean; force?: boolean }): Promise<SetupContext> {
    console.log('\n🚀 Kaseki Agent Unified Setup\n');
    console.log('This wizard will guide you through setup in a few simple steps.\n');

    // Step 1: Detect environment
    console.log('Step 1/5: Detecting environment...');
    const environment = await this.detectEnvironment();
    this.printEnvironmentInfo(environment);

    // Step 2: Select execution path
    console.log('\nStep 2/5: What do you want to do?');
    const path = await this.selectExecutionPath(environment, options?.force);
    console.log(`  → Selected: ${this.describeExecutionPath(path)}\n`);

    // Step 3: Collect Essential 8 configuration
    console.log('Step 3/5: Essential configuration...');
    const essential8 = await this.collectEssential8(path);

    // Step 4: Auto-detect advanced defaults
    console.log('\nStep 4/5: Auto-detecting smart defaults...');
    const autoDetectedDefaults = this.detectAdvancedDefaults(essential8, environment, path);

    // Step 5: Generate .env file
    console.log('\nStep 5/5: Setting up configuration...');
    const context: SetupContext = {
      path,
      essential8,
      environment,
      autoDetectedDefaults,
      dotEnvPath: await this.generateDotEnv(essential8, autoDetectedDefaults, options?.dryRun),
      secretsPath: await this.saveSecrets(essential8, options?.dryRun),
      configPath: await this.saveConfig(path, essential8, autoDetectedDefaults, options?.dryRun),
    };

    if (!options?.dryRun) {
      this.printSetupSuccess(context);
    }

    return context;
  }

  /**
   * Step 1: Detect environment (Docker? Node.js? Permissions?)
   */
  private async detectEnvironment(): Promise<EnvironmentInfo> {
    const homeDir = os.homedir();
    const agentsDir = '/agents';

    // Check if running in container
    const isContainer = this.isRunningInContainer();

    // Check Docker availability
    const hasDocker = this.checkDockerAvailable();

    // Check Node.js
    const nodeVersion = this.getNodeVersion();
    const hasNodeJs = nodeVersion !== null;

    // Check Git
    const hasGit = this.checkGitAvailable();

    // Check write permission to /agents by current user
    let hasWritePermissionToAgents = false;
    try {
      await fs.access(agentsDir, fs.constants.W_OK);
      hasWritePermissionToAgents = true;
    } catch {
      // Directory doesn't exist or not writable
      hasWritePermissionToAgents = false;
    }

    // Check if /agents is writable by container UID (10000) for production API
    const hasWritePermissionByContainerUid = this.checkWritePermissionByContainerUid(agentsDir);

    // Check if user has sudo access
    const hasSudo = this.checkSudoAccess();

    return {
      isContainer,
      hasDocker,
      hasNodeJs,
      nodeVersion,
      hasGit,
      platform: os.platform(),
      homeDir,
      agentsDir,
      hasWritePermissionToAgents,
      hasWritePermissionByContainerUid,
      hasSudo,
    };
  }

  /**
   * Check if running inside a container
   */
  private isRunningInContainer(): boolean {
    try {
      // Check for /.dockerenv (docker)
      execSync('test -f /.dockerenv', { stdio: 'ignore' });
      return true;
    } catch {
      // Check for cgroup cgroup markers (kubernetes, other container runtimes)
      try {
        const cgroup = readFileSync('/proc/self/cgroup', 'utf-8');
        return cgroup.includes('/docker') || cgroup.includes('/kubepods') || cgroup.includes('/lxc');
      } catch {
        return false;
      }
    }
  }

  /**
   * Check Docker availability
   */
  private checkDockerAvailable(): boolean {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      execSync('docker ps', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Node.js version
   */
  private getNodeVersion(): string | null {
    try {
      const version = execSync('node --version', { encoding: 'utf-8' }).trim();
      return version;
    } catch {
      return null;
    }
  }

  /**
   * Check Git availability
   */
  private checkGitAvailable(): boolean {
    try {
      execSync('git --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if /agents is writable by container UID 10000
   * Uses 'test -w /agents' to probe real filesystem permissions
   */
  private checkWritePermissionByContainerUid(agentsDir: string): boolean {
    try {
      // First check if directory exists
      execSync(`test -d ${agentsDir}`, { stdio: 'ignore' });

      // Try to access with current user first (fast path)
      try {
        execSync(`test -w ${agentsDir}`, { stdio: 'ignore' });
        return true; // Current user can write, so container uid 10000 should be able to (if owned by 10000)
      } catch {
        // Can't write as current user; check directory ownership
        // For production API, we need /agents to be owned by or writable by UID 10000
        try {
          const stat = execSync(`stat -c '%U:%G' ${agentsDir}`, {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();
          // If owned by 10000 (container uid), it's writable by container
          if (stat.startsWith('10000:')) {
            return true;
          }
          return false;
        } catch {
          // stat might not be available (macOS); assume not writable
          return false;
        }
      }
    } catch {
      // Directory doesn't exist or other error
      return false;
    }
  }

  /**
   * Check if user has sudo access
   */
  private checkSudoAccess(): boolean {
    try {
      execSync('sudo -n true', { stdio: 'ignore', timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Print environment detection results with context-aware messaging
   */
  private printEnvironmentInfo(env: EnvironmentInfo): void {
    console.log(`  Platform: ${env.platform}`);
    console.log(`  Container: ${env.isContainer ? '✓ Yes' : '✗ No'}`);
    console.log(`  Docker: ${env.hasDocker ? '✓ Available' : '✗ Not available'}`);
    console.log(`  Node.js: ${env.hasNodeJs ? `✓ ${env.nodeVersion}` : '✗ Not installed'}`);
    console.log(`  Git: ${env.hasGit ? '✓ Available' : '✗ Not available'}`);

    // Permission messaging with context
    const hostWritable = env.hasWritePermissionToAgents ? '✓' : '✗';
    const containerWritable = env.hasWritePermissionByContainerUid ? '✓' : '✗';
    const sudoAvailable = env.hasSudo ? 'available' : 'not available';

    console.log(`  /agents writable by you: ${hostWritable}`);
    console.log(`  /agents writable by container (UID 10000): ${containerWritable}`);
    console.log(`  sudo access: ${sudoAvailable}`);
  }

  /**
   * Step 2: Guide user to select execution path based on environment
   */
  private async selectExecutionPath(env: EnvironmentInfo, force?: boolean): Promise<ExecutionPath> {
    // If running in container already, only offer production API
    if (env.isContainer) {
      console.log('  (Running in container - using production API path)\n');
      return 'production-api';
    }

    // Otherwise, let user choose
    const choices = [
      {
        name: 'single-run',
        message: 'Single-run execution (./run-kaseki.sh directly)',
        hint: 'For one-off tasks, no persistence',
      },
      {
        name: 'local-api',
        message: 'Local API service (npm install + serve locally)',
        hint: 'For multiple tasks on one machine with CLI tooling',
      },
      {
        name: 'production-api',
        message: 'Production REST API (Docker Compose + persistent /agents)',
        hint: 'For production deployments, multi-host capable',
      },
    ];

    const answer = await this.enquirer.prompt({
      type: 'select',
      name: 'path',
      message: 'How do you want to use kaseki-agent?',
      choices,
    }) as any;

    const selectedPath = answer.path as ExecutionPath;

    // Validate production-api path requirements
    if (selectedPath === 'production-api') {
      await this.validateProductionApiPrerequisites(env, force);
    }

    return selectedPath;
  }

  /**
   * Validate prerequisites for production-api path
   * For production API, /agents must be writable by container UID 10000
   */
  private async validateProductionApiPrerequisites(env: EnvironmentInfo, _force?: boolean): Promise<void> {
    if (env.hasWritePermissionByContainerUid) {
      // All good
      return;
    }

    if (_force) {
      // Force flag bypasses validation
      logger.warn('⚠️  Skipping /agents permission validation (--force flag used)');
      console.log('\n⚠️  Warning: Skipping /agents permission validation.');
      console.log('The container may fail to write results if /agents is not writable by UID 10000.');
      console.log('You can fix permissions later by running: sudo scripts/kaseki-setup-host.sh --fix\n');
      return;
    }

    // Not writable by container UID - warn and offer solutions
    console.log('\n⚠️  Production API Prerequisites');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('The /agents directory needs to be writable by container UID 10000.');
    console.log('Currently: /agents is NOT writable by UID 10000.\n');

    if (env.hasSudo) {
      console.log('✓ You have sudo access. Run this command to fix:\n');
      console.log('  sudo scripts/kaseki-setup-host.sh --fix\n');
      console.log('Or manually:\n');
      console.log('  sudo mkdir -p /agents');
      console.log('  sudo chown 10000:10000 /agents');
      console.log('  sudo chmod 755 /agents\n');
    } else {
      console.log('✗ You do NOT have sudo access. Ask your sysadmin to run:\n');
      console.log('  sudo scripts/kaseki-setup-host.sh --fix\n');
      console.log('Or manually:\n');
      console.log('  sudo chown 10000:10000 /agents && sudo chmod 755 /agents\n');
    }

    const answer = await this.enquirer.prompt({
      type: 'confirm',
      name: 'continue',
      message: 'Have you fixed /agents permissions? (yes to continue, no to abort)',
      initial: false,
    }) as any;

    if (!answer.continue) {
      console.log('\n❌ Setup aborted. Please fix /agents permissions and try again.');
      process.exit(1);
    }

    // Re-check permissions
    const hasWritePermissionByContainerUid = this.checkWritePermissionByContainerUid(env.agentsDir);
    if (!hasWritePermissionByContainerUid) {
      console.log('\n❌ Setup aborted. /agents is still not writable by UID 10000.');
      console.log('Please run the fix command above and try again.\n');
      process.exit(1);
    }

    console.log('✓ /agents permissions verified. Continuing setup...\n');
  }

  /**
   * Describe execution path in human terms
   */
  private describeExecutionPath(path: ExecutionPath): string {
    const descriptions: Record<ExecutionPath, string> = {
      'single-run': 'One-off task execution (./run-kaseki.sh)',
      'local-api': 'Local API service (npm install + serve)',
      'production-api': 'Production REST API (Docker Compose)',
    };
    return descriptions[path];
  }

  /**
   * Step 3: Collect Essential 8 configuration variables
   */
  private async collectEssential8(executionPath: ExecutionPath): Promise<Essential8Config> {
    const answers = await this.enquirer.prompt([
      {
        type: 'password',
        name: 'openRouterApiKey',
        message: '🔑 OpenRouter API key (sk-or-...)',
        validate: (value: string) => {
          if (!value) return 'API key is required';
          if (!value.startsWith('sk-or-')) return 'API key must start with "sk-or-"';
          return true;
        },
      },
      {
        type: 'input',
        name: 'validationCommands',
        message: '✓ Validation commands (semicolon-separated)',
        initial: 'npm run check;npm run test;npm run build',
      },
      {
        type: 'number',
        name: 'kasekiMaxDiffBytes',
        message: '📏 Maximum diff size in bytes',
        initial: 400000,
      },
      {
        type: 'number',
        name: 'kasekiAgentTimeoutSeconds',
        message: '⏱️  Agent timeout in seconds',
        initial: 10800,
      },
    ]) as any;

    // For API service, also collect API keys for authentication
    let kasekiApiKeys: string | undefined;
    if (executionPath === 'local-api' || executionPath === 'production-api') {
      const apiKeyAnswer = await this.enquirer.prompt({
        type: 'input',
        name: 'kasekiApiKeys',
        message: '🔐 API service auth key (or leave empty to auto-generate)',
      }) as any;

      // Auto-generate if not provided
      kasekiApiKeys = apiKeyAnswer.kasekiApiKeys || this.generateSecureKey();
    }

    return {
      openRouterApiKey: answers.openRouterApiKey,
      openRouterApiKeyFile: path.join(os.homedir(), '.kaseki', 'secrets.json'),
      validationCommands: answers.validationCommands,
      kasekiMaxDiffBytes: answers.kasekiMaxDiffBytes,
      kasekiAgentTimeoutSeconds: answers.kasekiAgentTimeoutSeconds,
      kasekiApiKeys,
    };
  }

  /**
   * Generate secure random key for API authentication
   */
  private generateSecureKey(): string {
    return `sk-${randomBytes(32).toString('hex')}`;
  }

  /**
   * Step 4: Auto-detect advanced defaults based on environment and path
   */
  private detectAdvancedDefaults(
    essential8: Essential8Config,
    environment: EnvironmentInfo,
    executionPath: ExecutionPath
  ): Record<string, string | number | boolean> {
    const defaults: Record<string, string | number | boolean> = {
      // Execution zone
      KASEKI_MODEL: 'openrouter/free',
      KASEKI_AGENT_TIMEOUT_SECONDS: essential8.kasekiAgentTimeoutSeconds,

      // Validation zone
      KASEKI_PRE_AGENT_VALIDATION: false,
      KASEKI_VALIDATION_ALLOW_MISSING_SCRIPTS: true,

      // Quality gates zone
      KASEKI_MAX_DIFF_BYTES: essential8.kasekiMaxDiffBytes,
      KASEKI_RESTORE_DISALLOWED_CHANGES: true,

      // Caching zone
      KASEKI_CACHE_ENABLED: true,
      KASEKI_DEPENDENCY_CACHE_DIR: path.join(environment.homeDir, '.kaseki', 'cache'),
      KASEKI_GIT_CACHE_MODE: 'mirror',

      // Logging zone
      KASEKI_STREAM_PROGRESS: true,
      KASEKI_DEBUG_RAW_EVENTS: false,

      // Docker zone
      KASEKI_IMAGE: 'docker.io/cyanautomation/kaseki-agent:latest',
      KASEKI_KEEP_WORKSPACE: false,
    };

    // Production API specific
    if (executionPath === 'production-api') {
      defaults.KASEKI_API_PORT = 8080;
      defaults.KASEKI_API_MAX_CONCURRENT_RUNS = 3;
      defaults.KASEKI_LOG_DIR = '/var/log/kaseki';
    }

    // Local API specific
    if (executionPath === 'local-api') {
      defaults.KASEKI_API_PORT = 8080;
      defaults.KASEKI_API_MAX_CONCURRENT_RUNS = 2;
    }

    return defaults;
  }

  /**
   * Step 5a: Generate .env file from configuration
   */
  private async generateDotEnv(
    essential8: Essential8Config,
    autoDefaults: Record<string, string | number | boolean>,
    dryRun?: boolean
  ): Promise<string> {
    const dotEnvContent = `# Kaseki Agent Configuration
# Generated by setup wizard

# === ESSENTIAL 8 ===

# OpenRouter API Key - required for all paths
OPENROUTER_API_KEY_FILE=\${HOME}/.kaseki/secrets.json

# Validation commands - what to check after agent runs
KASEKI_VALIDATION_COMMANDS=${essential8.validationCommands}

# Quality gates
KASEKI_MAX_DIFF_BYTES=${essential8.kasekiMaxDiffBytes}
KASEKI_AGENT_TIMEOUT_SECONDS=${essential8.kasekiAgentTimeoutSeconds}

# === DEFAULTS (can be overridden) ===

KASEKI_MODEL=${autoDefaults.KASEKI_MODEL}
KASEKI_PRE_AGENT_VALIDATION=${autoDefaults.KASEKI_PRE_AGENT_VALIDATION}
KASEKI_CACHE_ENABLED=${autoDefaults.KASEKI_CACHE_ENABLED}
KASEKI_STREAM_PROGRESS=${autoDefaults.KASEKI_STREAM_PROGRESS}

${essential8.kasekiApiKeys ? `# API Service\nKASEKI_API_KEYS=${essential8.kasekiApiKeys}\nKASEKI_API_PORT=${autoDefaults.KASEKI_API_PORT}` : ''}

# === ADVANCED CONFIGURATION ===
# See docs/ADVANCED_CONFIG.md for complete reference

# Execution zone
# KASEKI_PUBLISH_MODE=off
# KASEKI_PRE_AGENT_VALIDATION=false
# KASEKI_VALIDATION_ALLOWLIST=src/**,tests/**

# Quality gates
# KASEKI_CHANGED_FILES_ALLOWLIST=src/**,tests/**
# KASEKI_RESTORE_DISALLOWED_CHANGES=true

# Caching
# KASEKI_DEPENDENCY_CACHE_DIR=\${HOME}/.kaseki/cache
# KASEKI_CACHE_ENABLED=true

# Logging & debugging
# KASEKI_DEBUG_RAW_EVENTS=false
# KASEKI_LOG_DIR=/var/log/kaseki

# Docker
# KASEKI_IMAGE=docker.io/cyanautomation/kaseki-agent:latest
# KASEKI_KEEP_WORKSPACE=false
`;

    // Write to ~/.kaseki/.env so setup never pollutes $CWD or $HOME
    const kasekiDir = path.join(os.homedir(), '.kaseki');
    const dotEnvPath = path.join(kasekiDir, '.env');

    if (!dryRun) {
      await fs.mkdir(kasekiDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(dotEnvPath, dotEnvContent, { mode: 0o644 });
      logger.debug(`Created .env file: ${dotEnvPath}`);
    }

    return dotEnvPath;
  }

  /**
   * Step 5b: Save secrets securely
   */
  private async saveSecrets(essential8: Essential8Config, dryRun?: boolean): Promise<string> {
    const secretsDir = path.join(os.homedir(), '.kaseki');
    const secretsPath = path.join(secretsDir, 'secrets.json');

    if (!dryRun) {
      // Create directory
      await fs.mkdir(secretsDir, { recursive: true, mode: 0o700 });

      // Store secrets.json with strict permissions
      const secretsContent = {
        openrouter_api_key: essential8.openRouterApiKey,
        kaseki_api_keys: essential8.kasekiApiKeys ? [essential8.kasekiApiKeys] : [],
        generated_at: new Date().toISOString(),
      };

      await fs.writeFile(secretsPath, JSON.stringify(secretsContent, null, 2), {
        mode: 0o600, // Owner read/write only
      });

      logger.debug(`Saved secrets to ${secretsPath} with mode 0600`);
    }

    return secretsPath;
  }

  /**
   * Step 5c: Save configuration
   */
  private async saveConfig(
    executionPath: ExecutionPath,
    essential8: Essential8Config,
    autoDefaults: Record<string, string | number | boolean>,
    dryRun?: boolean
  ): Promise<string> {
    const configDir = path.join(os.homedir(), '.kaseki');
    const configPath = path.join(configDir, 'config.json');

    if (!dryRun) {
      await fs.mkdir(configDir, { recursive: true, mode: 0o700 });

      const config = {
        version: '1.0',
        executionPath,
        timestamp: new Date().toISOString(),
        essential8,
        defaults: autoDefaults,
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2), {
        mode: 0o600,
      });

      logger.debug(`Saved config to ${configPath}`);
    }

    return configPath;
  }

  /**
   * Print success message with next steps
   */
  private printSetupSuccess(context: SetupContext): void {
    const pathInstructions: Record<ExecutionPath, string> = {
      'single-run': `
Run a single task with:
  export OPENROUTER_API_KEY=$(grep openrouter_api_key ${context.secretsPath} | cut -d'"' -f4)
  ./run-kaseki.sh --repo https://github.com/user/repo --ref main
      `,
      'local-api': `
Start the API service with:
  npm install
  npx kaseki-agent serve --port 8080

Then submit tasks:
  npx kaseki-agent run https://github.com/user/repo main
      `,
      'production-api': `
Start with Docker Compose:
  docker-compose up -d

Check status:
  docker-compose logs -f kaseki-api
  curl http://localhost:8080/health
      `,
    };

    console.log('\n✅ Setup complete!\n');
    console.log(`Path: ${this.describeExecutionPath(context.path)}`);
    console.log(`Config: ${context.configPath}`);
    console.log(`Secrets: ${context.secretsPath} (mode 0600)`);
    console.log(`Env file: ${context.dotEnvPath}\n`);
    console.log('📖 Next steps:');
    console.log(pathInstructions[context.path]);
    console.log('For help: https://github.com/CyanAutomation/kaseki-agent/blob/main/docs/QUICK_START.md');
  }
}
