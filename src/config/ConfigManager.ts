/**
 * Configuration Manager
 *
 * Handles 4-tier precedence:
 * 1. CLI flags/arguments (highest)
 * 2. Config file: ./kaseki-agent.json (project-local)
 * 3. Config file: ~/.kaseki/config.json (user-global)
 * 4. Environment variables
 * 5. Built-in defaults (lowest)
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { createLogger } from '../logger';

const logger = createLogger('config');

/**
 * Full configuration schema with validation
 */
export const ConfigSchema = z.object({
  // Authentication
  auth: z.object({
    openrouter_api_key_file: z.string().optional(),
    github_app_id_file: z.string().optional(),
    github_app_client_id_file: z.string().optional(),
    github_app_private_key_file: z.string().optional(),
  }).partial(),

  // Agent execution
  agent: z.object({
    model: z.string().optional(),
    provider: z.string().optional(),
    timeout_seconds: z.number().int().positive().optional(),
    guardrails: z.boolean().optional(),
  }).partial(),

  // Repository targeting
  repo: z.object({
    url: z.string().optional(),
    ref: z.string().optional(),
    task_mode: z.enum(['patch', 'inspect']).optional(),
  }).partial(),

  // Validation & quality gates
  validation: z.object({
    commands: z.array(z.string()).optional(),
    skip_missing_npm_scripts: z.boolean().optional(),
    fail_fast: z.boolean().optional(),
    validate_after_agent_failure: z.boolean().optional(),
    allowlist: z.array(z.string()).optional(),
    validation_allowlist: z.array(z.string()).optional(),
    restore_disallowed_changes: z.boolean().optional(),
    max_diff_bytes: z.number().int().positive().optional(),
    allow_empty_diff: z.boolean().optional(),
  }).partial(),

  // Dependency caching
  caching: z.object({
    dependency_cache_dir: z.string().optional(),
    dependency_restore_mode: z.enum(['copy', 'link']).optional(),
    install_ignore_scripts: z.boolean().optional(),
    npm_omit_dev: z.boolean().optional(),
    image_dependency_cache_dir: z.string().optional(),
    git_cache_mode: z.enum(['off', 'mirror']).optional(),
    git_cache_root: z.string().optional(),
  }).partial(),

  // Repository memory
  repo_memory: z.object({
    mode: z.enum(['off', 'read', 'read-write']).optional(),
    ttl_days: z.number().int().positive().optional(),
    max_bytes: z.number().int().positive().optional(),
  }).partial(),

  // GitHub integration
  github: z.object({
    app_enabled: z.boolean().optional(),
    publish_mode: z.enum(['auto', 'on', 'off']).optional(),
  }).partial(),

  // Docker configuration
  docker: z.object({
    image: z.string().optional(),
    auto_pull: z.boolean().optional(),
    container_user: z.string().optional(),
  }).partial(),

  // REST API service
  api: z.object({
    port: z.number().int().min(1).max(65535).optional(),
    keys: z.array(z.string()).optional(),
    log_level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    max_concurrent_runs: z.number().int().positive().optional(),
  }).partial(),

  // Directory paths
  directories: z.object({
    root: z.string().optional(),
    log_dir: z.string().optional(),
    cache_dir: z.string().optional(),
  }).partial(),

  // Debug & behavior flags
  debug: z.object({
    stream_progress: z.boolean().optional(),
    keep_workspace: z.boolean().optional(),
    debug_raw_events: z.boolean().optional(),
    dry_run: z.boolean().optional(),
    strict_script_check: z.boolean().optional(),
    strict_host_logging: z.boolean().optional(),
  }).partial(),
}).partial();

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Config = {
  auth: {
    openrouter_api_key_file: path.join(os.homedir(), '.kaseki', 'secrets', 'openrouter_api_key'),
  },
  agent: {
    model: 'openrouter/free',
    provider: 'openrouter',
    timeout_seconds: 1200,
    guardrails: true,
  },
  repo: {
    url: 'https://github.com/CyanAutomation/crudmapper',
    ref: 'main',
    task_mode: 'patch',
  },
  validation: {
    commands: ['npm run check', 'npm run test', 'npm run build'],
    skip_missing_npm_scripts: true,
    fail_fast: true,
    validate_after_agent_failure: false,
    allowlist: ['src/lib/parser.ts', 'tests/parser.validation.ts'],
    restore_disallowed_changes: true,
    max_diff_bytes: 200000,
    allow_empty_diff: false,
  },
  caching: {
    dependency_cache_dir: '/workspace/.kaseki-cache',
    dependency_restore_mode: 'copy',
    install_ignore_scripts: true,
    npm_omit_dev: false,
    git_cache_mode: 'off',
  },
  repo_memory: {
    mode: 'off',
    ttl_days: 30,
    max_bytes: 8000,
  },
  github: {
    app_enabled: false,
    publish_mode: 'auto',
  },
  docker: {
    image: 'docker.io/cyanautomation/kaseki-agent:latest',
    auto_pull: true,
    container_user: '10000:10000',
  },
  api: {
    port: 8080,
    log_level: 'info',
    max_concurrent_runs: 3,
  },
  directories: {
    root: '/agents',
    log_dir: '/var/log/kaseki',
  },
  debug: {
    stream_progress: true,
    keep_workspace: false,
    debug_raw_events: false,
    dry_run: false,
    strict_script_check: false,
    strict_host_logging: false,
  },
};

