#!/usr/bin/env node

/**
 * kaseki-cli.test.js
 *
 * Unit and integration tests for kaseki-cli library.
 * Creates mock artifacts and validates query functions.
 *
 * Run: node kaseki-cli.test.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const kasekiCli = require('./kaseki-cli-lib.js');

// ============================================================================
// Test Setup
// ============================================================================

const TEST_DIR = '/tmp/kaseki-cli-test';
const MOCK_RESULTS_DIR = path.join(TEST_DIR, 'agents', 'kaseki-results');

function setupTestEnvironment() {
  // Remove previous test data
  if (fs.existsSync(TEST_DIR)) {
    execSync(`rm -rf "${TEST_DIR}"`);
  }

  // Create directory structure
  fs.mkdirSync(MOCK_RESULTS_DIR, { recursive: true });
}

function createMockInstance(name, overrides = {}) {
  const instanceDir = path.join(MOCK_RESULTS_DIR, name);
  fs.mkdirSync(instanceDir, { recursive: true });

  // Mock host-start.json
  const hostStart = {
    instance: name,
    repo: 'CyanAutomation/crudmapper',
    ref: 'main',
    model: 'openrouter/claude-3.5-sonnet',
    agentTimeoutSeconds: 1200,
    ...overrides.hostStart,
  };
  fs.writeFileSync(path.join(instanceDir, 'host-start.json'), JSON.stringify(hostStart, null, 2));

  // Mock metadata.json
  const metadata = {
    instance: name,
    start_time: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
    duration_seconds: 300,
    exit_code: 0,
    pi_exit_code: 0,
    validation_exit_code: 0,
    quality_exit_code: 0,
    current_stage: 'completed',
    model: 'openrouter/claude-3.5-sonnet',
    ...overrides.metadata,
  };
  fs.writeFileSync(path.join(instanceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // Mock exit_code
  if (metadata.exit_code !== null && metadata.exit_code !== undefined) {
    fs.writeFileSync(path.join(instanceDir, 'exit_code'), String(metadata.exit_code));
  }

  // Mock stdout.log with stage markers
  const stdoutContent = `==> Cloning repository
Cloning into 'workspace/repo'...
done.
==> Installing dependencies
npm WARN deprecated ...
added 150 packages
==> Running Pi agent
Invoking Pi CLI...
==> Running validation
npm run check ✓
npm run test ✓
npm run build ✓
==> Collecting artifacts
Done.
`;
  fs.writeFileSync(path.join(instanceDir, 'stdout.log'), stdoutContent);

  // Mock stderr.log
  const stderrContent = overrides.hasErrors ? 'Error: something went wrong\n' : '';
  fs.writeFileSync(path.join(instanceDir, 'stderr.log'), stderrContent);

  // Mock resource.time
  fs.writeFileSync(path.join(instanceDir, 'resource.time'), 'elapsed_seconds=300\n');

  // Mock pi-summary.json
  const piSummary = {
    model: 'openrouter/claude-3.5-sonnet',
    api: 'openrouter',
    tool_start_count: 5,
    tool_end_count: 5,
    event_count: 42,
    start_time: new Date(Date.now() - 180000).toISOString(),
    end_time: new Date(Date.now() - 60000).toISOString(),
  };
  fs.writeFileSync(path.join(instanceDir, 'pi-summary.json'), JSON.stringify(piSummary, null, 2));

  // Mock validation-timings.tsv
  const validationTimings = `npm run check\t0\t10
npm run test\t0\t45
npm run build\t0\t30
`;
  fs.writeFileSync(path.join(instanceDir, 'validation-timings.tsv'), validationTimings);

  // Mock changed-files.txt
  const changedFiles = `src/lib/parser.ts
tests/parser.test.ts
`;
  fs.writeFileSync(path.join(instanceDir, 'changed-files.txt'), changedFiles);

  // Mock git.diff
  const diffContent = `diff --git a/src/lib/parser.ts b/src/lib/parser.ts
index abc123..def456 100644
--- a/src/lib/parser.ts
+++ b/src/lib/parser.ts
@@ -10,7 +10,8 @@
   export function parse() {
-    const result = {};
+    const result = { fixed: true };
     return result;
   }
`;
  fs.writeFileSync(path.join(instanceDir, 'git.diff'), diffContent);

  // Mock quality.log (only if there are quality issues)
  if (overrides.hasQualityIssues) {
    fs.writeFileSync(path.join(instanceDir, 'quality.log'), 'Diff exceeds maximum size\n');
  }

  // Mock secret-scan.log (only if there are secrets)
  if (overrides.hasSecrets) {
    fs.writeFileSync(path.join(instanceDir, 'secret-scan.log'), 'Found: sk-or-abcd1234...\n');
  }

  // Mock validation.log
  const validationLog = `Running: npm run check
✓ passed
Running: npm run test
✓ passed
Running: npm run build
✓ passed
`;
  fs.writeFileSync(path.join(instanceDir, 'validation.log'), validationLog);

  // Mock result-summary.md
  const summary = `# Kaseki Run: ${name}

**Status**: Success
**Duration**: 300s
**Exit Code**: 0

## Changed Files
- src/lib/parser.ts
- tests/parser.test.ts
`;
  fs.writeFileSync(path.join(instanceDir, 'result-summary.md'), summary);
}

// ============================================================================
// Tests
// ============================================================================

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    testsPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    testsFailed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
}

function assertExists(value, message) {
  assert(value !== null && value !== undefined, `${message} (exists)`);
}

// Override config for testing
kasekiCli.config.KASEKI_RESULTS_DIR = MOCK_RESULTS_DIR;

function testListInstances() {
  console.log('\n→ Testing listInstances()');

  createMockInstance('kaseki-1');
  createMockInstance('kaseki-2');

  const instances = kasekiCli.listInstances();

  assertEqual(instances.length, 2, 'Should find 2 instances');
  assertEqual(instances[0].name, 'kaseki-2', 'Should sort newest first');
  assertEqual(instances[1].name, 'kaseki-1', 'Should sort oldest last');

  createMockInstance('kaseki-3', { metadata: { exit_code: null } });
  const instancesWithPending = kasekiCli.listInstances();
  const pending = instancesWithPending.find((instance) => instance.name === 'kaseki-3');
  assertEqual(pending.status, 'pending', 'Should mark missing exit code as pending');
}

function testExactContainerNameMatching() {
  console.log('\n→ Testing exact docker name matching helpers');

  const dockerNamesOutput = `kaseki-1
kaseki-10
some-other-container
`;

  const names = kasekiCli.parseDockerContainerNames(dockerNamesOutput);
  assertEqual(names.length, 3, 'Should parse docker names output into discrete names');

  assert(kasekiCli.isExactContainerNameMatch('kaseki-1', 'kaseki-1'), 'Should match identical names');
  assert(!kasekiCli.isExactContainerNameMatch('kaseki-10', 'kaseki-1'), 'Should not match partial names');

  assert(
    kasekiCli.dockerNamesOutputHasInstance(dockerNamesOutput, 'kaseki-1'),
    'Should find exact match for kaseki-1'
  );
  assert(
    kasekiCli.dockerNamesOutputHasInstance(dockerNamesOutput, 'kaseki-10'),
    'Should find exact match for kaseki-10'
  );
  assert(
    !kasekiCli.dockerNamesOutputHasInstance('kaseki-10\n', 'kaseki-1'),
    'Should not treat kaseki-10 as match for kaseki-1'
  );
}

function testReadArtifact() {
  console.log('\n→ Testing readArtifact()');

  createMockInstance('kaseki-10');

  const metadata = kasekiCli.readArtifact('kaseki-10', 'metadata.json');
  assertExists(metadata, 'Should read metadata file');
  assert(metadata.includes('"instance"'), 'Metadata should contain instance key');

  const missing = kasekiCli.readArtifact('kaseki-10', 'nonexistent.txt');
  assert(missing === null, 'Should return null for nonexistent file');
}

function testReadJsonArtifact() {
  console.log('\n→ Testing readJsonArtifact()');

  createMockInstance('kaseki-11');

  const metadata = kasekiCli.readJsonArtifact('kaseki-11', 'metadata.json');
  assertEqual(metadata.exit_code, 0, 'Should parse JSON correctly');

  const missing = kasekiCli.readJsonArtifact('kaseki-11', 'nonexistent.json');
  assertEqual(Object.keys(missing).length, 0, 'Should return empty object for missing file');
}

function testReadLiveLog() {
  console.log('\n→ Testing readLiveLog()');

  createMockInstance('kaseki-12');

  const logs = kasekiCli.readLiveLog('kaseki-12', 'stdout.log', 5);
  assertExists(logs, 'Should read log file');
  assert(logs.includes('Collecting artifacts'), 'Should include log content');
  assert(logs.split('\n').length <= 6, 'Should respect tail limit'); // +1 for potential empty line
}

function testGetCurrentStage() {
  console.log('\n→ Testing getCurrentStage()');

  createMockInstance('kaseki-13');

  const stage = kasekiCli.getCurrentStage('kaseki-13');
  assertEqual(stage, 'Collecting artifacts', 'Should extract final stage from logs');
}

function testGetConfiguredTimeout() {
  console.log('\n→ Testing getConfiguredTimeout()');

  createMockInstance('kaseki-14');

  const timeout = kasekiCli.getConfiguredTimeout('kaseki-14');
  assertEqual(timeout, 1200, 'Should read timeout from host-start.json');

  // Test default fallback
  createMockInstance('kaseki-15', {
    hostStart: { agentTimeoutSeconds: undefined },
  });
  const defaultTimeout = kasekiCli.getConfiguredTimeout('kaseki-15');
  assertEqual(defaultTimeout, 1200, 'Should use default 1200s when not specified');
}

function testCalculateTimeoutRiskPercent() {
  console.log('\n→ Testing calculateTimeoutRiskPercent()');

  createMockInstance('kaseki-16');

  const risk0 = kasekiCli.calculateTimeoutRiskPercent('kaseki-16', 0);
  assertEqual(risk0, 0, 'Should return 0% for 0 elapsed');

  const risk50 = kasekiCli.calculateTimeoutRiskPercent('kaseki-16', 600);
  assertEqual(risk50, 50, 'Should return 50% for 600s (half of 1200s timeout)');

  const risk100 = kasekiCli.calculateTimeoutRiskPercent('kaseki-16', 1300);
  assertEqual(risk100, 100, 'Should cap at 100%');
}

function testGetInstanceStatus() {
  console.log('\n→ Testing getInstanceStatus()');

  createMockInstance('kaseki-17');

  const status = kasekiCli.getInstanceStatus('kaseki-17');

  assertEqual(status.instance, 'kaseki-17', 'Should have instance name');
  assertEqual(status.stage, 'Collecting artifacts', 'Should extract stage');
  assertExists(status.elapsedSeconds, 'Should have elapsed time');
  assertEqual(status.timeoutSeconds, 1200, 'Should have timeout');
  assert(status.timeoutRiskPercent >= 0 && status.timeoutRiskPercent <= 100, 'Timeout risk should be 0-100%');
  assertEqual(status.exitCode, 0, 'Should have exit code');
  assertEqual(status.status, 'completed', 'Should derive completed status');
  assert(!status.running, 'Should be marked as not running');

  createMockInstance('kaseki-170', { metadata: { exit_code: null } });
  const pending = kasekiCli.getInstanceStatus('kaseki-170');
  assertEqual(pending.status, 'pending', 'Should derive pending status when exit code is unavailable');

  const missing = kasekiCli.getInstanceStatus('nonexistent-instance');
  assertExists(missing.error, 'Should return error for missing instance');
}

function testDetectErrors() {
  console.log('\n→ Testing detectErrors()');

  // Success case
  createMockInstance('kaseki-18');
  const cleanErrors = kasekiCli.detectErrors('kaseki-18');
  assertEqual(cleanErrors.length, 0, 'Should find no errors in clean run');

  // Error case
  createMockInstance('kaseki-19', { hasErrors: true });
  const dirtyErrors = kasekiCli.detectErrors('kaseki-19');
  assert(dirtyErrors.length > 0, 'Should find errors when present');

  // Quality gate failures
  createMockInstance('kaseki-20', { hasQualityIssues: true });
  const qualityErrors = kasekiCli.detectErrors('kaseki-20');
  assert(qualityErrors.some((e) => e.source === 'quality-gate'), 'Should detect quality gate failures');

  // Secret scan failures
  createMockInstance('kaseki-21', { hasSecrets: true });
  const secretErrors = kasekiCli.detectErrors('kaseki-21');
  assert(secretErrors.some((e) => e.source === 'secret-scan'), 'Should detect secret scan failures');
}

function testDetectAnomalies() {
  console.log('\n→ Testing detectAnomalies()');

  createMockInstance('kaseki-22');
  const cleanAnomalies = kasekiCli.detectAnomalies('kaseki-22');
  assertEqual(cleanAnomalies.length, 0, 'Should find no anomalies for normal run');

  // Timeout risk - create instance approaching timeout
  createMockInstance('kaseki-23', {
    metadata: { duration_seconds: 1150 }, // 1150s / 1200s = 95.8%
  });
  const timeoutAnomalies = kasekiCli.detectAnomalies('kaseki-23');
  assert(timeoutAnomalies.some((a) => a.type === 'timeout-risk'), 'Should detect timeout risk');
}

function testParseValidationTimings() {
  console.log('\n→ Testing parseValidationTimings()');

  createMockInstance('kaseki-24');

  const timings = kasekiCli.parseValidationTimings('kaseki-24');

  assertEqual(timings.length, 3, 'Should parse 3 validation commands');
  assertEqual(timings[0].command, 'npm run check', 'Should extract command name');
  assertEqual(timings[0].exitCode, 0, 'Should extract exit code');
  assertEqual(timings[0].durationSeconds, 10, 'Should extract duration');
}

function testGetAnalysis() {
  console.log('\n→ Testing getAnalysis()');

  createMockInstance('kaseki-25');

  const analysis = kasekiCli.getAnalysis('kaseki-25');

  assertEqual(analysis.instance, 'kaseki-25', 'Should have instance name');
  assertEqual(analysis.duration, 300, 'Should have duration');
  assertEqual(analysis.exitCode, 0, 'Should have exit code');
  assertEqual(analysis.changedFileCount, 2, 'Should count changed files');
  assert(analysis.diffSizeBytes > 0, 'Should calculate diff size');
  assert(analysis.validationCommands.length > 0, 'Should include validation commands');
  assertExists(analysis.piMetrics, 'Should include Pi metrics');
}

// ============================================================================
// Test Runner
// ============================================================================

console.log('================================================================================');
console.log('kaseki-cli Library Tests');
console.log('================================================================================');

setupTestEnvironment();

testListInstances();
testExactContainerNameMatching();
testReadArtifact();
testReadJsonArtifact();
testReadLiveLog();
testGetCurrentStage();
testGetConfiguredTimeout();
testCalculateTimeoutRiskPercent();
testGetInstanceStatus();
testDetectErrors();
testDetectAnomalies();
testParseValidationTimings();
testGetAnalysis();

// Summary
console.log('\n================================================================================');
console.log(`Test Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('================================================================================\n');

// Cleanup
execSync(`rm -rf "${TEST_DIR}"`);

process.exit(testsFailed > 0 ? 1 : 0);
