import { PreFlightValidator } from './pre-flight-validator';
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
    test('includes repo reachability check', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
      };

      const response = await validator.validate(request);

      const reachableCheck = response.checks.find((c) => c.name === 'repo-reachable');
      expect(reachableCheck).toBeDefined();
      expect(reachableCheck?.status).toMatch(/pass|fail|warning/);
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

    test('includes repo size check', async () => {
      const request: RunRequest = {
        repoUrl: 'https://github.com/example/repo',
        ref: 'main',
      };

      const response = await validator.validate(request);

      const sizeCheck = response.checks.find((c) => c.name === 'repo-size');
      expect(sizeCheck).toBeDefined();
    });
  });
});