export class ConfigManager {
  private config: Config = { ...DEFAULT_CONFIG };
  private configFilePath: string | null = null;
  private loaded = false;

  /**
   * Initialize and load configuration
   * Loads from: project-local config > user config > environment > defaults
   */
  async load(overrideConfigPath?: string): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      // Start with defaults
      this.config = this.deepMerge(DEFAULT_CONFIG, {});

      // Load project-local config
      const projectConfigPath = path.join(process.cwd(), 'kaseki-agent.json');
      const projectConfig = await this.tryLoadConfigFile(projectConfigPath);
      if (projectConfig) {
        this.config = this.deepMerge(this.config, projectConfig);
        this.configFilePath = projectConfigPath;
        logger.debug(`Loaded project config: ${projectConfigPath}`);
      }

      // Load user-global config
      const userConfigPath = path.join(os.homedir(), '.kaseki', 'config.json');
      const userConfig = await this.tryLoadConfigFile(userConfigPath);
      if (userConfig) {
        this.config = this.deepMerge(this.config, userConfig);
        // Only set configFilePath to user config if project config wasn't found
        if (!projectConfig) {
          this.configFilePath = userConfigPath;
        }
        logger.debug(`Loaded user config: ${userConfigPath}`);
      }

      // Load override config if provided
      if (overrideConfigPath) {
        const overrideConfig = await this.tryLoadConfigFile(overrideConfigPath);
        if (overrideConfig) {
          this.config = this.deepMerge(this.config, overrideConfig);
          this.configFilePath = overrideConfigPath;
          logger.debug(`Loaded override config: ${overrideConfigPath}`);
        }
      }

      // Apply environment variables (override config files)
      this.applyEnvironmentVariables();

      // Validate final configuration
      this.config = ConfigSchema.parse(this.config);

