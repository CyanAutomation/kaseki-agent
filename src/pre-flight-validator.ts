import { spawn } from 'child_process';
import { ValidationCheck, ValidationResponse, RunRequest } from './kaseki-api-types';
import { createEventLogger, EventLogger } from './logger';

/**
 * Pre-flight validator performs checks on job requests before submission.
 * Helps catch configuration errors early and provides better diagnostics.
 */
export class PreFlightValidator {
  private logger: EventLogger;
  private gitCheckTimeoutMs = 5000;
  private maxRepoSizeBytes = 5 * 1024 * 1024 * 1024; // 5 GB

  constructor() {
    this.logger = createEventLogger('pre-flight-validator');
  }

  /**
   * Run all pre-flight validation checks.
   */
  async validate(request: RunRequest): Promise<ValidationResponse> {
    const checks: ValidationCheck[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check 1: Git repository reachability
    const reachableCheck = await this.checkGitReachability(request.repoUrl);
    checks.push(reachableCheck);
    if (reachableCheck.status === 'fail') {
      errors.push(reachableCheck.message);
    }

    // Check 2: Git ref exists (only if repo is reachable)
    if (reachableCheck.status !== 'fail') {
      const refCheck = await this.checkGitRef(request.repoUrl, request.ref || 'main');
      checks.push(refCheck);
      if (refCheck.status === 'fail') {
        errors.push(refCheck.message);
      }
    }

    // Check 3: Repository size estimation
    const sizeCheck = await this.checkRepoSize(request.repoUrl, request.ref || 'main');
    checks.push(sizeCheck);
    if (sizeCheck.status === 'fail') {
      errors.push(sizeCheck.message);
    } else if (sizeCheck.status === 'warning') {
      warnings.push(sizeCheck.message);
    }

    // Check 4: Validation commands syntax
    if (request.validationCommands && request.validationCommands.length > 0) {
      const cmdCheck = this.validateCommandsSyntax(request.validationCommands);
      checks.push(cmdCheck);
      if (cmdCheck.status === 'fail') {
        errors.push(cmdCheck.message);
      }
    }

    // Check 5: Changed files allowlist patterns
    if (request.changedFilesAllowlist && request.changedFilesAllowlist.length > 0) {
      const patternCheck = this.validateAllowlistPatterns(request.changedFilesAllowlist);
      checks.push(patternCheck);
      if (patternCheck.status === 'warning') {
        warnings.push(patternCheck.message);
      }
    }

    // Check 6: Max diff bytes sanity
    const diffCheck = this.validateDiffBytes(request.maxDiffBytes);
    checks.push(diffCheck);
    if (diffCheck.status === 'warning') {
      warnings.push(diffCheck.message);
    }

    const isValid = errors.length === 0;

    this.logger.event('pre_flight_validation', {
      repoUrl: request.repoUrl,
      isValid,
      checksRun: checks.length,
      checksFailed: checks.filter((c) => c.status === 'fail').length,
      checksWarning: checks.filter((c) => c.status === 'warning').length,
    });

    return {
      isValid,
      checks,
      warnings,
      errors,
      estimatedDurationSeconds: isValid ? this.estimateDuration(request) : undefined,
    };
  }

  /**
   * Check if git repository is reachable.
   */
  private checkGitReachability(repoUrl: string): Promise<ValidationCheck> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const proc = spawn('git', ['ls-remote', repoUrl], {
        timeout: this.gitCheckTimeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, this.gitCheckTimeoutMs);

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        const duration = Date.now() - startTime;

        if (timedOut) {
          resolve({
            name: 'repo-reachable',
            status: 'fail',
            message: `Git repository is not reachable (timeout after ${this.gitCheckTimeoutMs}ms)`,
            detail: repoUrl,
          });
          return;
        }

        if (code === 0) {
          resolve({
            name: 'repo-reachable',
            status: 'pass',
            message: `Git repository is reachable (${duration}ms)`,
          });
        } else {
          resolve({
            name: 'repo-reachable',
            status: 'fail',
            message: 'Git repository is not reachable or invalid URL',
            detail: repoUrl,
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          name: 'repo-reachable',
          status: 'fail',
          message: `Failed to check git repository: ${err.message}`,
          detail: repoUrl,
        });
      });
    });
  }

  /**
   * Check if git ref (branch/tag/commit) exists.
   */
  private checkGitRef(repoUrl: string, ref: string): Promise<ValidationCheck> {
    return new Promise((resolve) => {
      const proc = spawn('git', ['ls-remote', '--exit-code', repoUrl, ref], {
        timeout: this.gitCheckTimeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, this.gitCheckTimeoutMs);

      proc.on('exit', (code) => {
        clearTimeout(timeout);

        if (timedOut) {
          resolve({
            name: 'ref-exists',
            status: 'fail',
            message: `Git ref check timed out after ${this.gitCheckTimeoutMs}ms`,
            detail: `${repoUrl}#${ref}`,
          });
          return;
        }

        if (code === 0) {
          resolve({
            name: 'ref-exists',
            status: 'pass',
            message: `Git ref '${ref}' exists`,
          });
        } else {
          resolve({
            name: 'ref-exists',
            status: 'fail',
            message: `Git ref '${ref}' does not exist in repository`,
            detail: repoUrl,
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          name: 'ref-exists',
          status: 'fail',
          message: `Failed to check git ref: ${err.message}`,
        });
      });
    });
  }

  /**
   * Check repository size (shallow clone to estimate).
   */
  private checkRepoSize(repoUrl: string, _ref: string): Promise<ValidationCheck> {
    return new Promise((resolve) => {
      // Use git ls-remote to estimate size (not perfect, but quick)
      const proc = spawn('git', ['ls-remote', '--heads', '--tags', repoUrl], {
        timeout: this.gitCheckTimeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, this.gitCheckTimeoutMs);

      let output = '';
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('exit', (code) => {
        clearTimeout(timeout);

        if (timedOut) {
          resolve({
            name: 'repo-size',
            status: 'warning',
            message: 'Could not estimate repository size (check timed out)',
          });
          return;
        }

        if (code === 0) {
          // Rough heuristic: number of refs as proxy for size
          const refCount = output.split('\n').filter((line) => line.trim()).length;

          if (refCount > 1000) {
            resolve({
              name: 'repo-size',
              status: 'warning',
              message: `Repository appears very large (${refCount}+ refs detected); consider using shallow clone`,
            });
          } else {
            resolve({
              name: 'repo-size',
              status: 'pass',
              message: `Repository size is reasonable (${refCount} refs)`,
            });
          }
        } else {
          resolve({
            name: 'repo-size',
            status: 'warning',
            message: 'Could not estimate repository size',
          });
        }
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve({
          name: 'repo-size',
          status: 'warning',
          message: 'Could not estimate repository size',
        });
      });
    });
  }

  /**
   * Validate shell command syntax for validation commands.
   */
  private validateCommandsSyntax(commands: string[]): ValidationCheck {
    const invalid: string[] = [];

    for (const cmd of commands) {
      // Basic sanity checks: empty, only whitespace, dangerous patterns
      if (!cmd || !cmd.trim()) {
        invalid.push('Empty command');
        continue;
      }

      // Warn about dangerous patterns (but allow them)
      if (cmd.includes('rm -rf /') || cmd.includes('dd if=/dev')) {
        invalid.push(`Dangerous command: ${cmd.substring(0, 50)}...`);
      }
    }

    if (invalid.length === 0) {
      return {
        name: 'commands-syntax',
        status: 'pass',
        message: `${commands.length} validation commands syntax is valid`,
      };
    }

    return {
      name: 'commands-syntax',
      status: 'fail',
      message: `Invalid validation commands: ${invalid.join('; ')}`,
    };
  }

  /**
   * Validate allowlist patterns (basic regex check).
   */
  private validateAllowlistPatterns(patterns: string[]): ValidationCheck {
    const warnings: string[] = [];

    for (const pattern of patterns) {
      if (!pattern || !pattern.trim()) {
        warnings.push('Empty pattern');
        continue;
      }

      // Warn about overly broad patterns
      if (pattern === '*' || pattern === '**' || pattern === '/**') {
        warnings.push(`Pattern '${pattern}' is very broad and may allow too many files`);
      }

      // Warn about patterns without wildcards (too specific)
      if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('[')) {
        // It's OK, exact file paths are allowed
      }
    }

    if (warnings.length === 0) {
      return {
        name: 'allowlist-patterns',
        status: 'pass',
        message: `${patterns.length} file patterns are valid`,
      };
    }

    return {
      name: 'allowlist-patterns',
      status: 'warning',
      message: `File allowlist warnings: ${warnings.join('; ')}`,
    };
  }

  /**
   * Validate maxDiffBytes value.
   */
  private validateDiffBytes(maxDiffBytes?: number): ValidationCheck {
    if (maxDiffBytes === undefined) {
      return {
        name: 'max-diff-bytes',
        status: 'pass',
        message: 'Using default max diff bytes (200 KB)',
      };
    }

    if (maxDiffBytes < 10000) {
      return {
        name: 'max-diff-bytes',
        status: 'warning',
        message: `Max diff bytes (${maxDiffBytes}) is very small; task may fail due to minimal changes`,
      };
    }

    if (maxDiffBytes > this.maxRepoSizeBytes) {
      return {
        name: 'max-diff-bytes',
        status: 'warning',
        message: `Max diff bytes (${maxDiffBytes}) exceeds typical repo size; consider reducing`,
      };
    }

    return {
      name: 'max-diff-bytes',
      status: 'pass',
      message: `Max diff bytes (${maxDiffBytes}) is reasonable`,
    };
  }

  /**
   * Estimate job duration based on request characteristics.
   */
  private estimateDuration(request: RunRequest): number {
    let estimateSeconds = 180; // Base: 3 minutes

    // Add for validation commands
    if (request.validationCommands) {
      estimateSeconds += Math.min(request.validationCommands.length * 30, 300);
    }

    // Add for task prompt length (longer tasks may take longer)
    if (request.taskPrompt) {
      estimateSeconds += Math.min(request.taskPrompt.length / 100, 120);
    }

    return Math.min(estimateSeconds, 1200); // Cap at 20 minutes
  }
}
