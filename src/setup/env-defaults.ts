/**
 * Environment Variable Defaults & Configuration Zones
 *
 * Defines:
 * 1. Essential 8 variables (required by all setup paths)
 * 2. Auto-detected defaults based on environment/path
 * 3. Variable zones for logical grouping
 * 4. Intelligent defaults for 50+ advanced variables
 *
 * Philosophy: Show users minimal configuration, auto-detect sensible defaults
 */

export type ExecutionPath = 'single-run' | 'local-api' | 'production-api';

/**
 * Configuration zones - logical grouping of related variables
 */
export const CONFIG_ZONES = {
  EXECUTION: 'Execution',
  VALIDATION: 'Validation & Quality Gates',
  CACHING: 'Caching & Performance',
  INFRASTRUCTURE: 'Infrastructure (API Service Only)',
  ADVANCED: 'Advanced & Experimental',
} as const;

/**
 * Essential 8 variables - required/important for all paths
 *
 * These are the only variables shown to first-time users.
 * All other variables have intelligent defaults.
 */
export const ESSENTIAL_8_VARIABLES = [
  'OPENROUTER_API_KEY_FILE',
  'KASEKI_VALIDATION_COMMANDS',
  'KASEKI_AGENT_TIMEOUT_SECONDS',
  'KASEKI_MAX_DIFF_BYTES',
  'KASEKI_MODEL',
  'KASEKI_PRE_AGENT_VALIDATION',
  'KASEKI_STREAM_PROGRESS',
  'KASEKI_API_KEYS', // API service only
] as const;

/**
 * Variable definitions with metadata
 */
export interface VariableDefinition {
  name: string;
  zone: typeof CONFIG_ZONES[keyof typeof CONFIG_ZONES];
  description: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  essential: boolean;
  paths: ExecutionPath[]; // Which paths use this variable
  defaultValue?: string | number | boolean;
  examples?: string[];
  autoDetect?: (env: EnvironmentContext) => string | number | boolean | undefined;
}

/**
 * Environment context for auto-detection
 */
export interface EnvironmentContext {
  platform: string;
  homeDir: string;
  cwd: string;
  isContainer: boolean;
  hasDocker: boolean;
  hasNodeJs: boolean;
  hasGit: boolean;
  executionPath: ExecutionPath;
  // Detected language/framework (if possible)
  detectedLanguage?: 'typescript' | 'python' | 'go' | 'rust' | 'javascript' | 'unknown';
  detectedFramework?: 'next' | 'react' | 'vue' | 'django' | 'fastapi' | 'unknown';
}

/**
 * Comprehensive variable registry (60+ variables)
 */
