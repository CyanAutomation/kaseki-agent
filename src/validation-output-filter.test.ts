/**
 * Unit tests for validation-output-filter.ts
 */

import { filterValidationOutput } from './validation-output-filter.js';

/**
 * Helper to run the filter with input and capture output
 */
function runFilter(input: string): Promise<string> {
  return Promise.resolve(filterValidationOutput(input));
}

describe('validation-output-filter', () => {
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
});
