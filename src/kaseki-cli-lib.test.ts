import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import childProcess from 'child_process';
import * as kasekiCli from './kaseki-cli-lib';

describe('kaseki-cli-lib', () => {
  const TEST_DIR = path.join(__dirname, '..', '..', 'tmp-kaseki-cli-test');
  const MOCK_RESULTS_DIR = path.join(TEST_DIR, 'agents', 'kaseki-results');

  beforeEach(() => {
    // Remove previous test data
    if (fs.existsSync(TEST_DIR)) {
      execSync(`rm -rf "${TEST_DIR}"`);
    }
    // Create directory structure
    fs.mkdirSync(MOCK_RESULTS_DIR, { recursive: true });
    // Override config for testing
    kasekiCli.config.KASEKI_RESULTS_DIR = MOCK_RESULTS_DIR;
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      execSync(`rm -rf "${TEST_DIR}"`);
    }
  });

  function createMockInstance(
    name: string,
    overrides: {
      hostStart?: Record<string, any>;
      metadata?: Record<string, any>;
      hasErrors?: boolean;
      hasQualityIssues?: boolean;
      hasSecrets?: boolean;
      validationTimings?: string;
      stageTimings?: string;
      piSummary?: Record<string, any>;
      changedFiles?: string;
    } = {}
  ): void {
    const instanceDir = path.join(MOCK_RESULTS_DIR, name);
    fs.mkdirSync(instanceDir, { recursive: true });

    // Mock host-start.json
    const hostStart = {
      instance: name,
      repo: 'CyanAutomation/crudmapper',
      ref: 'main',
      model: 'openrouter/claude-3.5-sonnet',
      agentTimeoutSeconds: 10800,
      ...(overrides.hostStart || {}),
    };
    fs.writeFileSync(
      path.join(instanceDir, 'host-start.json'),
      JSON.stringify(hostStart, null, 2)
    );

    // Mock metadata.json
    const metadata = {
      instance: name,
      start_time: new Date(Date.now() - 300000).toISOString(),
      duration_seconds: 300,
      exit_code: 0,
      pi_exit_code: 0,
      validation_exit_code: 0,
      quality_exit_code: 0,
      current_stage: 'completed',
      model: 'openrouter/claude-3.5-sonnet',
      ...(overrides.metadata || {}),
    };
    fs.writeFileSync(
      path.join(instanceDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

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

    // Mock progress.jsonl
    const progressEvents = [
      {
        timestamp: '2026-04-27T00:00:00Z',
        stage: 'clone repository',
        message: 'started',
      },
      {
        timestamp: '2026-04-27T00:00:01Z',
        stage: 'clone repository',
        message: 'finished with exit 0',
      },
      {
        timestamp: '2026-04-27T00:00:02Z',
        stage: 'pi agent',
        message: 'working; events=10, tool starts=1, tool ends=1',
      },
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
      ...(overrides.piSummary || {}),
    };
    fs.writeFileSync(
      path.join(instanceDir, 'pi-summary.json'),
      JSON.stringify(piSummary, null, 2)
    );

    // Mock changed-files.txt
    const changedFiles = overrides.changedFiles ?? `src/lib/parser.ts
tests/parser.test.ts
`;
    fs.writeFileSync(path.join(instanceDir, 'changed-files.txt'), changedFiles);
  }

  function createResultFixture(
    name: string,
    overrides: Parameters<typeof createMockInstance>[1] = {}
  ): { instanceDir: string; name: string } {
    createMockInstance(name, overrides);
    return { instanceDir: path.join(MOCK_RESULTS_DIR, name), name };
  }

  test('listInstances should find and sort instances', () => {
    createMockInstance('kaseki-1', {
      metadata: { current_stage: 'validation' },
    });
    createMockInstance('kaseki-2');

    const instances = kasekiCli.listInstances();

    expect(instances).toHaveLength(2);
    expect(instances[0].name).toBe('kaseki-2');
    expect(instances[1].name).toBe('kaseki-1');
    expect(instances[1].stage).toBe('validation');
  });

  test('listInstances should mark instances with no exit code as pending', () => {
    createMockInstance('kaseki-3', {
      metadata: { exit_code: null },
    });

    const instances = kasekiCli.listInstances();
    const pending = instances.find((inst) => inst.name === 'kaseki-3');

    expect(pending).toBeDefined();
    expect(pending?.status).toBe('pending');
  });

  test('getInstanceStatus should return status information', () => {
    createMockInstance('kaseki-1');

    const status = kasekiCli.getInstanceStatus('kaseki-1');

    expect(status.instance).toBe('kaseki-1');
    expect(status.status).toBe('completed');
    expect(status.running).toBe(false);
    expect(status.exitCode).toBe(0);
  });

  test('getInstanceStatus should return error for missing instance', () => {
    const status = kasekiCli.getInstanceStatus('nonexistent');

    expect(status).toEqual(
      expect.objectContaining({
        instance: 'nonexistent',
        status: 'pending',
        error: {
          kind: 'missing-instance',
          message: 'Instance nonexistent not found',
        },
      })
    );
    // User-observable API shape used by CLI JSON output.
    expect(status.running).toBe(false);
  });

  test('getInstanceStatus should keep typed status fields when metadata is malformed', () => {
    createMockInstance('kaseki-malformed');
    fs.writeFileSync(
      path.join(MOCK_RESULTS_DIR, 'kaseki-malformed', 'metadata.json'),
      '{ malformed-json'
    );

    const status = kasekiCli.getInstanceStatus('kaseki-malformed');

    expect(status).toEqual(
      expect.objectContaining({
        instance: 'kaseki-malformed',
        status: 'completed',
        running: false,
        stage: 'Collecting artifacts',
        exitCode: 0,
      })
    );
    expect(status.error).toBeUndefined();
  });
  test.each([
    { artifact: 'nonexistent.log', expected: null as string | null, description: 'missing file' },
    { artifact: 'stdout.log', expected: expect.stringContaining('Cloning repository'), description: 'existing file' },
  ])('readArtifact should handle $description', ({ artifact, expected }) => {
    createResultFixture('kaseki-1');
    const content = kasekiCli.readArtifact('kaseki-1', artifact);
    expect(content).toEqual(expected);
  });

  test('readArtifact should return null for unreadable artifact', () => {
    createMockInstance('kaseki-1');
    const artifactPath = path.join(MOCK_RESULTS_DIR, 'kaseki-1', 'stdout.log');
    const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((filePath: fs.PathOrFileDescriptor, options?: any) => {
      if (String(filePath) === artifactPath) {
        const error = new Error('permission denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      }
      return (jest.requireActual('fs').readFileSync as any)(filePath, options);
    });

    const content = kasekiCli.readArtifact('kaseki-1', 'stdout.log');

    expect(content).toBeNull();
    readSpy.mockRestore();
  });

  test('readProgressEvents should parse progress JSONL', () => {
    createMockInstance('kaseki-1');

    const events = kasekiCli.readProgressEvents('kaseki-1', 50);

    expect(events).toBeDefined();
    expect(events).toHaveLength(3);
    expect(events?.[0]?.stage).toBe('clone repository');
  });

  test('detectErrors should find error patterns in stderr', () => {
    createMockInstance('kaseki-1', {
      hasErrors: true,
    });

    const errors = kasekiCli.detectErrors('kaseki-1');

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].source).toBe('stderr');
  });

  test('detectErrors should surface validation failed command metadata', () => {
    createMockInstance('kaseki-1', {
      metadata: {
        exit_code: 1,
        validation_exit_code: 1,
        validation_failed_command: 'first failing command was "npm run check" with exit 1',
      },
    });

    const errors = kasekiCli.detectErrors('kaseki-1');
    const analysis = kasekiCli.getAnalysis('kaseki-1');

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          source: 'validation',
          line: 0,
          message: 'Validation failed: first failing command was "npm run check" with exit 1',
        }),
      ])
    );
    expect(analysis.validation_failed_command).toBe(
      'first failing command was "npm run check" with exit 1'
    );
  });

  test('listInstances and getInstanceStatus should derive running state from representative docker output', () => {
    createMockInstance('kaseki-1', {
      metadata: { exit_code: null },
    });
    createMockInstance('kaseki-2');
    createMockInstance('kaseki-10', {
      metadata: { exit_code: null },
    });
    const dockerOutput = `
other-container
kaseki-1

kaseki-2
kaseki-10-suffix
`;
    const execSpy = jest
      .spyOn(childProcess, 'execSync')
      .mockImplementation((command: string) => {
        expect(command).toBe('docker ps --format "{{.Names}}" 2>/dev/null || true');
        return dockerOutput;
      });

    try {
      const instances = kasekiCli.listInstances();
      const status = kasekiCli.getInstanceStatus('kaseki-10');

      expect(instances.map((instance) => instance.name)).toEqual([
        'kaseki-10',
        'kaseki-2',
        'kaseki-1',
      ]);
      expect(instances.find((instance) => instance.name === 'kaseki-1')).toEqual(
        expect.objectContaining({ running: true, status: 'running' })
      );
      expect(instances.find((instance) => instance.name === 'kaseki-2')).toEqual(
        expect.objectContaining({ running: true, status: 'running' })
      );
      expect(instances.find((instance) => instance.name === 'kaseki-10')).toEqual(
        expect.objectContaining({ running: false, status: 'pending' })
      );
      expect(status).toEqual(
        expect.objectContaining({
          instance: 'kaseki-10',
          running: false,
          status: 'pending',
        })
      );
      expect(instances.some((instance) => instance.name === 'other-container')).toBe(false);
    } finally {
      execSpy.mockRestore();
    }
  });

  test('isExactContainerNameMatch should not match partial names', () => {
    expect(kasekiCli.isExactContainerNameMatch('kaseki-1', 'kaseki-1')).toBe(
      true
    );
    expect(kasekiCli.isExactContainerNameMatch('kaseki-10', 'kaseki-1')).toBe(
      false
    );
    expect(
      kasekiCli.isExactContainerNameMatch('kaseki-1-suffix', 'kaseki-1')
    ).toBe(false);
  });

  test('deriveInstanceLifecycleStatus should determine status correctly', () => {
    expect(
      kasekiCli.deriveInstanceLifecycleStatus(true, null)
    ).toBe('running');
    expect(
      kasekiCli.deriveInstanceLifecycleStatus(false, 0)
    ).toBe('completed');
    expect(
      kasekiCli.deriveInstanceLifecycleStatus(false, 1)
    ).toBe('failed');
    expect(
      kasekiCli.deriveInstanceLifecycleStatus(false, null)
    ).toBe('pending');
  });

  test('normalizeExitCodeCandidate should handle various formats', () => {
    expect(kasekiCli.normalizeExitCodeCandidate(0)).toBe(0);
    expect(kasekiCli.normalizeExitCodeCandidate('0')).toBe(0);
    expect(kasekiCli.normalizeExitCodeCandidate('1')).toBe(1);
    expect(kasekiCli.normalizeExitCodeCandidate(null)).toBeNull();
    expect(kasekiCli.normalizeExitCodeCandidate('invalid')).toBeNull();
  });

  test('getAnalysis should return comprehensive analysis', () => {
    createMockInstance('kaseki-1');

    const analysis = kasekiCli.getAnalysis('kaseki-1');

    expect(analysis.instance).toBe('kaseki-1');
    expect(analysis.status).toBe('passed');
    expect(analysis.exit_code).toBe(0);
    expect(analysis.changed_files_count).toBeGreaterThan(0);
  });

  test('getAnalysis should return structured error for missing instance', () => {
    const analysis = kasekiCli.getAnalysis('kaseki-missing');

    expect(analysis).toEqual(
      expect.objectContaining({
        instance: 'kaseki-missing',
        status: 'failed',
        error: {
          kind: 'missing-instance',
          message: 'Instance kaseki-missing not found',
        },
      })
    );
  });

  test('classifyFailure should identify empty diff outcomes', () => {
    expect(
      kasekiCli.classifyFailureLocal({ failed_command: 'empty git diff' }, 3)
    ).toBe('empty-diff');
  });

  test('detectErrors should explain empty diff exit code', () => {
    createMockInstance('kaseki-4', {
      metadata: {
        exit_code: 3,
        failed_command: 'empty git diff',
        diff_nonempty: false,
      },
      changedFiles: '',
    });

    const errors = kasekiCli.detectErrors('kaseki-4');

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          source: 'empty-diff',
        }),
      ])
    );

    const analysis = kasekiCli.getAnalysis('kaseki-4');
    expect(analysis.failure_class).toBe('empty-diff');
  });

  test('scanLogForErrors should extract errors from log files with pattern matching', () => {
    createMockInstance('kaseki-test-1', {
      hasErrors: true,
    });

    const errors = kasekiCli.scanLogForErrors(
      'kaseki-test-1',
      'stderr.log',
      /error|wrong/i,
      'test-source',
      'error'
    );

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].source).toBe('test-source');
    expect(errors[0].severity).toBe('error');
  });

  test('scanLogForErrors should respect exclude patterns', () => {
    createMockInstance('kaseki-test-2', {
      hasErrors: true,
    });

    // With exclusion pattern that matches our test error
    const errorsWithExclude = kasekiCli.scanLogForErrors(
      'kaseki-test-2',
      'stderr.log',
      /error|wrong/i,
      'test-source',
      'error',
      { excludePattern: /Error:/ }
    );

    // Should be empty because our test error "Error: something went wrong" matches the exclude pattern
    expect(errorsWithExclude.length).toBe(0);
  });

  test('scanLogForErrors should handle allNonEmptyLines option', () => {
    // Create instance with custom quality.log content using the mock helper
    const testDir = path.join(MOCK_RESULTS_DIR, 'kaseki-test-3');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'metadata.json'),
      JSON.stringify({ exit_code: 1, quality_exit_code: 1 })
    );
    fs.writeFileSync(
      path.join(testDir, 'quality.log'),
      'quality gate 1 failed\nquality gate 2 failed\n\n'
    );

    const errors = kasekiCli.scanLogForErrors(
      'kaseki-test-3',
      'quality.log',
      /.*/,
      'quality',
      'critical',
      { allNonEmptyLines: true }
    );

    expect(errors.length).toBe(2); // Should only count non-empty lines
    errors.forEach((e) => {
      expect(e.severity).toBe('critical');
      expect(e.source).toBe('quality');
    });
  });

  test('scanLogForErrors should respect exitCodeCondition', () => {
    createMockInstance('kaseki-test-4', {
      metadata: {
        exit_code: 0,
      },
    });

    // Condition is false, so should return empty
    const errors = kasekiCli.scanLogForErrors(
      'kaseki-test-4',
      'stderr.log',
      /.*/,
      'test',
      'error',
      { exitCodeCondition: false }
    );

    expect(errors.length).toBe(0); // Should not scan when condition is false
  });

  test('ERROR_PATTERNS should be centralized and accessible', () => {
    expect(kasekiCli.ERROR_PATTERNS).toBeDefined();
    expect(kasekiCli.ERROR_PATTERNS.stderr).toBeDefined();
    expect(kasekiCli.ERROR_PATTERNS.validation).toBeDefined();
    expect(kasekiCli.ERROR_PATTERNS.stderrExclude).toBeDefined();

    // Test that patterns are RegExp objects
    expect(kasekiCli.ERROR_PATTERNS.stderr instanceof RegExp).toBe(true);
    expect(kasekiCli.ERROR_PATTERNS.validation instanceof RegExp).toBe(true);
  });
});
