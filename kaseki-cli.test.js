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
const { EventEmitter } = require('events');
const { execSync, spawnSync } = require('child_process');
const kasekiCli = require('./kaseki-cli-lib.js');
const { createFollowPoller } = require('./kaseki-cli.js');

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

  const progressEvents = [
    { timestamp: '2026-04-27T00:00:00Z', stage: 'clone repository', message: 'started' },
    { timestamp: '2026-04-27T00:00:01Z', stage: 'clone repository', message: 'finished with exit 0' },
    { timestamp: '2026-04-27T00:00:02Z', stage: 'pi coding agent', message: 'working; events=10, tool starts=1, tool ends=1' },
  ];
  fs.writeFileSync(
    path.join(instanceDir, 'progress.jsonl'),
    `${progressEvents.map((event) => JSON.stringify(event)).join('\n')}\n`
  );

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
    ...overrides.piSummary,
  };
  fs.writeFileSync(path.join(instanceDir, 'pi-summary.json'), JSON.stringify(piSummary, null, 2));

  // Mock validation-timings.tsv
  const validationTimings =
    overrides.validationTimings ??
    `npm run check\t0\t10
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

  createMockInstance('kaseki-4', { metadata: { exit_code: 9 } });
  fs.unlinkSync(path.join(MOCK_RESULTS_DIR, 'kaseki-4', 'exit_code'));
  const instancesWithMetadataOnlyExitCode = kasekiCli.listInstances();
  const metadataOnlyExitCode = instancesWithMetadataOnlyExitCode.find((instance) => instance.name === 'kaseki-4');
  assertEqual(metadataOnlyExitCode.exitCode, 9, 'Should use metadata exit code when exit_code file is absent');
  assertEqual(metadataOnlyExitCode.status, 'failed', 'Should derive failed status from metadata exit code when file is absent');
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

  createMockInstance('kaseki-12-empty');
  fs.writeFileSync(path.join(MOCK_RESULTS_DIR, 'kaseki-12-empty', 'stdout.log'), '');

  const emptyLogs = kasekiCli.readLiveLog('kaseki-12-empty', 'stdout.log', 5);
  assertEqual(emptyLogs, '', 'Should return empty string for existing empty log file (not not-found path)');
}

function testReadProgressEvents() {
  console.log('\n→ Testing readProgressEvents()');

  createMockInstance('kaseki-12-progress');

  const events = kasekiCli.readProgressEvents('kaseki-12-progress', 2);
  assertEqual(events.length, 2, 'Should tail progress events');
  assertEqual(events[0].stage, 'clone repository', 'Should parse progress JSONL');
  assertEqual(events[1].stage, 'pi coding agent', 'Should include latest progress event');

  fs.writeFileSync(path.join(MOCK_RESULTS_DIR, 'kaseki-12-progress', 'progress.jsonl'), 'not-json\n');
  const malformed = kasekiCli.readProgressEvents('kaseki-12-progress', 1);
  assertEqual(malformed[0].malformed, true, 'Should mark malformed progress lines');
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

  createMockInstance('kaseki-171', { metadata: { exit_code: 7 } });
  fs.unlinkSync(path.join(MOCK_RESULTS_DIR, 'kaseki-171', 'exit_code'));
  const metadataFallbackStatus = kasekiCli.getInstanceStatus('kaseki-171');
  assertEqual(metadataFallbackStatus.exitCode, 7, 'Should use metadata exit code when exit_code file is absent');
  assertEqual(metadataFallbackStatus.status, 'failed', 'Should derive lifecycle from metadata fallback exit code');

  createMockInstance('kaseki-172', {
    metadata: {
      duration_seconds: undefined,
      started_at: new Date(Date.now() - 120000).toISOString(),
      start_time: undefined,
      exit_code: null,
    },
  });

  const childProcess = require('child_process');
  const originalExecSync = childProcess.execSync;
  childProcess.execSync = (command, options) => {
    if (command.includes('docker ps --format')) {
      return 'kaseki-172\n';
    }
    return originalExecSync(command, options);
  };

  delete require.cache[require.resolve('./kaseki-cli-lib.js')];
  const runningAwareCli = require('./kaseki-cli-lib.js');
  runningAwareCli.config.KASEKI_RESULTS_DIR = MOCK_RESULTS_DIR;

  const startedAtStatus = runningAwareCli.getInstanceStatus('kaseki-172');
  assertExists(startedAtStatus.elapsedSeconds, 'Should estimate elapsed time for running instance with started_at');
  assert(startedAtStatus.elapsedSeconds > 0, 'Estimated elapsed time from started_at should be positive');
  assertEqual(startedAtStatus.running, true, 'Should mark instance as running when docker lists exact name');

  childProcess.execSync = originalExecSync;
  delete require.cache[require.resolve('./kaseki-cli-lib.js')];

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

  createMockInstance('kaseki-240', {
    validationTimings: `npm run check\t0\t10
