import { PreFlightValidator, globToRegex, testPathAgainstPatterns, validateAllowlistPatternMatching } from './pre-flight-validator';
import type { RunRequest } from './kaseki-api-types';

describe('PreFlightValidator validation logic', () => {
  let validator: PreFlightValidator;

  beforeEach(() => {
    delete process.env.KASEKI_PREFLIGHT_CACHE_TTL_SECONDS;
    delete process.env.KASEKI_PREFLIGHT_CACHE_MAX_ENTRIES;
    validator = new PreFlightValidator();
  });

  describe('validateCommandsSyntax', () => {
    test('rejects empty validation commands', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        validationCommands: ['', 'npm test'],
      };

      const response = await validator.validate(request);
      const cmdCheck = response.checks.find((c) => c.name === 'commands-syntax');
      expect(cmdCheck?.status).toBe('fail');
      expect(cmdCheck?.message).toContain('Invalid validation commands');
    });

    test('warns about dangerous validation commands', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        validationCommands: ['rm -rf / --no-preserve-root'],
      };

      const response = await validator.validate(request);
      const cmdCheck = response.checks.find((c) => c.name === 'commands-syntax');
      expect(cmdCheck?.status).toBe('fail');
      expect(cmdCheck?.message).toContain('Dangerous command');
    });

    test('accepts legitimate commands', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        validationCommands: ['npm test', 'npm run build'],
      };

      const response = await validator.validate(request);
      const cmdCheck = response.checks.find((c) => c.name === 'commands-syntax');
      expect(cmdCheck?.status).toBe('pass');
    });
  });

  describe('validateAllowlistPatterns', () => {
    test('accepts valid file patterns', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        changedFilesAllowlist: ['src/**/*.ts', 'tests/**/*.test.ts', 'package.json'],
      };

      const response = await validator.validate(request);
      const patternCheck = response.checks.find((c) => c.name === 'allowlist-patterns');
      expect(patternCheck?.status).toBe('pass');
    });

    test('warns about overly broad patterns', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        changedFilesAllowlist: ['*'],
      };

      const response = await validator.validate(request);
      const patternCheck = response.checks.find((c) => c.name === 'allowlist-patterns');
      expect(patternCheck?.status).toBe('warning');
      expect(patternCheck?.message).toContain('very broad');
    });

    test('allows exact file paths in allowlist', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        changedFilesAllowlist: ['src/index.ts', 'src/utils.ts', 'README.md'],
      };

      const response = await validator.validate(request);
      const patternCheck = response.checks.find((c) => c.name === 'allowlist-patterns');
      expect(patternCheck?.status).toBe('pass');
    });
  });

  describe('validateDiffBytes', () => {
    test('passes reasonable max diff bytes values', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        maxDiffBytes: 200000, // 200 KB
      };

      const response = await validator.validate(request);
      const diffCheck = response.checks.find((c) => c.name === 'max-diff-bytes');
      expect(diffCheck?.status).toBe('pass');
    });

    test('warns about very small max diff bytes', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        maxDiffBytes: 1000, // 1 KB - too small
      };

      const response = await validator.validate(request);
      const diffCheck = response.checks.find((c) => c.name === 'max-diff-bytes');
      expect(diffCheck?.status).toBe('warning');
      expect(diffCheck?.message).toContain('very small');
    });

    test('uses default when max diff bytes not specified', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
      };

      const response = await validator.validate(request);
      const diffCheck = response.checks.find((c) => c.name === 'max-diff-bytes');
      expect(diffCheck?.status).toBe('pass');
      expect(diffCheck?.message).toContain('default');
    });
  });

  describe('full validation response structure', () => {
    test('returns valid response for basic request', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        validationCommands: ['npm test'],
        maxDiffBytes: 200000,
      };

      const response = await validator.validate(request);

      expect(response).toHaveProperty('isValid');
      expect(response).toHaveProperty('checks');
      expect(response).toHaveProperty('warnings');
      expect(response).toHaveProperty('errors');
      expect(Array.isArray(response.checks)).toBe(true);
      expect(response.checks.length).toBeGreaterThan(0);

      // All checks should have required fields
      for (const check of response.checks) {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('status');
        expect(check).toHaveProperty('message');
      }
    });

    test('collects multiple validation checks', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        validationCommands: ['npm test', 'npm build'],
        changedFilesAllowlist: ['src/**'],
      };

      const response = await validator.validate(request);

      // Should include at least: repo-reachable, repo-size, commands-syntax, allowlist-patterns, max-diff-bytes
      expect(response.checks.length).toBeGreaterThanOrEqual(5);
    });

    test('marks validation invalid when there are errors', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
        validationCommands: ['', 'rm -rf /'],
      };

      const response = await validator.validate(request);

      if (response.errors.length > 0) {
        expect(response.isValid).toBe(false);
      }
    });
  });

  describe('preflight result cache', () => {
    const baseTime = new Date('2026-05-06T00:00:00.000Z');
    const successfulGitResult = {
      code: 0,
      durationMs: 12,
      output: 'abc123\trefs/heads/main\ndef456\trefs/heads/dev\n',
      timedOut: false,
    };

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(baseTime);
      process.env.KASEKI_PREFLIGHT_CACHE_TTL_SECONDS = '60';
      process.env.KASEKI_PREFLIGHT_CACHE_MAX_ENTRIES = '10';
      validator = new PreFlightValidator();
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    test('returns a cached response for repeated repoUrl/ref validations', async () => {
      const gitSpy = jest
        .spyOn(validator as any, 'lsRemoteHeadsAndTags')
        .mockResolvedValue(successfulGitResult);
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/cache-hit',
        ref: 'main',
        maxDiffBytes: 200000,
      };

      const first = await validator.validate(request);
      const second = await validator.validate(request);

      expect(gitSpy).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
      expect(second.checks.find((c) => c.name === 'ref-exists')?.status).toBe('pass');
    });

    test('refreshes validation after cache expiry', async () => {
      process.env.KASEKI_PREFLIGHT_CACHE_TTL_SECONDS = '1';
      validator = new PreFlightValidator();
      const gitSpy = jest
        .spyOn(validator as any, 'lsRemoteHeadsAndTags')
        .mockResolvedValue(successfulGitResult);
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/cache-expiry',
        ref: 'main',
      };

      await validator.validate(request);
      jest.setSystemTime(new Date(baseTime.getTime() + 1001));
      await validator.validate(request);

      expect(gitSpy).toHaveBeenCalledTimes(2);
    });

    test('coalesces concurrent validations for the same cache key', async () => {
      let resolveGitResult: (result: typeof successfulGitResult) => void = () => undefined;
      const gitResultPromise = new Promise<typeof successfulGitResult>((resolve) => {
        resolveGitResult = resolve;
      });
      const gitSpy = jest
        .spyOn(validator as any, 'lsRemoteHeadsAndTags')
        .mockReturnValue(gitResultPromise);
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/coalesce',
        ref: 'main',
      };

      const firstPromise = validator.validate(request);
      const secondPromise = validator.validate(request);

      expect(gitSpy).toHaveBeenCalledTimes(1);
      resolveGitResult(successfulGitResult);
      const [first, second] = await Promise.all([firstPromise, secondPromise]);

      expect(first).toEqual(second);
      expect(gitSpy).toHaveBeenCalledTimes(1);
    });

    test('uses distinct cache keys for distinct refs', async () => {
      const gitSpy = jest
        .spyOn(validator as any, 'lsRemoteHeadsAndTags')
        .mockResolvedValue(successfulGitResult);
      const repoUrl = 'https://github.com/example/distinct-refs';

      await validator.validate({ repoUrl, ref: 'main' });
      await validator.validate({ repoUrl, ref: 'dev' });
      await validator.validate({ repoUrl, ref: 'main' });

      expect(gitSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('git validation (git operations)', () => {
    test('marks repository reachable when git ls-remote succeeds', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
      };
      jest.spyOn(validator as any, 'lsRemoteHeadsAndTags').mockResolvedValue({
        code: 0,
        durationMs: 23,
        output: 'abc123\trefs/heads/main\n',
        timedOut: false,
      });

      const response = await validator.validate(request);

      const reachableCheck = response.checks.find((c) => c.name === 'repo-reachable');
      expect(reachableCheck).toEqual({
        name: 'repo-reachable',
        status: 'pass',
        message: 'Git repository is reachable (23ms)',
      });
      expect(response.isValid).toBe(true);
      expect(response.errors).not.toContain('Git repository is reachable (23ms)');
    });

    test('marks repository unreachable when git ls-remote fails', async () => {
      const repoUrl = 'https://github.com/example/missing-repo';
      const request: RunRequest = {
        repoUrl,
        ref: 'main',
      };
      jest.spyOn(validator as any, 'lsRemoteHeadsAndTags').mockResolvedValue({
        code: 128,
        durationMs: 31,
        output: '',
        timedOut: false,
      });

      const response = await validator.validate(request);

      const reachableCheck = response.checks.find((c) => c.name === 'repo-reachable');
      expect(reachableCheck).toEqual({
        name: 'repo-reachable',
        status: 'fail',
        message: 'Git repository is not reachable or invalid URL',
        detail: repoUrl,
      });
      expect(response.isValid).toBe(false);
      expect(response.errors).toContain('Git repository is not reachable or invalid URL');
      expect(response.checks.find((c) => c.name === 'ref-exists')).toBeUndefined();
    });

    test('includes ref existence check if repo is reachable', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'feature/my-branch',
      };
      jest.spyOn(validator as any, 'lsRemoteHeadsAndTags').mockResolvedValue({
        code: 0,
        durationMs: 15,
        output: 'abc123\trefs/heads/feature/my-branch\n',
        timedOut: false,
      });

      const response = await validator.validate(request);

      const reachableCheck = response.checks.find((c) => c.name === 'repo-reachable');
      expect(reachableCheck?.status).toBe('pass');
      const refCheck = response.checks.find((c) => c.name === 'ref-exists');
      expect(refCheck).toEqual({
        name: 'ref-exists',
        status: 'pass',
        message: "Git ref 'feature/my-branch' exists",
      });
    });

    test('passes repo-size check for acceptable repository size', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
      };
      jest.spyOn(validator as any, 'lsRemoteHeadsAndTags').mockResolvedValue({
        code: 0,
        durationMs: 17,
        output: [
          'abc123\trefs/heads/main',
          'def456\trefs/heads/dev',
          'fedcba\trefs/tags/v1.0.0',
        ].join('\n'),
        timedOut: false,
      });

      const response = await validator.validate(request);

      const sizeCheck = response.checks.find((c) => c.name === 'repo-size');
      expect(sizeCheck).toEqual({
        name: 'repo-size',
        status: 'pass',
        message: 'Repository size is reasonable (3 refs)',
      });
      expect(sizeCheck?.detail).toBeUndefined();
      expect(response.isValid).toBe(true);
      expect(response.warnings).not.toContain(sizeCheck?.message);
      expect(response.errors).not.toContain(sizeCheck?.message);
    });

    test('warns for oversized repository without invalidating response', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/large-repo',
        ref: 'main',
      };
      const oversizedRefs = [
        'abc123\trefs/heads/main',
        ...Array.from({ length: 1001 }, (_, index) => `def${index}\trefs/tags/v${index}`),
      ].join('\n');
      jest.spyOn(validator as any, 'lsRemoteHeadsAndTags').mockResolvedValue({
        code: 0,
        durationMs: 42,
        output: oversizedRefs,
        timedOut: false,
      });

      const response = await validator.validate(request);

      const sizeCheck = response.checks.find((c) => c.name === 'repo-size');
      expect(sizeCheck).toEqual({
        name: 'repo-size',
        status: 'warning',
        message: 'Repository appears very large (1002+ refs detected); consider using shallow clone',
      });
      expect(sizeCheck?.detail).toBeUndefined();
      expect(response.isValid).toBe(true);
      expect(response.warnings).toContain(sizeCheck?.message);
      expect(response.errors).not.toContain(sizeCheck?.message);
    });
  });

  describe('pattern matching functions', () => {
    describe('globToRegex', () => {
      test('converts simple glob patterns to regex', () => {
        const regex = globToRegex('src/*.ts');
        expect(regex.test('src/index.ts')).toBe(true);
        expect(regex.test('src/foo.ts')).toBe(true);
        expect(regex.test('src/subdir/index.ts')).toBe(false);
        expect(regex.test('src/index.tsx')).toBe(false);
      });

      test('handles ** for multi-level matching', () => {
        const regex = globToRegex('src/**/*.ts');
        expect(regex.test('src/index.ts')).toBe(true);
        expect(regex.test('src/lib/parser.ts')).toBe(true);
        expect(regex.test('src/lib/sub/deep/file.ts')).toBe(true);
        expect(regex.test('src/file.tsx')).toBe(false);
      });

      test('matches exact file paths', () => {
        const regex = globToRegex('package.json');
        expect(regex.test('package.json')).toBe(true);
        expect(regex.test('src/package.json')).toBe(false);
      });

      test('handles ? single-character wildcard', () => {
        const regex = globToRegex('src/index.t?s');
        expect(regex.test('src/index.tas')).toBe(true);
        expect(regex.test('src/index.tbs')).toBe(true);
        expect(regex.test('src/index.tXs')).toBe(true);
        expect(regex.test('src/index.ts')).toBe(false); // ? requires one character
        expect(regex.test('src/index.tjss')).toBe(false);
      });
    });

    describe('testPathAgainstPatterns', () => {
      test('returns true if path matches any pattern', () => {
        const patterns = ['src/**/*.ts', 'tests/**/*.ts'];
        expect(testPathAgainstPatterns('src/index.ts', patterns)).toBe(true);
        expect(testPathAgainstPatterns('tests/unit/foo.test.ts', patterns)).toBe(true);
        expect(testPathAgainstPatterns('docs/README.md', patterns)).toBe(false);
      });

      test('returns true for empty pattern list', () => {
        expect(testPathAgainstPatterns('any/file.ts', [])).toBe(true);
      });

      test('handles multiple patterns correctly', () => {
        const patterns = ['src/lib/parser.ts', 'tests/parser.validation.ts'];
        expect(testPathAgainstPatterns('src/lib/parser.ts', patterns)).toBe(true);
        expect(testPathAgainstPatterns('tests/parser.validation.ts', patterns)).toBe(true);
        expect(testPathAgainstPatterns('src/index.ts', patterns)).toBe(false);
      });
    });

    describe('validateAllowlistPatternMatching', () => {
      test('returns valid for reasonable patterns', () => {
        const result = validateAllowlistPatternMatching(['src/lib/parser.ts', 'tests/parser.validation.ts']);
        expect(result.isValid).toBe(true);
        expect(result.warnings.length).toBe(0);
      });

      test('warns about empty patterns', () => {
        const result = validateAllowlistPatternMatching(['', 'src/**/*.ts']);
        expect(result.warnings).toContain('Empty pattern detected');
      });

      test('warns about overly broad patterns', () => {
        const result = validateAllowlistPatternMatching(['*']);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings.some((w) => w.includes('very broad'))).toBe(true);
      });

      test('warns about patterns matching no sample files', () => {
        const result = validateAllowlistPatternMatching(['xyz/**/*.nonexistent']);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings.some((w) => w.includes("doesn't match any sample files"))).toBe(true);
      });

      test('returns test results for each pattern', () => {
        const result = validateAllowlistPatternMatching(['src/**/*.ts', 'tests/**/*.ts']);
        expect(result.testResults.length).toBe(2);
        expect(result.testResults[0].pattern).toBe('src/**/*.ts');
        expect(result.testResults[0].matches).toBeGreaterThan(0);
      });

      test('returns empty result for empty pattern list', () => {
        const result = validateAllowlistPatternMatching([]);
        expect(result.isValid).toBe(true);
        expect(result.warnings.length).toBe(0);
        expect(result.testResults.length).toBe(0);
      });
    });
  });
});
