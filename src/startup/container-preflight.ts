/**
 * Container Preflight Diagnostics
 *
 * Runs container-safe startup checks to validate:
 * 1. Setup completeness — did "sudo kaseki-agent host setup --fix" run?
 * 2. Setup staleness — is the setup still fresh (permissions, git config)?
 *
 * All checks can run as UID 10000 (the container user) without requiring root privileges.
 * This module runs once at container startup and stores results in memory.
 * Later /api/preflight calls expose this cache as boot history only; they do
 * not treat it as current readiness.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { KasekiApiConfig } from '../kaseki-api-config';
import { createEventLogger } from '../logger';
import { PreflightCheck } from '../kaseki-api-types';

const logger = createEventLogger('container-preflight');

/**
 * In-memory cache for container preflight results.
 * These are populated once at startup and exposed by /api/preflight as
 * cached startup history. They are not rerun per request and must not be
 * interpreted as current readiness.
 */
let cachedContainerPreflightResults: {
  timestamp: string;
  checks: PreflightCheck[];
} | null = null;

export class ContainerPreflightDiagnostics {
  constructor(_config: KasekiApiConfig) {
    // Config is not currently used, but kept for future extensibility
    // All environment variables are accessed directly
  }

  /**
   * Helper to measure elapsed time for a check
   */
  private measureCheck(
    fn: () => PreflightCheck,
  ): PreflightCheck {
    const startTime = performance.now();
    const result = fn();
    const elapsedMs = performance.now() - startTime;
    return { ...result, elapsedMs };
  }

  /**
   * Run all container-safe preflight checks.
   * Returns structured array of PreflightCheck results.
   * All checks are non-blocking and safe to run as UID 10000.
   */
  run(): PreflightCheck[] {
    const runStartTime = performance.now();
    const checks: PreflightCheck[] = [];

    // ✅ Check 1: /agents directory structure exists and is readable
    checks.push(this.measureCheck(() => this.checkSetupCompleteness()));

    // ✅ Check 2: Secrets directory is readable
    checks.push(this.measureCheck(() => this.checkSecretsReadable()));

    // ✅ Check 3: Checkout directory exists and is readable
    checks.push(this.measureCheck(() => this.checkCheckoutExists()));

    // ✅ Check 4: Git freshness probe (can we read .git metadata?)
    checks.push(this.measureCheck(() => this.checkGitFreshness()));

    // ✅ Check 5: Git safe.directory configuration
    checks.push(this.measureCheck(() => this.checkGitSafeDirectory()));

    // ✅ Check 6: Template bootstrap files present
    checks.push(this.measureCheck(() => this.checkTemplateBootstrap()));

    // ✅ Check 7: Deleted bind mounts
    checks.push(this.measureCheck(() => this.checkDeletedBindMounts()));

    // Log timing summary
    const totalElapsed = performance.now() - runStartTime;
    const slowChecks = checks.filter(c => (c.elapsedMs || 0) > 100); // Warn if any check > 100ms
    if (slowChecks.length > 0) {
      logger.debug('Slow preflight checks detected', {
        checks: slowChecks.map(c => ({
          name: c.name,
          elapsedMs: c.elapsedMs?.toFixed(1),
        })),
      });
    }
    logger.debug('Container preflight checks completed', {
      checkCount: checks.length,
      totalElapsedMs: totalElapsed.toFixed(1),
    });

    return checks;
  }

  /**
   * Check 1: Setup Completeness
   * Verify /agents subdirectories exist and are readable by UID 10000
   */
  private checkSetupCompleteness(): PreflightCheck {
    const kasekiRoot = process.env.KASEKI_ROOT || '/agents';
    const requiredDirs = [
      path.join(kasekiRoot, 'kaseki-results'),
      path.join(kasekiRoot, 'kaseki-runs'),
      path.join(kasekiRoot, 'kaseki-cache'),
    ];

    const missingDirs: string[] = [];
    const unreadableDirs: string[] = [];

    for (const dir of requiredDirs) {
      if (!fs.existsSync(dir)) {
        missingDirs.push(dir);
      } else {
        try {
          fs.accessSync(dir, fs.constants.R_OK);
        } catch {
          unreadableDirs.push(dir);
        }
      }
    }

    if (missingDirs.length === 0 && unreadableDirs.length === 0) {
      return {
        name: 'setup-completeness',
        ok: true,
        detail: 'Required /agents subdirectories exist and are readable',
      };
    }

    const issues: string[] = [];
    if (missingDirs.length > 0) {
      issues.push(`Missing directories: ${missingDirs.join(', ')}`);
    }
    if (unreadableDirs.length > 0) {
      issues.push(`Unreadable directories: ${unreadableDirs.join(', ')}`);
    }

    return {
      name: 'setup-completeness',
      ok: false,
      detail: issues.join('; '),
      remediation: 'Run: sudo kaseki-agent host setup --fix',
    };
  }