      this.loaded = true;
      logger.debug('Configuration loaded successfully');
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error(`Configuration validation error: ${error.message}`);
        throw new Error(`Invalid configuration: ${error.errors[0]?.message}`);
      }
      throw error;
    }
  }

  /**
   * Try to load config from file, return null if file doesn't exist
   */
  private async tryLoadConfigFile(filePath: string): Promise<Config | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      if (error instanceof SyntaxError) {
        logger.warn(`Malformed config file: ${filePath}`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Apply environment variables to config (lowest priority after files)
   * Maps KASEKI_* and OPENROUTER_* env vars to config keys
   */
  private applyEnvironmentVariables(): void {
    const envMap: Record<string, (value: string) => any> = {
      // Auth
      OPENROUTER_API_KEY_FILE: (v) => {
        if (!this.config.auth) this.config.auth = {};
        this.config.auth.openrouter_api_key_file = v;
      },
      GITHUB_APP_ID_FILE: (v) => {
        if (!this.config.auth) this.config.auth = {};
        this.config.auth.github_app_id_file = v;
      },
      GITHUB_APP_CLIENT_ID_FILE: (v) => {
        if (!this.config.auth) this.config.auth = {};
        this.config.auth.github_app_client_id_file = v;
      },
      GITHUB_APP_PRIVATE_KEY_FILE: (v) => {
        if (!this.config.auth) this.config.auth = {};
        this.config.auth.github_app_private_key_file = v;
      },

      // Agent
      KASEKI_MODEL: (v) => {
        if (!this.config.agent) this.config.agent = {};
        this.config.agent.model = v;
      },
      KASEKI_PROVIDER: (v) => {
        if (!this.config.agent) this.config.agent = {};
        this.config.agent.provider = v;
      },
      KASEKI_AGENT_TIMEOUT_SECONDS: (v) => {
        if (!this.config.agent) this.config.agent = {};
        this.config.agent.timeout_seconds = parseInt(v, 10);
      },

      // Repo
      REPO_URL: (v) => {
        if (!this.config.repo) this.config.repo = {};
        this.config.repo.url = v;
      },
      GIT_REF: (v) => {
        if (!this.config.repo) this.config.repo = {};
        this.config.repo.ref = v;
      },

      // Validation
      KASEKI_VALIDATION_COMMANDS: (v) => {
        if (!this.config.validation) this.config.validation = {};
        this.config.validation.commands = v.split(';').map((c) => c.trim());
      },
      KASEKI_MAX_DIFF_BYTES: (v) => {
        if (!this.config.validation) this.config.validation = {};
        this.config.validation.max_diff_bytes = parseInt(v, 10);
      },

      // Docker
      KASEKI_IMAGE: (v) => {
        if (!this.config.docker) this.config.docker = {};
        this.config.docker.image = v;
      },

      // API
      KASEKI_API_PORT: (v) => {
        if (!this.config.api) this.config.api = {};
        this.config.api.port = parseInt(v, 10);
      },
      KASEKI_API_KEYS: (v) => {
        if (!this.config.api) this.config.api = {};
        this.config.api.keys = v.split(',').map((k) => k.trim());
      },

      // Directories
      KASEKI_ROOT: (v) => {
        if (!this.config.directories) this.config.directories = {};
        this.config.directories.root = v;
      },
      KASEKI_LOG_DIR: (v) => {
        if (!this.config.directories) this.config.directories = {};
        this.config.directories.log_dir = v;
      },
    };

    for (const [envKey, setter] of Object.entries(envMap)) {
      const value = process.env[envKey];
      if (value !== undefined) {
        setter(value);
      }
    }
  }

  /**
   * Deep merge objects (right overwrites left)
   */
  private deepMerge(target: any, source: any): any {
    if (!source) return target;

    const result = { ...target };

    for (const key in source) {
      if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * Get entire configuration
   */
  getConfig(): Readonly<Config> {
    if (!this.loaded) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * Get specific config value by dot-notation path
   */
  get<T = any>(path: string, defaultValue?: T): T {
    if (!this.loaded) {
      throw new Error('Configuration not loaded. Call load() first.');
    }

    const parts = path.split('.');
    let current: any = this.config;

    for (const part of parts) {
      if (current?.[part] === undefined) {
        if (defaultValue !== undefined) {
          return defaultValue;
        }
        throw new Error(`Configuration key not found: ${path}`);
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Set configuration value
   */
  set(path: string, value: any): void {
    const parts = path.split('.');
    const lastPart = parts.pop();

    if (!lastPart) {
      throw new Error('Invalid configuration path');
    }

    let current: any = this.config;

    for (const part of parts) {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }

    current[lastPart] = value;
  }

  /**
   * Save configuration to file
   */
  async save(filePath?: string): Promise<void> {
    const targetPath = filePath || this.configFilePath;
    if (!targetPath) {
      throw new Error('No config file path specified for saving');
    }

    try {
      const dir = path.dirname(targetPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(targetPath, JSON.stringify(this.config, null, 2), 'utf-8');
      logger.debug(`Configuration saved to: ${targetPath}`);
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error}`);
    }
  }

  /**
   * Get config file path (for reference/logging)
   */
  getConfigFilePath(): string | null {
    return this.configFilePath;
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.configFilePath = null;
    this.loaded = false;
  }
}