export const VARIABLE_REGISTRY: VariableDefinition[] = [
  // === EXECUTION ZONE ===

  {
    name: 'OPENROUTER_API_KEY_FILE',
    zone: CONFIG_ZONES.EXECUTION,
    description: 'Path to file containing OpenRouter API key (mode 0600)',
    type: 'string',
    essential: true,
    paths: ['single-run', 'local-api', 'production-api'],
    autoDetect: (env) => `${env.homeDir}/.kaseki/secrets.json`,
  },

  {
    name: 'KASEKI_MODEL',
    zone: CONFIG_ZONES.EXECUTION,
    description: 'AI model to use (openrouter/free, openrouter/openai/gpt-4, etc)',
    type: 'string',
    essential: true,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: 'openrouter/free',
    examples: ['openrouter/free', 'openrouter/openai/gpt-4-turbo', 'openrouter/anthropic/claude-3-opus'],
  },

  {
    name: 'REPO_URL',
    zone: CONFIG_ZONES.EXECUTION,
    description: 'Target repository URL (github, gitlab, etc)',
    type: 'string',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    examples: ['https://github.com/user/repo', 'https://gitlab.com/org/project'],
  },

  {
    name: 'GIT_REF',
    zone: CONFIG_ZONES.EXECUTION,
    description: 'Git branch, tag, or commit to target',
    type: 'string',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: 'main',
    examples: ['main', 'develop', 'v1.2.3', 'abc123def456'],
  },

  {
    name: 'TASK_PROMPT',
    zone: CONFIG_ZONES.EXECUTION,
    description: 'Instruction for what the agent should do',
    type: 'string',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    examples: [
      'Fix all TypeScript errors',
      'Update dependencies to latest versions',
      'Add comprehensive error handling',
    ],
  },

  {
    name: 'KASEKI_PUBLISH_MODE',
    zone: CONFIG_ZONES.EXECUTION,
    description: 'How to publish results (off, branch, pr, draft_pr)',
    type: 'string',
    essential: false,
    paths: ['local-api', 'production-api'],
    defaultValue: 'off',
    examples: ['off', 'branch', 'pr', 'draft_pr'],
  },

  // === VALIDATION & QUALITY GATES ZONE ===

  {
    name: 'KASEKI_VALIDATION_COMMANDS',
    zone: CONFIG_ZONES.VALIDATION,
    description: 'Commands to run after agent completes (semicolon-separated)',
    type: 'string',
    essential: true,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: 'npm run check;npm run test;npm run build',
    examples: [
      'npm run check;npm run test;npm run build',
      'cargo test;cargo fmt --check',
      'pytest;mypy .',
    ],
  },

  {
    name: 'KASEKI_PRE_AGENT_VALIDATION',
    zone: CONFIG_ZONES.VALIDATION,
    description: 'Run validation commands before agent (to check baseline)',
    type: 'boolean',
    essential: true,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: false,
  },

  {
    name: 'KASEKI_VALIDATION_ALLOW_MISSING_SCRIPTS',
    zone: CONFIG_ZONES.VALIDATION,
    description: 'Skip missing npm scripts instead of failing (non-fatal)',
    type: 'boolean',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: true,
  },

  {
    name: 'KASEKI_MAX_DIFF_BYTES',
    zone: CONFIG_ZONES.VALIDATION,
    description: 'Maximum allowed diff size in bytes (quality gate)',
    type: 'number',
    essential: true,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: 200000,
    examples: ['200000 (200KB)', '400000 (400KB)', '1000000 (1MB)'],
  },

  {
    name: 'KASEKI_CHANGED_FILES_ALLOWLIST',
    zone: CONFIG_ZONES.VALIDATION,
    description: 'Space-separated glob patterns of files agent can modify',
    type: 'string',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    examples: [
      'src/**',
      'src/** tests/**',
      'lib/** *.json',
    ],
  },

  {
    name: 'KASEKI_VALIDATION_ALLOWLIST',
    zone: CONFIG_ZONES.VALIDATION,
    description: 'Files to check during post-agent validation (overrides changed allowlist)',
    type: 'string',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
  },

  {
    name: 'KASEKI_RESTORE_DISALLOWED_CHANGES',
    zone: CONFIG_ZONES.VALIDATION,
    description: 'Restore files outside allowlist before validation (safe by default)',
    type: 'boolean',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: true,
  },

  {
    name: 'KASEKI_AGENT_TIMEOUT_SECONDS',
    zone: CONFIG_ZONES.VALIDATION,
    description: 'Maximum time agent can run (in seconds)',
    type: 'number',
    essential: true,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: 1200,
    examples: ['1200 (20 min)', '2400 (40 min)', '3600 (1 hour)'],
  },

  // === CACHING & PERFORMANCE ZONE ===

  {
    name: 'KASEKI_DEPENDENCY_CACHE_DIR',
    zone: CONFIG_ZONES.CACHING,
    description: 'Directory for caching npm/pip/other dependencies',
    type: 'string',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    autoDetect: (env) => `${env.homeDir}/.kaseki/cache`,
  },

  {
    name: 'KASEKI_CACHE_ENABLED',
    zone: CONFIG_ZONES.CACHING,
    description: 'Enable dependency caching (4-layer cache strategy)',
    type: 'boolean',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: true,
  },

  {
    name: 'KASEKI_GIT_CACHE_MODE',
    zone: CONFIG_ZONES.CACHING,
    description: 'Git caching mode (off, mirror)',
    type: 'string',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: 'mirror',
  },

  {
    name: 'KASEKI_STREAM_PROGRESS',
    zone: CONFIG_ZONES.CACHING,
    description: 'Stream sanitized progress lines to stdout (set to 0 to reduce noise)',
    type: 'boolean',
    essential: true,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: true,
  },

  {
    name: 'KASEKI_DEBUG_RAW_EVENTS',
    zone: CONFIG_ZONES.ADVANCED,
    description: 'Keep raw Pi JSONL events (for debugging)',
    type: 'boolean',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: false,
  },

  // === INFRASTRUCTURE ZONE (API Service Only) ===

  {
    name: 'KASEKI_API_KEYS',
    zone: CONFIG_ZONES.INFRASTRUCTURE,
    description: 'Comma/newline-separated bearer tokens for API authentication',
    type: 'string',
    essential: true,
    paths: ['local-api', 'production-api'],
  },

  {
    name: 'KASEKI_API_PORT',
    zone: CONFIG_ZONES.INFRASTRUCTURE,
    description: 'Port for API service to listen on',
    type: 'number',
    essential: false,
    paths: ['local-api', 'production-api'],
    defaultValue: 8080,
  },

  {
    name: 'KASEKI_API_MAX_CONCURRENT_RUNS',
    zone: CONFIG_ZONES.INFRASTRUCTURE,
    description: 'Maximum concurrent agent runs (tune based on resources)',
    type: 'number',
    essential: false,
    paths: ['local-api', 'production-api'],
    autoDetect: (env) => (env.executionPath === 'local-api' ? 2 : 3),
  },

  {
    name: 'KASEKI_LOG_DIR',
    zone: CONFIG_ZONES.INFRASTRUCTURE,
    description: 'Directory for host-level logs (production only)',
    type: 'string',
    essential: false,
    paths: ['production-api'],
    defaultValue: '/var/log/kaseki',
  },

  {
    name: 'KASEKI_ROOT',
    zone: CONFIG_ZONES.INFRASTRUCTURE,
    description: 'Base directory for runs/results (must be writable by UID 10000)',
    type: 'string',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: '/agents',
  },

  // === ADVANCED & EXPERIMENTAL ===

  {
    name: 'KASEKI_IMAGE',
    zone: CONFIG_ZONES.ADVANCED,
    description: 'Docker image to use for agent container',
    type: 'string',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: 'docker.io/cyanautomation/kaseki-agent:latest',
  },

  {
    name: 'KASEKI_KEEP_WORKSPACE',
    zone: CONFIG_ZONES.ADVANCED,
    description: 'Keep workspace after run (default: cleanup)',
    type: 'boolean',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: false,
  },

  {
    name: 'KASEKI_DRY_RUN',
    zone: CONFIG_ZONES.ADVANCED,
    description: 'Validate setup without running agent (useful for testing)',
    type: 'boolean',
    essential: false,
    paths: ['single-run', 'local-api', 'production-api'],
    defaultValue: false,
  },

  {
    name: 'GITHUB_APP_ENABLED',
    zone: CONFIG_ZONES.ADVANCED,
    description: 'Enable GitHub App for PR creation',
    type: 'boolean',
    essential: false,
    paths: ['local-api', 'production-api'],
    defaultValue: false,
  },

  {
    name: 'GITHUB_APP_ID',
    zone: CONFIG_ZONES.ADVANCED,
    description: 'GitHub App ID (from GitHub settings)',
    type: 'string',
    essential: false,
    paths: ['local-api', 'production-api'],
  },

  {
    name: 'GITHUB_APP_PRIVATE_KEY_FILE',
    zone: CONFIG_ZONES.ADVANCED,
    description: 'Path to GitHub App private key (PEM format)',
    type: 'string',
    essential: false,
    paths: ['local-api', 'production-api'],
  },
];

