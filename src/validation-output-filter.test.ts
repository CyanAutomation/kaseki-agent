/**
 * Unit tests for validation-output-filter.ts
 */

import { filterValidationOutput, filterValidationOutputStream } from './validation-output-filter.js';
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable, Writable } from 'stream';

/**
 * Helper to run the filter with input and capture output
 */
function runFilter(input: string): Promise<string> {
  return Promise.resolve(filterValidationOutput(input));
}

async function runFilterStream(input: string): Promise<{ output: string; linesProcessed: number; linesOutput: number }> {
  let output = '';
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  const result = await filterValidationOutputStream(Readable.from([input]), writable);
  return { output, ...result };
}

function representativeLargeValidationOutput(): string {
  const lines = ['==> npm run validation'];

  for (let index = 1; index <= 2500; index++) {
    lines.push(`[DEBUG] dependency resolver noise ${index}`);
    lines.push(`[INFO] worker heartbeat ${index}`);

    if (index % 500 === 0) {
      lines.push(`PASS: validation shard ${index / 500}`);
    }
  }

  lines.push('WARNING: deprecated fixture detected');
  lines.push('FAIL: validation shard 6');
  lines.push('ERROR: expected report artifact was not created');
  lines.push('7 tests passed, 1 test failed');
  lines.push('exit_code=1');

  return `${lines.join('\n')}\n`;
}

