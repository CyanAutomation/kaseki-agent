#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
    return;
  }
  failed++;
  console.error(`  ✗ ${message}`);
}

function createFixture(baseDir, name, exitCodeValue) {
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

function runFixture(fixtureDir) {
  const result = spawnSync('node', ['kaseki-report.js', fixtureDir], {
    cwd: path.join(__dirname, '..', '..', 'lib'),
    encoding: 'utf8',
  });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status };
}

function run() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-report-test-'));
  const cases = [
    { name: 'exit-num-zero', fixture: 'metadata-exit-0.json', expectedStatus: 'passed', expectedCode: '0' },
    { name: 'exit-str-zero', fixture: 'metadata-exit-str-0.json', expectedStatus: 'passed', expectedCode: '0' },
    { name: 'exit-num-one', fixture: 'metadata-exit-1.json', expectedStatus: 'failed', expectedCode: '1' },
    { name: 'exit-str-one', fixture: 'metadata-exit-str-1.json', expectedStatus: 'failed', expectedCode: '1' },
    { name: 'exit-str-invalid', fixture: 'metadata-exit-invalid.json', expectedStatus: 'failed', expectedCode: 'unknown' },
  ];

  try {
    for (const testCase of cases) {
      const fixturePath = path.join(__dirname, '..', 'fixtures', 'kaseki-report-exit-codes', testCase.fixture);
      const metadata = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      const fixtureDir = createFixture(baseDir, testCase.name, metadata.exit_code);
      const result = runFixture(fixtureDir);
      assert(result.code === 0, `${testCase.name}: report command exits with code 0`);
      assert(result.stdout.includes(`Status: ${testCase.expectedStatus}`), `${testCase.name}: status reflects normalized exit code`);
      assert(result.stdout.includes(`Exit code: ${testCase.expectedCode}`), `${testCase.name}: printed exit code uses normalization`);
      assert(result.stdout.includes(`Pi exit code: ${testCase.expectedCode}`), `${testCase.name}: pi exit code uses normalization`);
    }
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
