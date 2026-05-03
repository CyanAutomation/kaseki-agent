import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  deriveInstanceLifecycleStatus,
  resolveInstanceExitCode,
  resolveInstanceStage,
  classifyFailure,
} from './instance-state-derivation';

describe('instance-state-derivation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('deriveInstanceLifecycleStatus', () => {
    it('should return running when isRunning is true', () => {
      const status = deriveInstanceLifecycleStatus(true, 0);
      expect(status).toBe('running');
    });

    it('should return completed when isRunning is false and exitCode is 0', () => {
      const status = deriveInstanceLifecycleStatus(false, 0);
      expect(status).toBe('completed');
    });

    it('should return failed when isRunning is false and exitCode is non-zero', () => {
      const status = deriveInstanceLifecycleStatus(false, 1);
      expect(status).toBe('failed');
    });

    it('should return pending when isRunning is false and exitCode is null', () => {
      const status = deriveInstanceLifecycleStatus(false, null);
      expect(status).toBe('pending');
    });
  });

  describe('resolveInstanceExitCode', () => {
    it('should read exit code from metadata', () => {
      const metadata = { exit_code: 42 };
      const exitCode = resolveInstanceExitCode(tempDir, metadata);
      expect(exitCode).toBe(42);
    });

    it('should parse string exit code from metadata', () => {
      const metadata = { exit_code: '99' };
      const exitCode = resolveInstanceExitCode(tempDir, metadata);
      expect(exitCode).toBe(99);
    });

    it('should prefer /exit_code file over metadata', () => {
      const metadata = { exit_code: 1 };
      fs.writeFileSync(path.join(tempDir, 'exit_code'), '42');

      const exitCode = resolveInstanceExitCode(tempDir, metadata);
      expect(exitCode).toBe(42);
    });

    it('should fall back to metadata if /exit_code file is invalid', () => {
      const metadata = { exit_code: 1 };
      fs.writeFileSync(path.join(tempDir, 'exit_code'), 'invalid');

      const exitCode = resolveInstanceExitCode(tempDir, metadata);
      expect(exitCode).toBe(1);
    });

    it('should return null when no exit code is available', () => {
      const exitCode = resolveInstanceExitCode(tempDir, {});
      expect(exitCode).toBeNull();
    });

    it('should handle negative exit codes', () => {
      const metadata = { exit_code: -1 };
      const exitCode = resolveInstanceExitCode(tempDir, metadata);
      expect(exitCode).toBe(-1);
    });
  });

  describe('resolveInstanceStage', () => {
    it('should return current_stage from metadata when available', () => {
      const metadata = { current_stage: 'validation' };
      const instanceDir = path.join(tempDir, 'kaseki-1');
      fs.mkdirSync(instanceDir, { recursive: true });

      const stage = resolveInstanceStage(tempDir, 'kaseki-1', metadata);
      expect(stage).toBe('validation');
    });

    it('should parse stage from stdout.log when metadata is missing', () => {
      const instanceDir = path.join(tempDir, 'kaseki-1');
      fs.mkdirSync(instanceDir, { recursive: true });
      fs.writeFileSync(
        path.join(instanceDir, 'stdout.log'),
        '==> Clone repo\n==> Install dependencies\n==> pi coding agent'
      );

      const stage = resolveInstanceStage(tempDir, 'kaseki-1', {});
      expect(stage).toBe('pi coding agent');
    });

    it('should return fallback when no stage information is available', () => {
      const instanceDir = path.join(tempDir, 'kaseki-1');
      fs.mkdirSync(instanceDir, { recursive: true });

      const stage = resolveInstanceStage(tempDir, 'kaseki-1', {}, 'default');
      expect(stage).toBe('default');
    });

    it('should ignore empty current_stage in metadata', () => {
      const metadata = { current_stage: '   ' };
      const instanceDir = path.join(tempDir, 'kaseki-1');
      fs.mkdirSync(instanceDir, { recursive: true });
      fs.writeFileSync(
        path.join(instanceDir, 'stdout.log'),
        '==> Stage from stdout'
      );

      const stage = resolveInstanceStage(tempDir, 'kaseki-1', metadata);
      expect(stage).toBe('Stage from stdout');
    });
  });

  describe('classifyFailure', () => {
    it('should classify zero exit code as none', () => {
      const classification = classifyFailure({}, 0);
      expect(classification).toBe('none');
    });

    it('should classify exit code 124 as timeout', () => {
      const classification = classifyFailure({}, 124);
      expect(classification).toBe('timeout');
    });

    it('should classify empty diff failures', () => {
      const classification1 = classifyFailure({ failed_command: 'empty git diff' }, 3);
      const classification2 = classifyFailure({}, 3);
      expect(classification1).toBe('empty-diff');
      expect(classification2).toBe('empty-diff');
    });

    it('should classify validation failures', () => {
      const classification = classifyFailure({ failed_command: 'validation' }, 1);
      expect(classification).toBe('validation');
    });

    it('should classify quality gate failures', () => {
      const classification = classifyFailure({ failed_command: 'quality checks' }, 5);
      expect(classification).toBe('quality');
    });

    it('should classify secret scan failures', () => {
      const classification = classifyFailure({ failed_command: 'secret scan' }, 6);
      expect(classification).toBe('secret-scan');
    });

    it('should classify github-related failures', () => {
      const classification = classifyFailure({ failed_command: 'github-api-error' }, 1);
      expect(classification).toBe('github');
    });

    it('should classify credential-related failures', () => {
      const c1 = classifyFailure({ failed_command: 'OPENROUTER_API_KEY missing' }, 1);
      const c2 = classifyFailure({ failed_command: 'OpenRouter error' }, 1);
      expect(c1).toBe('credentials');
      expect(c2).toBe('credentials');
    });

    it('should return unknown for unclassified failures', () => {
      const classification = classifyFailure({}, 42);
      expect(classification).toBe('nonzero-exit');
    });

    it('should sanitize failed_command by replacing spaces with dashes', () => {
      const classification = classifyFailure(
        { failed_command: 'npm test run' },
        1
      );
      expect(classification).toBe('npm-test-run');
    });

    it('should handle string exit codes', () => {
      const classification = classifyFailure({}, '124');
      expect(classification).toBe('timeout');
    });
  });
});