  /**
   * Check 2: Secrets Readable
   * Verify secrets directory and critical secret files are readable
   */
  private checkSecretsReadable(): PreflightCheck {
    const secretsDir = process.env.KASEKI_SECRETS_DIR || '/run/secrets/kaseki';
    const requiredSecrets = [
      'openrouter_api_key',
      'kaseki_api_keys',
    ];

    if (!fs.existsSync(secretsDir)) {
      return {
        name: 'secrets-readable',
        ok: false,
        detail: `Secrets directory does not exist: ${secretsDir}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      };
    }

    try {
      fs.accessSync(secretsDir, fs.constants.R_OK);
    } catch {
      return {
        name: 'secrets-readable',
        ok: false,
        detail: `Secrets directory is not readable: ${secretsDir}`,
        remediation: `Fix permissions: sudo chown -R 10000:10000 ${secretsDir} && sudo chmod 0750 ${secretsDir}`,
      };
    }

    const missingSecrets: string[] = [];
    const unreadableSecrets: string[] = [];

    for (const secret of requiredSecrets) {
      const secretPath = path.join(secretsDir, secret);
      if (!fs.existsSync(secretPath)) {
        missingSecrets.push(secret);
      } else {
        try {
          fs.accessSync(secretPath, fs.constants.R_OK);
        } catch {
          unreadableSecrets.push(secret);
        }
      }
    }

    if (missingSecrets.length === 0 && unreadableSecrets.length === 0) {
      return {
        name: 'secrets-readable',
        ok: true,
        detail: 'Secrets directory is readable and required secrets are accessible',
      };
    }

    const issues: string[] = [];
    if (missingSecrets.length > 0) {
      issues.push(`Missing secrets: ${missingSecrets.join(', ')}`);
    }
    if (unreadableSecrets.length > 0) {
      issues.push(`Unreadable secrets: ${unreadableSecrets.join(', ')}`);
    }

    return {
      name: 'secrets-readable',
      ok: false,
      detail: issues.join('; '),
      remediation: 'Run: sudo kaseki-agent host setup --fix',
    };
  }

  /**
   * Check 3: Checkout Exists
   * Verify /agents/kaseki-agent exists and is readable
   */
  private checkCheckoutExists(): PreflightCheck {
    const checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent';

    if (!fs.existsSync(checkoutDir)) {
      return {
        name: 'checkout-exists',
        ok: false,
        detail: `Checkout directory does not exist: ${checkoutDir}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      };
    }

    try {
      fs.accessSync(checkoutDir, fs.constants.R_OK);
      return {
        name: 'checkout-exists',
        ok: true,
        detail: `Checkout directory exists and is readable: ${checkoutDir}`,
      };
    } catch {
      return {
        name: 'checkout-exists',
        ok: false,
        detail: `Checkout directory is not readable: ${checkoutDir}`,
        remediation: `Fix permissions: sudo chown -R 10000:10000 ${checkoutDir}`,
      };
    }
  }