npm run bad-exit\tok\t30
npm run bad-duration\t0\t12.5
npm run test\t1\t45
`,
  });

  const malformedWarnings = [];
  const malformedResult = kasekiCli.parseValidationTimings('kaseki-240', {
    includeMalformedRowCount: true,
    onMalformedRows: ({ malformedRowCount }) => malformedWarnings.push(malformedRowCount),
  });

  assertEqual(malformedResult.timings.length, 2, 'Should exclude malformed rows');
  assertEqual(malformedResult.malformedRowCount, 2, 'Should count malformed rows');
  assertEqual(malformedWarnings.length, 1, 'Should report malformed rows once');
  assertEqual(malformedWarnings[0], 2, 'Warning channel should receive malformed row count');
  assertEqual(malformedResult.timings[1].command, 'npm run test', 'Should keep valid rows after malformed entries');
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

  createMockInstance('kaseki-26', {
    hostStart: { model: 'openrouter/gpt-4.1-mini' },
    piSummary: {
      selected_model: 'openrouter/claude-3.7-sonnet',
      model: 'legacy-model-should-not-win',
      event_counts: {
        message: 7,
        tool_start: 3,
        tool_end: 3,
      },
      event_count: 999,
    },
  });

  const normalizedAnalysis = kasekiCli.getAnalysis('kaseki-26');
  assertEqual(normalizedAnalysis.model, 'openrouter/claude-3.7-sonnet', 'Should prefer selected_model over legacy model fields');
  assertEqual(normalizedAnalysis.piMetrics.eventCount, 13, 'Should sum event_counts values when present');
}

function testCliNumericOptionValidation() {
  console.log('\n→ Testing CLI numeric option validation');

  const cases = [
    { commandArgs: ['logs', 'kaseki-1', '--tail='], option: '--tail', expectedRaw: 'empty value' },
    { commandArgs: ['logs', 'kaseki-1', '--tail=abc'], option: '--tail', expectedRaw: '"abc"' },
    { commandArgs: ['progress', 'kaseki-1', '--tail=0'], option: '--tail', expectedRaw: '0' },
    { commandArgs: ['watch', 'kaseki-1', '--interval=-3'], option: '--interval', expectedRaw: '-3' },
  ];

  for (const testCase of cases) {
    const result = spawnSync('node', ['kaseki-cli.js', ...testCase.commandArgs], {
      cwd: __dirname,
      encoding: 'utf8',
    });

    assert(result.status !== 0, `${testCase.commandArgs.join(' ')} should exit non-zero`);
    assert(
      result.stderr.includes(`Invalid value for ${testCase.option}`),
      `${testCase.commandArgs.join(' ')} should report invalid option`
    );
    assert(
      result.stderr.includes(testCase.expectedRaw),
      `${testCase.commandArgs.join(' ')} should include rejected raw value`
    );
  }
}

function createMockFollowFs(logPath, initialFile) {
  let nextFd = 10;
  const filesByPath = new Map([[logPath, { ...initialFile }]]);
  const fds = new Map();

  function getStats(file) {
    return {
      size: Buffer.byteLength(file.content),
      ino: file.ino,
      mtimeMs: file.mtimeMs,
    };
  }

  return {
    statSync(targetPath) {
      const file = filesByPath.get(targetPath);
      if (!file) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return getStats(file);
    },
    openSync(targetPath) {
      const file = filesByPath.get(targetPath);
      if (!file) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      const fd = nextFd++;
      fds.set(fd, {
        path: targetPath,
        ino: file.ino,
        mtimeMs: file.mtimeMs,
      });
      return fd;
    },
    fstatSync(fd) {
      const opened = fds.get(fd);
      if (!opened) {
        const err = new Error('EBADF');
        err.code = 'EBADF';
        throw err;
      }

      const file = filesByPath.get(opened.path);
      if (!file) {
        const err = new Error('ESTALE');
        err.code = 'ESTALE';
        throw err;
      }

      if (file.ino === opened.ino) {
        return getStats(file);
      }

      return {
        size: 0,
        ino: opened.ino,
        mtimeMs: opened.mtimeMs,
      };
    },
    closeSync(fd) {
      fds.delete(fd);
    },
    createReadStream(_targetPath, options) {
      const opened = fds.get(options.fd);
      const file = opened ? filesByPath.get(opened.path) : null;
      const emitter = new EventEmitter();
      const text = file ? file.content.slice(options.start, options.end + 1) : '';

      const originalOn = emitter.on.bind(emitter);
      const originalOn = emitter.on.bind(emitter);
      let endHandler = null;
      emitter.on = (event, handler) => {
        originalOn(event, handler);
        if (event === 'end') {
          endHandler = handler;
          setImmediate(() => {
            if (text.length > 0) {
              emitter.emit('data', text);
            }
            emitter.emit('end');
          });
        }
        return emitter;
      };
      return emitter;
    },
    setFile(targetPath, nextFile) {
      filesByPath.set(targetPath, { ...nextFile });
    },
  };
}

function testFollowPollerHandlesTruncateAndRotate() {
  console.log('\n→ Testing follow poller truncate/rotate resilience');

  const logPath = '/tmp/mock-follow.log';
  const mockFs = createMockFollowFs(logPath, {
    content: 'line-1\nline-2\n',
    ino: 1001,
    mtimeMs: 1,
  });

  const infos = [];
  const chunks = [];
  const errors = [];

  const poller = createFollowPoller(mockFs, logPath, {
    onInfo: (message) => infos.push(message),
    onData: (chunk) => chunks.push(chunk),
    onError: (err) => errors.push(err.message),
  });

  poller.poll();
  assertEqual(chunks.join(''), 'line-1\nline-2\n', 'Should read initial content');

  mockFs.setFile(logPath, {
    content: 'new\n',
    ino: 1001,
    mtimeMs: 2,
  });
  poller.poll();

  assert(
    infos.some((message) => message.includes('truncated')),
    'Should emit info message when file truncates while following'
  );
  assert(chunks.join('').includes('new\n'), 'Should read data after truncation reset');

  mockFs.setFile(logPath, {
    content: 'rotated\n',
    ino: 2002,
    mtimeMs: 3,
  });
  poller.poll();
  poller.poll();

  assert(
    infos.some((message) => message.includes('replaced/rotated')),
    'Should emit info message when inode changes due to rotation'
  );
  assert(chunks.join('').includes('rotated\n'), 'Should read appended data from rotated file');
  assertEqual(errors.length, 0, 'Should not emit follow read errors');

  poller.close();
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
testReadProgressEvents();
testGetCurrentStage();
testGetConfiguredTimeout();
testCalculateTimeoutRiskPercent();
testGetInstanceStatus();
testDetectErrors();
testDetectAnomalies();
testParseValidationTimings();
testGetAnalysis();
testCliNumericOptionValidation();
testFollowPollerHandlesTruncateAndRotate();

// Summary
console.log('\n================================================================================');
console.log(`Test Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('================================================================================\n');

// Cleanup
execSync(`rm -rf "${TEST_DIR}"`);

process.exit(testsFailed > 0 ? 1 : 0);
