import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  analyzeTest,
  extractTestName,
  getAllTestFiles,
  scoreAssertionQuality,
  scoreBehavioralRelevance,
  scoreCostCoverage,
  scoreIntentClarity,
  scoreIsolationRobustness,
} from './score-tests';

describe('test quality scorer', () => {
  test('counts semantic shell assertions instead of requiring Jest syntax', () => {
    const shellTest = `
      assert_contains "api exposes the expected status" "$body" '"status":"ok"'
      if ! grep -Fq 'job-1' "$response"; then exit 1; fi
      [[ "$status" == "202" ]]
    `;

    expect(scoreAssertionQuality(shellTest, 'sh')).toBe(2);
    expect(scoreCostCoverage(shellTest, 'sh')).toBe(2);
    expect(scoreAssertionQuality('# expect(true).toBe(true)\necho "test file"', 'sh')).toBe(0);
    expect(scoreAssertionQuality('if [[ "$status" == 202 ]]; then exit 1; fi', 'sh')).toBe(1);
    expect(scoreAssertionQuality("assert.match(output, /OK/)\nassert.deepEqual(result, expected)", 'mjs')).toBe(2);
    expect(scoreAssertionQuality('assertContains(output, "ready")\nassertNotContains(output, "secret")', 'ts')).toBe(2);
    expect(scoreIntentClarity('test_preserves_job_status() { :; }', 'x.test.sh', 'sh')).toBe(2);
    expect(scoreIntentClarity('#!/usr/bin/env bash\n# Preserves the output error line after filtering\n[[ "$status" == 200 ]]', 'x.test.sh', 'sh')).toBe(2);
    expect(scoreIntentClarity('[[ "$status" == 200 ]]', 'write-run-metadata.test.sh', 'sh')).toBe(1);
    expect(scoreIntentClarity("test('returns the saved job after restart', async () => {})", 'x.test.mjs', 'mjs')).toBe(2);
    expect(scoreIntentClarity("test('workflow checks ignore unrelated values', () => {})", 'x.test.mjs', 'mjs')).toBe(2);
    expect(scoreIntentClarity("test('works', () => {})", 'x.test.mjs', 'mjs')).toBe(0);
    expect(scoreAssertionQuality('function assertContract() { if (actual !== expected) throw new Error("mismatch"); }', 'ts')).toBe(1);
  });

  test('gives useful unlinked behavior partial relevance and traceable specifications full relevance', () => {
    expect(scoreBehavioralRelevance("test('returns the public job status', () => expect(status).toBe('ok'))")).toBe(1);
    expect(scoreBehavioralRelevance('// Spec: SPEC-42\nexpect(actual).toEqual(expected)')).toBe(2);
    expect(scoreBehavioralRelevance('// Spec: docs/API.md#request-limits\nexpect(actual).toEqual(expected)')).toBe(2);
    expect(scoreBehavioralRelevance("// Caveman communication specification, CAVEMAN-COMMS-001:\ntest('avoids style self-announcement', () => expect(output).not.toContain('caveman mode'))", 'ts')).toBe(2);
    expect(scoreBehavioralRelevance('// Regression: GH#2789')).toBe(2);
  });

  test('does not award relevance to incidental implementation checks or generic spec variables', () => {
    expect(scoreBehavioralRelevance("test('checks a private helper exists', () => expect(typeof helper).toBe('function'))")).toBe(0);
    expect(scoreBehavioralRelevance('const spec = await parse(input);')).toBe(0);
    expect(scoreBehavioralRelevance('const specifier = buildSpecifier();')).toBe(0);
  });

  test('recognizes behavior-focused titles supplied through parameterized test APIs', () => {
    const parameterizedTest = `test.each([['missing', undefined], ['malformed', '{bad']])(
      'rejects %s metadata when no timing evidence is available', () => {}
    )`;

    expect(scoreIntentClarity(parameterizedTest, 'scorecard.test.ts', 'ts')).toBe(2);
    expect(extractTestName(parameterizedTest, 'ts', 'scorecard.test.ts')).toBe(
      'rejects %s metadata when no timing evidence is available',
    );
  });

  test('uses descriptive shell contract comments and recognizes bounded deadline polling', () => {
    const shellTest = `#!/usr/bin/env bash
      # shellcheck source=helpers/example.sh
      # Contract: the staged npm package includes required files and executable modes.
      [[ -f "$PACKAGE_DIR/package.json" ]]
      [[ -x "$PACKAGE_DIR/bin/kaseki-agent" ]]`;
    const boundedDeadlinePoll = `const started = Date.now();
      while (Date.now() - started < 1000) {
        try { await assertion(); return; }
        catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
      }`;

    expect(extractTestName(shellTest, 'sh', 'packaging-layout.test.sh')).toBe(
      'Contract: the staged npm package includes required files and executable modes.',
    );
    expect(scoreIntentClarity(shellTest, 'packaging-layout.test.sh', 'sh')).toBe(2);
    expect(scoreIsolationRobustness(boundedDeadlinePoll)).toBe(1);
  });

  test('distinguishes actual snapshot assertions from snapshot-related identifiers', () => {
    expect(scoreAssertionQuality('expect(snapshotEnv()).toEqual(expected)', 'ts')).toBe(2);
    expect(scoreAssertionQuality('expect(actual).toMatchSnapshot()', 'ts')).toBe(0);
    expect(scoreAssertionQuality('expect(actual).toMatchSnapshot(); expect(status).toBe(200)', 'ts')).toBe(1);
  });

  test('recognizes one exact equality assertion as a precise semantic contract check', () => {
    expect(scoreAssertionQuality(
      'expect(snapshot.summaries).toEqual([expect.objectContaining({ response_id: "response-1", input_tokens: 12 })])',
      'ts',
    )).toBe(2);
  });

  test('scores isolation from uncontrolled waits and un-restored global mutation', () => {
    const watchdog = `const timer = setTimeout(() => child.kill(), 30_000);
      timer.unref();
      try { await child.exit; } finally { clearTimeout(timer); }`;
    const controlledEnvironment = `process.env.KASEKI_MODE = 'test';
      afterEach(() => restoreEnv());`;
    const boundedPoll = `for ((attempt=0; attempt < attempts; attempt++)); do
      check_event && return 0
      sleep 0.01
    done`;

    expect(scoreIsolationRobustness(watchdog)).toBe(2);
    expect(scoreIsolationRobustness("await new Promise(resolve => setTimeout(resolve, 25))")).toBe(0);
    expect(scoreIsolationRobustness('process.env.KASEKI_MODE = "test"')).toBe(0);
    expect(scoreIsolationRobustness(controlledEnvironment)).toBe(2);
    expect(scoreIsolationRobustness(boundedPoll)).toBe(1);
    expect(scoreIsolationRobustness("jest.mock('./external-service')")).toBe(2);
    expect(scoreIsolationRobustness(Array(6).fill("jest.spyOn(service, 'call')").join('\n'))).toBe(1);
  });

  test('scores JavaScript and TypeScript cost coverage by size, speed, and assertions', () => {
    const fixture = (lineCount: number, overrides: Record<number, string>) =>
      Array.from({ length: lineCount }, (_, index) => overrides[index] ?? '// fixture').join('\n');
    const focusedTypeScript = fixture(20, {
      0: "it('keeps the contract', () => {",
      19: 'assert.equal(actual, expected); expect(status).toBe(200); expect(count).toBe(1);',
    });
    const slowJavaScript = fixture(20, {
      0: "it('keeps the contract', () => {",
      10: 'execSync(command);',
      19: 'expect(actual).toBe(expected);',
    });
    const highAssertionDensity = [
      'expect(first).toBe(1);',
      'expect(second).toBe(2);',
      'expect(third).toBe(3);',
    ].join('\n');
    const longTypeScript = fixture(101, {
      0: "it('keeps the contract', () => {",
      98: 'expect(first).toBe(1); expect(second).toBe(2); expect(third).toBe(3);',
      100: 'assert.equal(actual, expected);',
    });

    expect(scoreCostCoverage(focusedTypeScript, 'ts')).toBe(2);
    expect(scoreCostCoverage(slowJavaScript, 'js')).toBe(1);
    expect(scoreCostCoverage(highAssertionDensity, 'js')).toBe(2);
    expect(scoreCostCoverage(longTypeScript, 'ts')).toBe(2);
    expect(scoreCostCoverage("spawnSync('node', ['worker.js']); expect(result.status).toBe(0)", 'ts')).toBe(1);
    expect(scoreCostCoverage("execSync('docker build .'); expect(result.status).toBe(0)", 'ts')).toBe(1);
    const commandLikeTextOnly = `const fixture = "execSync('docker build .')";
      // spawnSync('npm ci');
      expect(first).toBe(1);
      expect(second).toBe(2);
      expect(third).toBe(3);`;
    expect(scoreCostCoverage(commandLikeTextOnly, 'ts')).toBe(2);
  });

  test('keeps every dimension integer-valued and derives the segment from the total', () => {
    const score = analyzeTest(
      'tests/public-status.test.ts',
      "test('returns the public status', () => expect(status).toBe('ok'))",
    );

    for (const dimension of [
      score.intentClarity,
      score.behavioralRelevance,
      score.assertionQuality,
      score.isolationRobustness,
      score.costCoverage,
      score.total,
    ]) {
      expect(Number.isInteger(dimension)).toBe(true);
    }
    expect(score.segment).toBe(score.total >= 8 ? 'Keep' : score.total >= 5 ? 'Refactor' : 'Remove');
    expect(score.file).toBe('tests/public-status.test.ts');
  });

  test('discovers tests in hidden source directories and skips generated or dependency trees', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'score-tests-inventory-'));
    try {
      const testFiles = [
        '.github/actions/check.test.mjs',
        'src/unit.test.ts',
        'tests/package.test.sh',
      ];
      for (const relativePath of testFiles) {
        const filePath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '');
      }
      for (const relativePath of [
        'node_modules/dependency/dependency.test.js',
        'dist/generated.test.js',
        '.git/objects/example.test.js',
        'src/not-a-test.ts',
      ]) {
        const filePath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '');
      }

      expect(getAllTestFiles(root).map((file) => path.relative(root, file))).toEqual(
        testFiles.sort(),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