  /**
   * Check 4: Git Freshness
   * Attempt to run git commands in the checkout directory as UID 10000.
   * This detects if git safe.directory is misconfigured (critical issue for bootstrap).
   */
  private checkGitFreshness(): PreflightCheck {
    const checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent';
    const gitDir = path.join(checkoutDir, '.git');

    if (!fs.existsSync(gitDir)) {
      return {
        name: 'git-freshness',
        ok: false,
        detail: `Git directory is missing or inaccessible: ${gitDir}`,
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      };
    }

    // Attempt git rev-parse HEAD to check if git can read the repository
    const result = spawnSync('git', ['-C', checkoutDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status === 0) {
      const ref = (result.stdout || '').trim();
      return {
        name: 'git-freshness',
        ok: true,
        detail: `Git repository is readable and at ref: ${ref.substring(0, 8)}`,
      };
    }

    // Parse git error to provide better diagnostics
    const stderr = (result.stderr || '').toLowerCase();
    let detail = 'Git command failed when reading repository';
    let remediation = `Fix permissions so ${checkoutDir} is readable by UID 10000`;

    if (stderr.includes('dubious ownership') || stderr.includes('permission denied')) {
      detail = 'Git reports dubious ownership or permission denied';
      remediation = `Configure git safe.directory: git config --global --add safe.directory ${checkoutDir}`;
    } else if (stderr.includes('not a git repository')) {
      detail = `${gitDir} exists but is not a valid git repository`;
      remediation = 'Run: sudo kaseki-agent host setup --fix';
    }

    return {
      name: 'git-freshness',
      ok: false,
      detail,
      remediation,
      doctorStderrTail: (result.stderr || '').substring(0, 200),
    };
  }

  /**
   * Check 5: Git Safe.directory Configuration
   * Read-only check: verify git config has safe.directory set (to prevent future dubious ownership).
   * This is a soft check — git can work even if not set yet, but it's a warning sign.
   */
  private checkGitSafeDirectory(): PreflightCheck {
    const checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent';

    if (!fs.existsSync(path.join(checkoutDir, '.git'))) {
      return {
        name: 'git-safe-directory',
        ok: false,
        detail: 'Git directory missing; cannot verify safe.directory configuration',
        remediation: 'Run: sudo kaseki-agent host setup --fix',
      };
    }

    // Read current git config to check if safe.directory is set
    const result = spawnSync('git', ['config', '--global', '--get-all', 'safe.directory'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const configuredDirs = (result.stdout || '').trim().split('\n').filter(Boolean);
    const isConfigured = configuredDirs.includes(checkoutDir);

    if (isConfigured) {
      return {
        name: 'git-safe-directory',
        ok: true,
        detail: `Git safe.directory is configured for ${checkoutDir}`,
      };
    }

    // Enhanced diagnostics for not-configured state
    const currentDirs = configuredDirs.length > 0
      ? `${configuredDirs.join(', ')}`
      : 'none configured';

    return {
      name: 'git-safe-directory',
      ok: false,
      detail: `Git safe.directory not configured for ${checkoutDir}. Currently: ${currentDirs}`,
      remediation: `Configure: git config --global --add safe.directory ${checkoutDir}`,
    };
  }

  /**
   * Check 6: Template Bootstrap
   * Verify run-kaseki.sh and other critical template files are present and executable
   */
  private checkTemplateBootstrap(): PreflightCheck {
    const templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template';
    const requiredFiles = [
      'run-kaseki.sh',
      'kaseki-agent.sh',
      'scripts/kaseki-preflight.sh',
      'scripts/startup-checks.sh',
    ];

    const missingFiles: string[] = [];
    const unexecutableFiles: string[] = [];

    for (const file of requiredFiles) {
      const filePath = path.join(templateDir, file);
      if (!fs.existsSync(filePath)) {
        missingFiles.push(file);
      } else {
        try {
          fs.accessSync(filePath, fs.constants.X_OK);
        } catch {
          unexecutableFiles.push(file);
        }
      }
    }

    if (missingFiles.length === 0 && unexecutableFiles.length === 0) {
      return {
        name: 'template-bootstrap',
        ok: true,
        detail: 'All required template bootstrap files are present and executable',
        templatePath: templateDir,
      };
    }

    const issues: string[] = [];
    if (missingFiles.length > 0) {
      issues.push(`Missing: ${missingFiles.join(', ')}`);
    }
    if (unexecutableFiles.length > 0) {
      issues.push(`Not executable: ${unexecutableFiles.join(', ')}`);
    }

    return {
      name: 'template-bootstrap',
      ok: false,
      detail: issues.join('; '),
      remediation: 'Run: sudo kaseki-agent host setup --fix',
      templatePath: templateDir,
    };
  }

  /**
   * Check 7: Deleted Bind Mounts
   * Read /proc/self/mountinfo to detect if required volumes are stale/deleted
   */
  private checkDeletedBindMounts(): PreflightCheck {
    try {
      const mountinfo = fs.readFileSync('/proc/self/mountinfo', 'utf-8');
      if (mountinfo.includes(' deleted')) {
        return {
          name: 'deleted-bind-mounts',
          ok: false,
          detail: 'Detected deleted bind mount in /proc/self/mountinfo',
          remediation: 'Recreate the kaseki-api container: docker-compose up -d --force-recreate kaseki-api',
        };
      }

      return {
        name: 'deleted-bind-mounts',
        ok: true,
        detail: 'No deleted bind mounts detected',
      };
    } catch {
      // If we can't read /proc/self/mountinfo, assume we're not in a container (edge case)
      return {
        name: 'deleted-bind-mounts',
        ok: true,
        detail: 'Could not read /proc/self/mountinfo; skipping check',
      };
    }
  }
}

/**
 * Log container preflight diagnostics results and cache them for later access via /api/preflight.
 * Non-blocking warnings are surfaced to logs and API metrics.
 */
export function logContainerPreflightResults(checks: PreflightCheck[]): void {
  const failedChecks = checks.filter((check) => !check.ok);

  // Cache results for /api/preflight endpoint to access
  cachedContainerPreflightResults = {
    timestamp: new Date().toISOString(),
    checks,
  };

  if (failedChecks.length === 0) {
    logger.info('✅ All container preflight checks passed');
    return;
  }

  logger.warn(`⚠️ Container preflight diagnostics completed with ${failedChecks.length} warning(s):`);

  for (const check of failedChecks) {
    logger.warn(`  • ${check.name}: ${check.detail}`);
    if (check.remediation) {
      logger.warn(`    → Remediation: ${check.remediation}`);
    }
  }

  logger.warn('');
  logger.warn('The API will continue to start. See /api/preflight for full details.');
}

/**
 * Get cached container preflight results (populated at startup).
 * Returns null if diagnostics haven't been run yet.
 */
export function getContainerPreflightResults(): { timestamp: string; checks: PreflightCheck[] } | null {
  return cachedContainerPreflightResults;
}

/**
 * Clear cached container preflight results. Intended for tests and controlled
 * service lifecycle resets.
 */
export function clearContainerPreflightResults(): void {
  cachedContainerPreflightResults = null;
}
