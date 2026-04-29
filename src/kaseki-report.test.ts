import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

describe('kaseki-report', () => {
  let baseDir: string;

  beforeAll(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-report-test-'));
  });

  afterAll(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  function createFixture(name: string, exitCodeValue: any): string {
    const dir = path.join(baseDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'metadata.json'),
      JSON.stringify({
        instance: name,
        exit_code: exitCodeValue,
        pi_exit_code: exitCodeValue,
        validation_exit_code: exitCodeValue,
        quality_exit_code: exitCodeValue,
        secret_scan_exit_code: exitCodeValue,
      })
    );
    fs.writeFileSync(path.join(dir, 'changed-files.txt'), 'src/index.js\n');
    return dir;
  }

  function runFixture(fixtureDir: string): {
    stdout: string;
    stderr: string;
    code: number | null;
  } {
    const result = spawnSync('node', ['dist/kaseki-report.js', fixtureDir], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  const testCases = [
    {
      name: 'exit-num-zero',
      exitCodeValue: 0,
      expectedStatus: 'passed',
      expectedCode: '0',
    },
    {
      name: 'exit-str-zero',
      exitCodeValue: '0',
      expectedStatus: 'passed',
      expectedCode: '0',
    },
    {
      name: 'exit-num-one',
      exitCodeValue: 1,
      expectedStatus: 'failed',
      expectedCode: '1',
    },
    {
      name: 'exit-str-one',
      exitCodeValue: '1',
      expectedStatus: 'failed',
      expectedCode: '1',
    },
    {
      name: 'exit-invalid',
      exitCodeValue: 'invalid',
      expectedStatus: 'failed',
      expectedCode: 'unknown',
    },
  ];

  testCases.forEach(({ name, exitCodeValue, expectedStatus, expectedCode }) => {
    test(`${name}: normalizes exit code and reflects status`, () => {
      const fixtureDir = createFixture(name, exitCodeValue);
      const result = runFixture(fixtureDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`Status: ${expectedStatus}`);
      expect(result.stdout).toContain(`Exit code: ${expectedCode}`);
      expect(result.stdout).toContain(`Pi exit code: ${expectedCode}`);
    });
  });
});