/**
 * Get default value for a variable based on environment
 */
export function getDefaultValue(
  variable: VariableDefinition,
  environment: EnvironmentContext
): string | number | boolean | undefined {
  // Use auto-detection if available
  if (variable.autoDetect) {
    const detected = variable.autoDetect(environment);
    if (detected !== undefined) {
      return detected;
    }
  }

  // Fall back to static default
  return variable.defaultValue;
}

/**
 * Get variables for a specific zone
 */
export function getVariablesByZone(
  zone: typeof CONFIG_ZONES[keyof typeof CONFIG_ZONES]
): VariableDefinition[] {
  return VARIABLE_REGISTRY.filter((v) => v.zone === zone);
}

/**
 * Get variables for a specific execution path
 */
export function getVariablesByPath(path: ExecutionPath): VariableDefinition[] {
  return VARIABLE_REGISTRY.filter((v) => v.paths.includes(path));
}

/**
 * Get essential variables only
 */
export function getEssentialVariables(): VariableDefinition[] {
  return VARIABLE_REGISTRY.filter((v) => v.essential);
}

/**
 * Validate a variable value against its definition
 */
export function validateVariable(
  variable: VariableDefinition,
  value: any
): { valid: boolean; error?: string } {
  switch (variable.type) {
    case 'string':
      if (typeof value !== 'string') {
        return { valid: false, error: `Expected string, got ${typeof value}` };
      }
      // Validate specific constraints (e.g., API key format)
      if (variable.name === 'OPENROUTER_API_KEY_FILE') {
        // Should be a valid file path
        if (!value.startsWith('/') && !value.startsWith('~')) {
          return { valid: false, error: 'Must be an absolute path or ~/' };
        }
      }
      return { valid: true };

    case 'number':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { valid: false, error: `Expected integer, got ${typeof value}` };
      }
      if (value <= 0) {
        return { valid: false, error: 'Must be greater than 0' };
      }
      return { valid: true };

    case 'boolean':
      if (typeof value !== 'boolean') {
        return { valid: false, error: `Expected boolean, got ${typeof value}` };
      }
      return { valid: true };

    case 'array':
      if (!Array.isArray(value)) {
        return { valid: false, error: `Expected array, got ${typeof value}` };
      }
      return { valid: true };

    default:
      return { valid: true };
  }
}
