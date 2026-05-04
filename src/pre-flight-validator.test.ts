import { PreFlightValidator } from './pre-flight-validator';
import type { RunRequest } from './kaseki-api-types';

describe('PreFlightValidator validation logic', () => {
  const validator = new PreFlightValidator();

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

      const response = await validator.validate(request);

      // If repo is reachable, ref check should be included; otherwise it may be skipped
      const reachableCheck = response.checks.find((c) => c.name === 'repo-reachable');
      if (reachableCheck?.status === 'pass') {
        const refCheck = response.checks.find((c) => c.name === 'ref-exists');
        expect(refCheck).toBeDefined();
      }
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
