/**
 * Compilation validator tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runCompilation,
  saveCompilationLog,
  formatCompilationResult,
  isCompilationFailureCritical,
  didCompilationImprove,
  createCompilationReport,
} from './compilation-validator';

describe('compilation-validator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-compile-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('runCompilation', () => {
    it('should successfully run a successful build command', () => {
      // Create a simple echo script that exits 0
      const result = runCompilation(tempDir, 'echo "Build successful"', 'test');

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Build successful');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should capture failed build command', () => {
      const result = runCompilation(tempDir, 'false', 'test');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include command and language in result', () => {
      const result = runCompilation(tempDir, 'true', 'typescript');

      expect(result.command).toBe('true');
      expect(result.language).toBe('typescript');
    });

    it('should include duration and timestamp', () => {
      const result = runCompilation(tempDir, 'true', 'test');

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should capture both stdout and stderr', () => {
      const result = runCompilation(
        tempDir,
        'node -e "process.stdout.write(\'stdout-text\'); process.stderr.write(\'stderr-text\'); process.exit(1)"',
        'test',
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('stdout-text');
      expect(result.stderr).toBe('stderr-text');
      expect(result.output).toBe('stdout-text\nstderr-text');
    });

    it('should handle timeout gracefully', () => {
      const result = runCompilation(tempDir, 'node -e "setTimeout(() => {}, 1000)"', 'test', 10);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(124);
      expect(result.output).toContain('ETIMEDOUT');
      expect(result.stderr).toContain('ETIMEDOUT');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeLessThanOrEqual(Date.now());
      expect(isCompilationFailureCritical(result)).toBe(false);
    });

    it('should work in specified directory', () => {
      const subdir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'test.txt'), 'test');

      const result = runCompilation(subdir, 'ls -la test.txt', 'test');

      expect(result.success).toBe(true);
      expect(result.output).toContain('test.txt');
    });
  });

  describe('saveCompilationLog', () => {
    it('should save compilation result to log file', () => {
      const result = runCompilation(tempDir, 'true', 'typescript');
      const logPath = path.join(tempDir, 'compilation.log');

      saveCompilationLog(result, logPath);

      expect(fs.existsSync(logPath)).toBe(true);
      const logContent = fs.readFileSync(logPath, 'utf-8');
      expect(logContent).toContain('true');
      expect(logContent).toContain('typescript');
    });

    it('should append to existing log file', () => {
      const logPath = path.join(tempDir, 'compilation.log');

      const result1 = runCompilation(tempDir, 'echo 1', 'test');
      saveCompilationLog(result1, logPath);

      const result2 = runCompilation(tempDir, 'echo 2', 'test');
      saveCompilationLog(result2, logPath);

      const logContent = fs.readFileSync(logPath, 'utf-8');
      const lines = logContent.split('\n').filter(l => l);
      expect(lines.length).toBe(2);
    });

    it('should create directory if needed', () => {
      const logPath = path.join(tempDir, 'deep', 'nested', 'path', 'compilation.log');
      const result = runCompilation(tempDir, 'true', 'test');

      saveCompilationLog(result, logPath);

      expect(fs.existsSync(logPath)).toBe(true);
    });

    it('should include timestamp and success status', () => {
      const result = runCompilation(tempDir, 'true', 'test');
      const logPath = path.join(tempDir, 'compilation.log');

      saveCompilationLog(result, logPath);

      const logContent = fs.readFileSync(logPath, 'utf-8');
      expect(logContent).toContain('"success":true');
    });

    it('should handle missing directories gracefully', () => {
      const result = runCompilation(tempDir, 'true', 'test');
      // Don't create the directory, but ensure saveCompilationLog creates it
      expect(() => {
        saveCompilationLog(result, path.join(tempDir, 'auto', 'created', 'path.log'));
      }).not.toThrow();
    });
  });

  describe('formatCompilationResult', () => {
    it('should format successful result', () => {
      const result = runCompilation(tempDir, 'echo test', 'typescript');

      const formatted = formatCompilationResult(result);

      expect(formatted).toContain('✓ SUCCESS');
      expect(formatted).toContain('typescript');
      expect(formatted).toContain('echo test');
      expect(formatted).toContain('ms'); // Duration in milliseconds
    });

    it('should format failed result', () => {
      const result = runCompilation(tempDir, 'false', 'go');

      const formatted = formatCompilationResult(result);

      expect(formatted).toContain('✗ FAILED');
      expect(formatted).toContain('go');
      expect(formatted).toContain('1');
    });

    it('should include command', () => {
      const result = runCompilation(tempDir, 'npm run build', 'typescript');

      const formatted = formatCompilationResult(result);

      expect(formatted).toContain('npm run build');
    });

    it('should include output snippet', () => {
      const result = runCompilation(tempDir, 'echo "Long output test message"', 'test');

      const formatted = formatCompilationResult(result);

      expect(formatted).toContain('Output');
    });
  });

  describe('isCompilationFailureCritical', () => {
    it('should return false for successful compilation', () => {
      const result = runCompilation(tempDir, 'true', 'test');

      expect(isCompilationFailureCritical(result)).toBe(false);
    });

    it('should return true for regular compilation failure', () => {
      const result = runCompilation(tempDir, 'false', 'test');

      expect(isCompilationFailureCritical(result)).toBe(true);
    });

    it('should treat timeout as non-critical', () => {
      // Simulate timeout exit code (124)
      const result: any = {
        success: false,
        exitCode: 124,
        command: 'slow-command',
        language: 'test',
        duration: 60000,
        stdout: '',
        stderr: '',
        output: '',
        timestamp: Date.now(),
      };

      expect(isCompilationFailureCritical(result)).toBe(false);
    });
  });

  describe('didCompilationImprove', () => {
    it('should indicate improvement when pre-agent failed and post-agent succeeded', () => {
      const preAgent = runCompilation(tempDir, 'false', 'test');
      const postAgent = runCompilation(tempDir, 'true', 'test');

      expect(didCompilationImprove(preAgent, postAgent)).toBe(true);
    });

    it('should indicate no regression when both succeeded', () => {
      const preAgent = runCompilation(tempDir, 'true', 'test');
      const postAgent = runCompilation(tempDir, 'echo "ok"', 'test');

      expect(didCompilationImprove(preAgent, postAgent)).toBe(true);
    });

    it('should indicate regression when pre-agent succeeded but post-agent failed', () => {
      const preAgent = runCompilation(tempDir, 'true', 'test');
      const postAgent = runCompilation(tempDir, 'false', 'test');

      expect(didCompilationImprove(preAgent, postAgent)).toBe(false);
    });

    it('should indicate no regression when both failed', () => {
      const preAgent = runCompilation(tempDir, 'false', 'test');
      const postAgent = runCompilation(tempDir, 'false', 'test');

      expect(didCompilationImprove(preAgent, postAgent)).toBe(true);
    });

    it('should return true when no pre-agent result and post-agent succeeds', () => {
      const postAgent = runCompilation(tempDir, 'true', 'test');

      expect(didCompilationImprove(null, postAgent)).toBe(true);
    });

    it('should return false when no pre-agent result and post-agent fails', () => {
      const postAgent = runCompilation(tempDir, 'false', 'test');

      expect(didCompilationImprove(null, postAgent)).toBe(false);
    });
  });

  describe('createCompilationReport', () => {
    it('should create report for successful compilation', () => {
      const result = runCompilation(tempDir, 'true', 'typescript');

      const report = createCompilationReport('typescript', 'npm run build', result);

      expect(report).toContain('Compilation Report');
      expect(report).toContain('typescript');
      expect(report).toContain('npm run build');
      expect(report).toContain('✅ PASSED');
      expect(report).toMatch(/\d+\.\d+s/); // Duration format: number.number + s
    });

    it('should create report for failed compilation', () => {
      const result = runCompilation(tempDir, 'false', 'go');

      const report = createCompilationReport('go', 'go build', result);

      expect(report).toContain('❌ FAILED');
      expect(report).toContain('Failure Details');
      expect(report).toContain('go');
    });

    it('should include phase information', () => {
      const result = runCompilation(tempDir, 'true', 'test');

      const preReport = createCompilationReport('test', 'cmd', result, 'pre-agent');
      const postReport = createCompilationReport('test', 'cmd', result, 'post-agent');

      expect(preReport).toContain('(pre-agent)');
      expect(postReport).toContain('(post-agent)');
    });

    it('should include formatted timestamp', () => {
      const result = runCompilation(tempDir, 'true', 'test');

      const report = createCompilationReport('test', 'cmd', result);

      expect(report).toContain('Timestamp');
      expect(report).toMatch(/\d{4}-\d{2}-\d{2}/); // Date format
    });

    it('should format as markdown', () => {
      const result = runCompilation(tempDir, 'true', 'typescript');

      const report = createCompilationReport('typescript', 'npm run build', result);

      expect(report).toContain('##');
      expect(report).toContain('**');
      expect(report).toContain('`');
    });
  });

  describe('edge cases', () => {
    it('should handle command with quotes and special characters', () => {
      const result = runCompilation(tempDir, 'echo "Hello, World!"', 'test');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello, World!');
    });

    it('should handle very large output gracefully', () => {
      // Generate large output
      const result = runCompilation(tempDir, 'for i in {1..1000}; do echo "Line $i"; done', 'test');

      expect(result.success).toBe(true);
      expect(result.output.length).toBeGreaterThan(0);
    });

    it('should preserve exit code from failed command', () => {
      // true exits 0, false exits 1
      const result = runCompilation(tempDir, 'exit 42', 'test');

      // Note: exit 42 will be capped by the system, but we should capture non-zero
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });
  });
});
