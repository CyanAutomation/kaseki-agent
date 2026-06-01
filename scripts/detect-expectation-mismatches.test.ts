import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const scriptPath = path.join(__dirname, 'detect-expectation-mismatches.js');

describe('detect-expectation-mismatches', () => {
  let tempDir: string;
  let repoDir: string;
  let resultsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-expectation-mismatch-'));
    repoDir = path.join(tempDir, 'repo');
    resultsDir = path.join(tempDir, 'results');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.mkdirSync(resultsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runDetector(): { warnings: unknown[]; progress: string } {
    const outputPath = path.join(resultsDir, 'expectation-mismatch-warnings.jsonl');
    const progressPath = path.join(resultsDir, 'progress.log');

    execFileSync('node', [
      scriptPath,
      '--repo', repoDir,
      '--diff', path.join(resultsDir, 'git.diff'),
      '--output', outputPath,
      '--progress', progressPath,
    ]);

    const warningsText = fs.readFileSync(outputPath, 'utf8').trim();
    return {
      warnings: warningsText ? warningsText.split('\n').map(line => JSON.parse(line)) : [],
      progress: fs.readFileSync(progressPath, 'utf8'),
    };
  }

  it('warns when a related test still expects the old production stage string', () => {
    fs.writeFileSync(
      path.join(resultsDir, 'git.diff'),
      `diff --git a/src/job-scheduler.ts b/src/job-scheduler.ts
index 1111111..2222222 100644
--- a/src/job-scheduler.ts
+++ b/src/job-scheduler.ts
@@ -10,7 +10,7 @@ export function stageName(): string {
-  return "clone repository info";
+  return "clone repository";
 }
`
    );
    fs.writeFileSync(
      path.join(repoDir, 'src', 'job-scheduler.test.ts'),
      `import { stageName } from './job-scheduler';

test('stage name', () => {
  expect(stageName()).toBe("clone repository info");
});
`
    );

    const { warnings, progress } = runDetector();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      type: 'expectation_mismatch_warning',
      category: 'stage_name',
      production_file: 'src/job-scheduler.ts',
      test_file: 'src/job-scheduler.test.ts',
      old_value: 'clone repository info',
      new_value: 'clone repository',
    });
    expect(progress).toContain('[expectation-mismatch]');
    expect(progress).toContain('1 warning(s)');
  });

  it('does not warn when the related test already uses the new value', () => {
    fs.writeFileSync(
      path.join(resultsDir, 'git.diff'),
      `diff --git a/src/job-scheduler.ts b/src/job-scheduler.ts
index 1111111..2222222 100644
--- a/src/job-scheduler.ts
+++ b/src/job-scheduler.ts
@@ -10,7 +10,7 @@ export function stageName(): string {
-  return "clone repository info";
+  return "clone repository";
 }
`
    );
    fs.writeFileSync(
      path.join(repoDir, 'src', 'job-scheduler.test.ts'),
      `test('stage name', () => {
  expect(stageName()).toBe("clone repository");
});
`
    );

    const { warnings, progress } = runDetector();

    expect(warnings).toHaveLength(0);
    expect(progress).toContain('no stale test expectations found');
  });
});