function runFilterEntrypoint(input: string, diagnosticsLog: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(
    process.execPath,
    ['--loader', 'ts-node/esm', 'src/validation-output-filter.ts'],
    {
      cwd: join(__dirname, '..'),
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        FILTER_DIAGNOSTICS_LOG: diagnosticsLog,
      },
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

describe('validation-output-filter', () => {
  describe('Source stream API', () => {
    it('filters normal validation output from a finite source stream', async () => {
      const result = await runFilterStream([
        '==> npm run build',
        'Installing dependencies...',
        'Compiling project...',
        '✓ Build completed successfully',
        'exit_code=0',
        '',
      ].join('\n'));

      expect(result.output).toBe([
        '==> npm run build',
        '✓ Build completed successfully',
        'exit_code=0',
        '',
      ].join('\n'));
      expect(result.output).not.toContain('Installing dependencies');
      expect(result.output).not.toContain('Compiling project');
      expect(result.linesProcessed).toBe(5);
      expect(result.linesOutput).toBe(3);
    });

    it('preserves failing validation output from a finite source stream', async () => {
      const result = await runFilterStream([
        '==> npm test',
        'Running verbose setup...',
        'FAIL src/example.test.ts',
        'ERROR: expected true to be false',
        'Tests: 1 failed, 2 passed, 3 total',
        'exit_code=1',
        '',
      ].join('\n'));

      expect(result.output).toContain('==> npm test');
      expect(result.output).toContain('FAIL src/example.test.ts');
      expect(result.output).toContain('ERROR: expected true to be false');
      expect(result.output).toContain('Tests: 1 failed, 2 passed, 3 total');
      expect(result.output).toContain('exit_code=1');
      expect(result.output).not.toContain('Running verbose setup');
      expect(result.linesProcessed).toBe(6);
      expect(result.linesOutput).toBe(5);
    });

    it('handles empty finite source streams', async () => {
      const result = await runFilterStream('');

      expect(result.output).toBe('');
      expect(result.linesProcessed).toBe(0);
      expect(result.linesOutput).toBe(0);
    });

    it('handles truncated finite source streams without requiring exit_code', async () => {
      const result = await runFilterStream([
        '==> npm run validation',
        'Verbose line before stream truncation',
        'WARNING: retained before truncation',
        'FAIL retained failing shard before truncation',
      ].join('\n'));

      expect(result.output).toBe([
        '==> npm run validation',
        'WARNING: retained before truncation',
        'FAIL retained failing shard before truncation',
        '',
      ].join('\n'));
      expect(result.output).not.toContain('Verbose line before stream truncation');
      expect(result.linesProcessed).toBe(4);
      expect(result.linesOutput).toBe(3);
    });
  });

  describe('Error and warning handling', () => {
    it('should always show ERROR lines', async () => {
      const input = `==> npm run test
Some verbose output
ERROR: Something went wrong
More verbose output
exit_code=1`;
      const output = await runFilter(input);
      expect(output).toContain('ERROR: Something went wrong');
    });

    it('should always show WARN lines', async () => {
      const input = `==> npm run check
Linting file.ts
WARNING: unused variable
More linting
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('WARNING: unused variable');
    });

    it('should always show FATAL lines', async () => {
      const input = `==> npm run build
Building...
FATAL: out of memory
exit_code=1`;
      const output = await runFilter(input);
      expect(output).toContain('FATAL: out of memory');
    });

    it('should always show stack traces', async () => {
      const input = `==> npm run test
Running tests...
Error: Test failed
  at Object.<anonymous> (/app/test.js:10:5)
  at Module._load (internal/modules/loader.js:220:10)
exit_code=1`;
      const output = await runFilter(input);
      expect(output).toContain('at Object.<anonymous>');
      expect(output).toContain('at Module._load');
    });

    it('should always show Exception lines', async () => {
      const input = `==> npm run test
Running tests...
TypeError: Cannot read property 'foo' of undefined
Exception in handler
exit_code=1`;
      const output = await runFilter(input);
      expect(output).toContain('Exception in handler');
    });
  });

  describe('Command boundary handling', () => {
    it('should always show command start (==>)', async () => {
      const input = `==> npm run test
verbose output line 1
verbose output line 2
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('==> npm run test');
    });

    it('should always show exit code line', async () => {
      const input = `==> npm run test
Some output
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('exit_code=0');
    });

    it('should handle multiple command blocks', async () => {
      const input = `==> npm run check
Some linting output
exit_code=0
==> npm run test
Running tests...
PASS: test 1
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('==> npm run check');
      expect(output).toContain('==> npm run test');
      expect(output).toContain('PASS: test 1');
    });
  });

  describe('Test result indicator handling', () => {
    it('should show PASS lines', async () => {
      const input = `==> npm run test
Test suite running...
✓ PASS: test case 1
✓ PASS: test case 2
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('PASS: test case 1');
      expect(output).toContain('PASS: test case 2');
    });

    it('should show FAIL lines', async () => {
      const input = `==> npm run test
✗ FAIL: test case 1
Error expected but got success
exit_code=1`;
      const output = await runFilter(input);
      expect(output).toContain('FAIL: test case 1');
    });

    it('should show OK lines', async () => {
      const input = `==> npm run test
Checking syntax...
All files OK
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('All files OK');
    });

    it('should show test summary lines', async () => {
      const input = `==> npm run test
Test suite running...
verbose test execution logs...
7 tests passed, 1 test failed
exit_code=1`;
      const output = await runFilter(input);
      expect(output).toContain('7 tests passed, 1 test failed');
    });

    it('should show checkmark/cross symbols', async () => {
      const input = `==> npm run check
Linting files...
✓ src/index.ts
✗ src/broken.ts
exit_code=1`;
      const output = await runFilter(input);
      expect(output).toContain('✓ src/index.ts');
      expect(output).toContain('✗ src/broken.ts');
    });

    it('should show success keyword', async () => {
      const input = `==> npm run test
Running tests...
verbose output...
Build success
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('Build success');
    });

    it('should show completed/finished keywords', async () => {
      const input = `==> npm run build
Building project...
Compilation completed in 2.3s
Bundling finished
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('Compilation completed');
      expect(output).toContain('Bundling finished');
    });
  });

  describe('Verbose output filtering', () => {
    it('should filter out verbose lines between command start and meaningful output', async () => {
      const input = `==> npm run test
Resolving dependencies...
Loading configuration...
Initializing test environment...
Starting test runner...
PASS: test 1
exit_code=0`;
      const output = await runFilter(input);

      // Should have: command start, first line, pass line, exit code = 4 lines
      // Should NOT have the verbose initialization lines
      expect(output).toContain('==> npm run test');
      expect(output).toContain('PASS: test 1');
      expect(output).toContain('exit_code=0');
      expect(output).not.toContain('Resolving dependencies');
      expect(output).not.toContain('Loading configuration');
      expect(output).not.toContain('Initializing test environment');
    });

    it('should filter npm verbose output', async () => {
      const input = `==> npm run build
npm notice
npm notice This is npm version 8.5.0
npm notice
npm notice Welcome to npm!
npm notice Run 'npm help' to get help.
Building project...
✓ Build successful
exit_code=0`;
      const output = await runFilter(input);
      expect(output).not.toContain('npm notice');
      expect(output).toContain('Build successful');
    });

    it('should filter progress indicators', async () => {
      const input = `==> npm run test
Running 100 tests...
[████████  ] 80% complete
[██████████] 100% complete
All tests passed
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('All tests passed');
      expect(output).not.toContain('% complete');
    });
  });

  describe('Large validation output contracts', () => {
    it('retains exact deterministic markers and truncates bounded noisy fixture lines', async () => {
      const lines = ['==> npm run bounded-large-fixture'];

      for (let index = 1; index <= 1200; index++) {
        lines.push(`NOISE truncate-me-${index}`);

        if (index === 400) {
          lines.push('PASS: RETAINED_MARKER_ALPHA');
        }

        if (index === 800) {
          lines.push('ERROR: RETAINED_MARKER_BRAVO');
        }
      }

      lines.push('2 tests passed, 0 tests failed');
      lines.push('exit_code=0');

      const output = await runFilter(`${lines.join('\n')}\n`);

      expect(output).toBe(
        [
          '==> npm run bounded-large-fixture',
          'PASS: RETAINED_MARKER_ALPHA',
          'ERROR: RETAINED_MARKER_BRAVO',
          '2 tests passed, 0 tests failed',
          'exit_code=0',
          '',
        ].join('\n')
      );
      expect(output).not.toContain('NOISE truncate-me-1');
      expect(output).not.toContain('NOISE truncate-me-1200');
    });

    it('handles a deterministic large single-line fixture with exact retained markers', async () => {
      const largeVerboseLine = `VERBOSE_SINGLE_LINE_${'x'.repeat(64 * 1024)}`;
      const input = [
        '==> npm run large-single-line-fixture',
        largeVerboseLine,
        'WARNING: RETAINED_SINGLE_LINE_WARNING',
        'exit_code=3',
        '',
      ].join('\n');

      const output = await runFilter(input);

      expect(output).toBe(
        [
          '==> npm run large-single-line-fixture',
          'WARNING: RETAINED_SINGLE_LINE_WARNING',
          'exit_code=3',
          '',
        ].join('\n')
      );
      expect(output).not.toContain('VERBOSE_SINGLE_LINE_');
    });

    it('preserves semantic validation results while filtering representative large noise', async () => {
      const output = await runFilter(representativeLargeValidationOutput());

      expect(output).toContain('==> npm run validation');
      expect(output).toContain('PASS: validation shard 1');
      expect(output).toContain('PASS: validation shard 5');
      expect(output).toContain('WARNING: deprecated fixture detected');
      expect(output).toContain('FAIL: validation shard 6');
      expect(output).toContain('ERROR: expected report artifact was not created');
      expect(output).toContain('7 tests passed, 1 test failed');
      expect(output).toContain('exit_code=1');
      expect(output).not.toContain('[DEBUG] dependency resolver noise');
      expect(output).not.toContain('[INFO] worker heartbeat');
    });

    it('creates diagnostics and reports processed/output counts when configured', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'validation-output-filter-'));
      const diagnosticsLog = join(tempDir, 'filter-diagnostics.log');

      try {
        const result = runFilterEntrypoint(representativeLargeValidationOutput(), diagnosticsLog);
        const diagnostics = readFileSync(diagnosticsLog, 'utf8');

        expect(result.status).toBe(0);
        expect(result.stderr).not.toContain('[validation-output-filter] FATAL');
        expect(result.stdout).toContain('PASS: validation shard 1');
        expect(result.stdout).toContain('FAIL: validation shard 6');
        expect(result.stdout).not.toContain('[DEBUG] dependency resolver noise');
        expect(diagnostics).toContain('filter-startup: process started');
        expect(diagnostics).toContain('filter-close: stdin_closed');
        expect(diagnostics).toContain('filter-close: lines_processed=');
        expect(diagnostics).toContain('filter-close: lines_output=');
        expect(diagnostics).toContain('filter-close: exit_code=0');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle empty input', async () => {
      const input = '';
      const output = await runFilter(input);
      expect(output).toBe('');
    });

    it('should handle single line input', async () => {
      const input = '==> npm run test';
      const output = await runFilter(input);
      expect(output).toContain('==> npm run test');
    });

    it('should handle input without command boundaries', async () => {
      const input = `Some output line 1
Some output line 2
ERROR: Something failed
exit_code=1`;
      const output = await runFilter(input);
      expect(output).toContain('ERROR: Something failed');
    });

    it('should handle consecutive error lines', async () => {
      const input = `==> npm run test
ERROR: First error
ERROR: Second error
ERROR: Third error
exit_code=1`;
      const output = await runFilter(input);
      const errorCount = (output.match(/ERROR:/g) || []).length;
      expect(errorCount).toBe(3);
    });

    it('should preserve line order', async () => {
      const input = `==> npm run test
PASS: test 1
ERROR: test 2
PASS: test 3
ERROR: test 4
exit_code=1`;
      const output = await runFilter(input);
      const lines = output.trim().split('\n');
      const resultLines = lines.filter((l) => l.includes('PASS') || l.includes('ERROR'));
      expect(resultLines[0]).toContain('PASS: test 1');
      expect(resultLines[1]).toContain('ERROR: test 2');
      expect(resultLines[2]).toContain('PASS: test 3');
      expect(resultLines[3]).toContain('ERROR: test 4');
    });

    it('should handle lines with special characters', async () => {
      const input = `==> npm run test
ERROR: Special chars: !@#$%^&*()
PASS: Unicode ✓ ✗ → ✓
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('Special chars: !@#$%^&*()');
      expect(output).toContain('Unicode ✓ ✗');
    });

    it('should handle very long lines', async () => {
      const veryLongLine = 'a'.repeat(10000);
      const input = `==> npm run test
${veryLongLine}
ERROR: This is important
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('ERROR: This is important');
    });

    it('should handle multiple spaces and tabs', async () => {
      const input = `==> npm run test
    verbose output with indent
  ERROR:    spaced error
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('ERROR:');
    });

    it('should handle case-insensitive keywords', async () => {
      const input = `==> npm run test
pass test 1
PASS test 2
Pass test 3
warn something
WARNING something
error occurred
ERROR occurred
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('pass test 1');
      expect(output).toContain('PASS test 2');
      expect(output).toContain('warn something');
      expect(output).toContain('error occurred');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle a realistic npm test run', async () => {
      const input = `==> npm run test
npm WARN some-package deprecated
FAIL  src/__tests__/handler.test.ts
  ● my test suite › should validate input
    Expected "foo" to equal "bar"

      5 |     expect(handler(input)).toBe("bar");
        |                                    ^
      6 |   });

Test Suites: 1 failed, 0 passed, 1 total
Tests:       5 failed, 10 passed, 15 total
Snapshots:   0 total
Time:        2.345 s
exit_code=1`;
      const output = await runFilter(input);

      // Should contain:
      expect(output).toContain('==> npm run test');
      expect(output).toContain('FAIL');
      expect(output).toContain('failed');
      expect(output).toContain('exit_code=1');

      // Should NOT contain verbose lines
      expect(output).not.toContain('npm WARN');
      expect(output).not.toContain('Expected "foo"');
    });

    it('should handle a realistic npm build run', async () => {
      const input = `==> npm run build
npm notice
npm notice Welcome to npm!
npm notice
Linting source files...
Compiling TypeScript...
Bundling...
✓ Build completed successfully
✓ Output: dist/index.js (45.2 KB)
exit_code=0`;
      const output = await runFilter(input);

      expect(output).toContain('==> npm run build');
      expect(output).toContain('Build completed successfully');
      expect(output).toContain('Output: dist/index.js');
      expect(output).toContain('exit_code=0');

      // Should filter npm notices
      expect(output).not.toContain('npm notice');
      expect(output).not.toContain('Linting source files');
      expect(output).not.toContain('Compiling TypeScript');
    });

    it('should handle multiple sequential commands with mixed results', async () => {
      const input = `==> npm run lint
Linting files...
src/index.ts: 3 issues found
exit_code=1
==> npm run test
Running tests...
PASS: Suite 1
PASS: Suite 2
5 tests passed
exit_code=0
==> npm run build
Building...
Bundle complete
exit_code=0`;
      const output = await runFilter(input);

      // Should have all three command starts
      expect(output).toContain('==> npm run lint');
      expect(output).toContain('==> npm run test');
      expect(output).toContain('==> npm run build');

      // Should have all exit codes
      expect(output).toContain('exit_code=1');
      expect(output).toContain('exit_code=0');

      // Should have key results
      expect(output).toContain('PASS: Suite 1');
      expect(output).toContain('Bundle complete');
    });
  });

  describe('Error handling (process-level)', () => {
    it('should not crash on empty input to readline', async () => {
      // This tests the filterValidationOutput function which is used in non-streaming context
      // The streaming error handling is tested through integration tests
      const input = '';
      const output = await runFilter(input);
      // Should not throw, should return empty string
      expect(output).toBe('');
    });

    it('should handle input with only command boundaries and no content', async () => {
      const input = `==> npm run test
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('==> npm run test');
      expect(output).toContain('exit_code=0');
    });

    it('should preserve output even with mixed verbose and error content', async () => {
      const input = `==> npm run check
verbose line 1
ERROR: TypeScript compilation failed
verbose line 2
ERROR: Type mismatch in file.ts
verbose line 3
exit_code=1`;
      const output = await runFilter(input);
      expect(output).toContain('ERROR: TypeScript compilation failed');
      expect(output).toContain('ERROR: Type mismatch in file.ts');
      expect(output).not.toContain('verbose line 1');
      expect(output).not.toContain('verbose line 2');
      expect(output).not.toContain('verbose line 3');
    });

    it('should handle commands with no meaningful output (only verbose lines)', async () => {
      const input = `==> npm run silent-task
Running background task...
Processing items...
Finalizing...
exit_code=0`;
      const output = await runFilter(input);
      // Should include command boundaries but filter out verbose lines
      expect(output).toContain('==> npm run silent-task');
      expect(output).toContain('exit_code=0');
      expect(output).not.toContain('Running background task');
    });

    it('should handle rapid fire error lines without losing data', async () => {
      const input = `==> npm run test
ERROR: error 1
ERROR: error 2
ERROR: error 3
ERROR: error 4
ERROR: error 5
exit_code=1`;
      const output = await runFilter(input);
      const errorLines = output.split('\n').filter((l) => l.includes('ERROR'));
      expect(errorLines.length).toBe(5);
    });

    it('should handle malformed exit_code line gracefully', async () => {
      const input = `==> npm run test
Some output
exit_code=abc
exit_code=0`;
      const output = await runFilter(input);
      expect(output).toContain('exit_code');
    });
  });
});
