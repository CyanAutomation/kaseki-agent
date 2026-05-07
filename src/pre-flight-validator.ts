import { spawn } from 'child_process';
import { ValidationCheck, ValidationResponse, RunRequest } from './kaseki-api-types';
import { createEventLogger, EventLogger } from './logger';

/**
 * Convert glob-style pattern to regex.
 * Supports *, **, ?, and [abc] patterns.
 */
export function globToRegex(pattern: string): RegExp {
  // Use placeholders for all special sequences to avoid double-replacement
  let regex = pattern;
  
  // First, escape all regex special chars
  regex = regex.replace(/[.+^${}()|[\]\\-]/g, '\\$&');
  
  // Use placeholders for glob wildcards BEFORE replacing their components
  regex = regex.replace(/\*\*/g, '##DBL_STAR##');
  regex = regex.replace(/\*/g, '##STAR##');
  regex = regex.replace(/\?/g, '##QUEST##');
  
  // Now convert placeholders to regex patterns
  // Handle ** in different contexts
  regex = regex.replace(/\/##DBL_STAR##\//g, '/(?:.*\/)?');  // /../
  regex = regex.replace(/##DBL_STAR##\//g, '(?:.*\/)?');     // **/ at start
  regex = regex.replace(/\/##DBL_STAR##/g, '(?:\/.*)?');     // /** at end
  regex = regex.replace(/##DBL_STAR##/g, '.*');             // ** alone
  
  // Handle single *
  regex = regex.replace(/##STAR##/g, '[^/]*');
  
  // Handle ?
  regex = regex.replace(/##QUEST##/g, '.');
  
  return new RegExp(`^${regex}$`);
}

/**
 * Test if a file path matches any of the allowed patterns.
 */
export function testPathAgainstPatterns(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  for (const pattern of patterns) {
    const regex = globToRegex(pattern);
    if (regex.test(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate allowlist patterns by testing against common file paths.
 */
export function validateAllowlistPatternMatching(
  patterns: string[]
): { isValid: boolean; warnings: string[]; testResults: { pattern: string; matches: number }[] } {
  const warnings: string[] = [];
  const testResults: { pattern: string; matches: number }[] = [];
  const sampleFiles = [
    'package.json', 'src/index.ts', 'src/lib/parser.ts', 'src/lib/parser.tsx',
    'src/utils/helpers.ts', 'tests/parser.test.ts', 'tests/parser.validation.ts',
    'tests/unit/foo.test.ts', 'docs/README.md', 'docs/API.md', '.github/workflows/ci.yml',
    'dist/index.js', 'README.md', 'CHANGELOG.md', '.eslintrc.json', 'tsconfig.json',
  ];

  if (patterns.length === 0) {
    return { isValid: true, warnings: [], testResults: [] };
  }

  for (const pattern of patterns) {
    if (!pattern || !pattern.trim()) {
      warnings.push('Empty pattern detected');
      continue;
    }
    
    // Warn about obviously broad patterns
    if (pattern === '*' || pattern === '**' || pattern === '/**') {
      warnings.push(`Pattern '${pattern}' is very broad and may allow too many files`);
      testResults.push({ pattern, matches: sampleFiles.length });
      continue;
    }
    
    const matchCount = sampleFiles.filter((file) => testPathAgainstPatterns(file, [pattern])).length;
    testResults.push({ pattern, matches: matchCount });
    if (matchCount === sampleFiles.length) {
      warnings.push(`Pattern '${pattern}' is too broad`);
    }
    if (matchCount === 0) {
      warnings.push(`Pattern '${pattern}' doesn't match any sample files`);
    }
  }

  return { isValid: warnings.length === 0, warnings, testResults };
}

/**
 * Pre-flight validator performs checks on job requests before submission.
 * Helps catch configuration errors early and provides better diagnostics.
 */
type PreFlightCacheEntry = {
  expiresAt: number;
  promise?: Promise<ValidationResponse>;
  response?: ValidationResponse;
};

type GitLsRemoteResult = {
  code: number | null;
  durationMs: number;
  output: string;
  timedOut: boolean;
  error?: Error;
};

export class PreFlightValidator {
  private logger: EventLogger;
  private gitCheckTimeoutMs = 5000;
  private maxRepoSizeBytes = 5 * 1024 * 1024 * 1024; // 5 GB
  private cache = new Map<string, PreFlightCacheEntry>();
  private cacheTtlMs: number;
  private cacheMaxEntries: number;

  constructor() {
    this.logger = createEventLogger('pre-flight-validator');
    this.cacheTtlMs = this.parsePositiveIntegerEnv('KASEKI_PREFLIGHT_CACHE_TTL_SECONDS', 30) * 1000;
    this.cacheMaxEntries = this.parsePositiveIntegerEnv('KASEKI_PREFLIGHT_CACHE_MAX_ENTRIES', 100);
  }

  /**
   * Run all pre-flight validation checks.
   */
  async validate(request: RunRequest): Promise<ValidationResponse> {
    if (this.cacheTtlMs <= 0 || this.cacheMaxEntries <= 0) {
      return this.runValidation(request);
    }

    const cacheKey = this.getCacheKey(request);
    const cached = this.getCachedResponse(cacheKey);

    if (cached) {
      return cached;
    }

    const expiresAt = Date.now() + this.cacheTtlMs;
    const promise = this.runValidation(request)
      .then((response) => {
        const cachedResponse = this.cloneValidationResponse(response);
        const current = this.cache.get(cacheKey);

        if (current?.promise === promise) {
          this.cache.set(cacheKey, {
            expiresAt: Date.now() + this.cacheTtlMs,
            response: cachedResponse,
          });
          this.enforceCacheLimit();
        }

        return response;
      })
      .catch((error) => {
        const current = this.cache.get(cacheKey);
        if (current?.promise === promise) {
          this.cache.delete(cacheKey);
        }
        throw error;
      });

    this.cache.set(cacheKey, { expiresAt, promise });
    this.enforceCacheLimit();

    return promise;
  }

  private async runValidation(request: RunRequest): Promise<ValidationResponse> {
    const checks: ValidationCheck[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const ref = request.ref || 'main';
    const gitResult = await this.lsRemoteHeadsAndTags(request.repoUrl);

    // Check 1: Git repository reachability
    const reachableCheck = this.checkGitReachability(request.repoUrl, gitResult);
    checks.push(reachableCheck);
    if (reachableCheck.status === 'fail') {
      errors.push(reachableCheck.message);
    }

    // Check 2: Git ref exists (only if repo is reachable)
    if (reachableCheck.status !== 'fail') {
      const refCheck = this.checkGitRef(request.repoUrl, ref, gitResult);
      checks.push(refCheck);
      if (refCheck.status === 'fail') {
        errors.push(refCheck.message);
      }
    }

    // Check 3: Repository size estimation
    const sizeCheck = this.checkRepoSize(gitResult);
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

  private getCacheKey(request: RunRequest): string {
    return JSON.stringify([request.repoUrl, request.ref || 'main']);
  }

  private getCachedResponse(cacheKey: string): Promise<ValidationResponse> | ValidationResponse | undefined {
    const entry = this.cache.get(cacheKey);
    const now = Date.now();

    if (!entry) {
      this.pruneExpiredCacheEntries(now);
      return undefined;
    }

    if (entry.expiresAt <= now) {
      this.cache.delete(cacheKey);
      this.pruneExpiredCacheEntries(now);
      return undefined;
    }

    if (entry.response) {
      // Refresh insertion order so frequently used entries are less likely to be evicted.
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, entry);
      return this.cloneValidationResponse(entry.response);
    }

    return entry.promise?.then((response) => this.cloneValidationResponse(response));
  }

  private pruneExpiredCacheEntries(now = Date.now()): void {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  private enforceCacheLimit(): void {
    this.pruneExpiredCacheEntries();

    while (this.cache.size > this.cacheMaxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.cache.delete(oldestKey);
    }
  }

  private cloneValidationResponse(response: ValidationResponse): ValidationResponse {
    return {
      ...response,
      checks: response.checks.map((check) => ({ ...check })),
      warnings: [...response.warnings],
      errors: [...response.errors],
    };
  }

  private parsePositiveIntegerEnv(name: string, defaultValue: number): number {
    const value = process.env[name];

    if (value === undefined || value.trim() === '') {
      return defaultValue;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return defaultValue;
    }

    return parsed;
  }

  private lsRemoteHeadsAndTags(repoUrl: string): Promise<GitLsRemoteResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const proc = spawn('git', ['ls-remote', '--heads', '--tags', repoUrl], {
        timeout: this.gitCheckTimeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, this.gitCheckTimeoutMs);

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        resolve({
          code,
          durationMs: Date.now() - startTime,
          output,
          timedOut,
        });
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        resolve({
          code: null,
          durationMs: Date.now() - startTime,
          output,
          timedOut,
          error,
        });
      });
    });
  }

  /**
   * Check if git repository is reachable.
   */
  private checkGitReachability(repoUrl: string, result: GitLsRemoteResult): ValidationCheck {
    if (result.timedOut) {
      return {
        name: 'repo-reachable',
        status: 'fail',
        message: `Git repository is not reachable (timeout after ${this.gitCheckTimeoutMs}ms)`,
        detail: repoUrl,
      };
    }

    if (result.error) {
      return {
        name: 'repo-reachable',
        status: 'fail',
        message: `Failed to check git repository: ${result.error.message}`,
        detail: repoUrl,
      };
    }

    if (result.code === 0) {
      return {
        name: 'repo-reachable',
        status: 'pass',
        message: `Git repository is reachable (${result.durationMs}ms)`,
      };
    }

    return {
      name: 'repo-reachable',
      status: 'fail',
      message: 'Git repository is not reachable or invalid URL',
      detail: repoUrl,
    };
  }

  /**
   * Check if git ref (branch/tag/commit) exists.
   */
  private checkGitRef(repoUrl: string, ref: string, result: GitLsRemoteResult): ValidationCheck {
    if (result.timedOut) {
      return {
        name: 'ref-exists',
        status: 'fail',
        message: `Git ref check timed out after ${this.gitCheckTimeoutMs}ms`,
        detail: `${repoUrl}#${ref}`,
      };
    }

    if (result.error) {
      return {
        name: 'ref-exists',
        status: 'fail',
        message: `Failed to check git ref: ${result.error.message}`,
      };
    }

    if (result.code === 0 && this.lsRemoteOutputContainsRef(result.output, ref)) {
      return {
        name: 'ref-exists',
        status: 'pass',
        message: `Git ref '${ref}' exists`,
      };
    }

    return {
      name: 'ref-exists',
      status: 'fail',
      message: `Git ref '${ref}' does not exist in repository`,
      detail: repoUrl,
    };
  }

  private lsRemoteOutputContainsRef(output: string, ref: string): boolean {
    const normalizedRef = ref.replace(/^refs\//, '');
    const candidateRefs = new Set([
      ref,
      `refs/${normalizedRef}`,
      `refs/heads/${normalizedRef.replace(/^heads\//, '')}`,
      `refs/tags/${normalizedRef.replace(/^tags\//, '')}`,
    ]);

    return output
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[1])
      .filter((remoteRef): remoteRef is string => Boolean(remoteRef))
      .some((remoteRef) => candidateRefs.has(remoteRef));
  }

  /**
   * Check repository size (uses ref count as a rough estimate).
   */
  private checkRepoSize(result: GitLsRemoteResult): ValidationCheck {
    if (result.timedOut) {
      return {
        name: 'repo-size',
        status: 'warning',
        message: 'Could not estimate repository size (check timed out)',
      };
    }

    if (result.code === 0) {
      // Rough heuristic: number of refs as proxy for size
      const refCount = result.output.split('\n').filter((line) => line.trim()).length;

      if (refCount > 1000) {
        return {
          name: 'repo-size',
          status: 'warning',
          message: `Repository appears very large (${refCount}+ refs detected); consider using shallow clone`,
        };
      }

      return {
        name: 'repo-size',
        status: 'pass',
        message: `Repository size is reasonable (${refCount} refs)`,
      };
    }

    return {
      name: 'repo-size',
      status: 'warning',
      message: 'Could not estimate repository size',
    };
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
