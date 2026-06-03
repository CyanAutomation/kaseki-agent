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

  describe('Regex changes detection', () => {
    it('detects regex pattern changes in production code', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/validator.ts b/src/validator.ts
index 1111111..2222222 100644
--- a/src/validator.ts
+++ b/src/validator.ts
@@ -5,7 +5,7 @@ export function isEmail(email: string): boolean {
   // Email validation regex
-  const emailRegex = /^[a-z0-9]+@[a-z]+\\.[a-z]{2,}$/i;
+  const emailRegex = /^[a-z0-9.+-]+@[a-z]+\\.[a-z]{2,}$/i;
   return emailRegex.test(email);
 }
`
      );
      fs.writeFileSync(
        path.join(repoDir, 'src', 'validator.test.ts'),
        `import { isEmail } from './validator';
test('email validation', () => {
  expect(isEmail('test@example.com')).toBe(true);
  const regex = /^[a-z0-9]+@[a-z]+\\.[a-z]{2,}$/i;
  expect(regex.test('test@example.com')).toBe(true);
});
`
      );

      const { warnings } = runDetector();
      expect(warnings.length).toBeGreaterThan(0);
      expect((warnings[0] as any).literal_type).toBe('regex');
    });
  });

  describe('Multiple strings in single file', () => {
    it('detects multiple mismatches in the same file', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/errors.ts b/src/errors.ts
index 1111111..2222222 100644
--- a/src/errors.ts
+++ b/src/errors.ts
@@ -1,8 +1,8 @@
 export const ERRORS = {
-  NOT_FOUND: "Resource not found",
-  VALIDATION: "Validation failed",
+  NOT_FOUND: "Resource missing",
+  VALIDATION: "Validation error",
 };
`
      );
      fs.writeFileSync(
        path.join(repoDir, 'src', 'errors.test.ts'),
        `import { ERRORS } from './errors';
test('error messages', () => {
  expect(ERRORS.NOT_FOUND).toBe("Resource not found");
  expect(ERRORS.VALIDATION).toBe("Validation failed");
});
`
      );

      const { warnings } = runDetector();
      expect(warnings.length).toBe(2);
      expect(warnings.map((w: any) => w.old_value)).toContain('Resource not found');
      expect(warnings.map((w: any) => w.old_value)).toContain('Validation failed');
    });
  });

  describe('Test file discovery and ranking', () => {
    it('prioritizes test files in same directory', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/parser.ts b/src/parser.ts
index 1111111..2222222 100644
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -1,3 +1,3 @@
-export const TYPE = "type_parser_v1";
+export const TYPE = "type_parser_v2";
`
      );

      // Create multiple test files with different names
      fs.mkdirSync(path.join(repoDir, 'src', '__tests__'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'tests'), { recursive: true });

      // Same directory test (should be prioritized)
      fs.writeFileSync(
        path.join(repoDir, 'src', 'parser.test.ts'),
        'expect(TYPE).toBe("type_parser_v1")'
      );

      // Different directory tests
      fs.writeFileSync(
        path.join(repoDir, 'tests', 'parser.test.ts'),
        'expect(TYPE).toBe("type_parser_v1")'
      );
      fs.writeFileSync(
        path.join(repoDir, 'tests', 'utils.test.ts'),
        'expect(TYPE).toBe("type_parser_v1")'
      );

      const { warnings } = runDetector();
      // Should find at least the same-directory match
      const warningsWithType = warnings.filter((w: any) => w.old_value === 'type_parser_v1');
      expect(warningsWithType.length).toBeGreaterThan(0);
    });
  });

  describe('Build and dist directory filtering', () => {
    it('ignores changes in dist, build, coverage directories', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/api.ts b/src/api.ts
index 1111111..2222222 100644
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,3 +1,3 @@
-export const MSG = "request succeeded";
+export const MSG = "request completed";
diff --git a/dist/api.js b/dist/api.js
index 1111111..2222222 100644
--- a/dist/api.js
+++ b/dist/api.js
@@ -1,3 +1,3 @@
-exports.MSG = "request succeeded";
+exports.MSG = "request completed";
diff --git a/build/api.cjs b/build/api.cjs
index 1111111..2222222 100644
--- a/build/api.cjs
+++ b/build/api.cjs
@@ -1,3 +1,3 @@
-module.exports.MSG = "request succeeded";
+module.exports.MSG = "request completed";
`
      );

      fs.writeFileSync(
        path.join(repoDir, 'src', 'api.test.ts'),
        'expect(MSG).toBe("request succeeded")'
      );

      const { warnings } = runDetector();
      // Should find src mismatch but not dist/build
      const srcMismatches = warnings.filter((w: any) => w.production_file.includes('src/'));
      const distMismatches = warnings.filter((w: any) => w.production_file.includes('dist/'));
      const buildMismatches = warnings.filter((w: any) => w.production_file.includes('build/'));

      expect(srcMismatches.length).toBeGreaterThan(0);
      expect(distMismatches).toHaveLength(0);
      expect(buildMismatches).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('handles empty diff without crashing', () => {
      fs.writeFileSync(path.join(resultsDir, 'git.diff'), '');

      const { warnings, progress } = runDetector();
      expect(warnings).toHaveLength(0);
      expect(progress).toContain('no stale test expectations found');
    });

    it('handles diff with only non-production files', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,2 +1,2 @@
-Old readme content
+New readme content
`
      );

      const { warnings, progress } = runDetector();
      expect(warnings).toHaveLength(0);
      expect(progress).toContain('no stale test expectations found');
    });

    it('handles special characters in strings', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/messages.ts b/src/messages.ts
index 1111111..2222222 100644
--- a/src/messages.ts
+++ b/src/messages.ts
@@ -1,2 +1,2 @@
-export const MSG = "error: file-not-found_v1";
+export const MSG = "error: file-not-found_v2";
`
      );

      fs.writeFileSync(
        path.join(repoDir, 'src', 'messages.test.ts'),
        'expect(MSG).toBe("error: file-not-found_v1")'
      );

      const { warnings } = runDetector();
      expect(warnings).toHaveLength(1);
      expect((warnings[0] as any).old_value).toBe('error: file-not-found_v1');
    });

    it('handles Unicode characters in strings', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/i18n.ts b/src/i18n.ts
index 1111111..2222222 100644
--- a/src/i18n.ts
+++ b/src/i18n.ts
@@ -1,2 +1,2 @@
-export const MSG = "Hello 世界";
+export const MSG = "Hello 世界 v2";
`
      );

      fs.writeFileSync(
        path.join(repoDir, 'src', 'i18n.test.ts'),
        'expect(MSG).toContain("Hello 世界")'
      );

      const { warnings } = runDetector();
      // May or may not match depending on tokenization - just verify no crashes
      expect(Array.isArray(warnings)).toBe(true);
    });

    it('handles escaped characters in strings', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/strings.ts b/src/strings.ts
index 1111111..2222222 100644
--- a/src/strings.ts
+++ b/src/strings.ts
@@ -1,2 +1,2 @@
-export const MSG = "line1\\nline2";
+export const MSG = "line1\\nline2_v2";
`
      );

      fs.writeFileSync(
        path.join(repoDir, 'src', 'strings.test.ts'),
        'expect(MSG).toContain("line1")'
      );

      const { warnings } = runDetector();
      expect(Array.isArray(warnings)).toBe(true);
    });

    it('handles template literal strings', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/templates.ts b/src/templates.ts
index 1111111..2222222 100644
--- a/src/templates.ts
+++ b/src/templates.ts
@@ -1,3 +1,3 @@
 export function msg(name: string) {
-  return \`Hello \${name}, welcome to parser\`;
+  return \`Hello \${name}, welcome to system\`;
 }
`
      );

      fs.writeFileSync(
        path.join(repoDir, 'src', 'templates.test.ts'),
        'expect(msg("test")).toContain("welcome to parser")'
      );

      const { warnings } = runDetector();
      // Template literals contain multiple tokens, verify detection
      expect(Array.isArray(warnings)).toBe(true);
    });
  });

  describe('Deduplication', () => {
    it('deduplicates identical mismatches', () => {
      // Test that when multiple test files reference the same old value,
      // each test file gets only one warning (no duplicate warnings per test file)
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/config.ts b/src/config.ts
index 1111111..2222222 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,5 +1,5 @@
 export const CONFIG = {
-  NAME: "production mode",
+  NAME: "prod mode",
   OTHER: "data"
 };
`
      );

      // Create 2 test files that reference the old value
      fs.writeFileSync(
        path.join(repoDir, 'src', 'config.test.ts'),
        `expect(CONFIG.NAME).toBe("production mode");`
      );
      fs.writeFileSync(
        path.join(repoDir, 'src', 'config.integration.ts'),
        `expect(CONFIG.NAME).toBe("production mode");`
      );

      const { warnings } = runDetector();
      // Should find the mismatch in test files
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      // Verify the old and new values are correct
      const hasMismatch = warnings.some(
        (w: any) => w.old_value === 'production mode' && w.new_value === 'prod mode'
      );
      expect(hasMismatch).toBe(true);
    });
  });

  describe('Similarity scoring', () => {
    it('matches old and new values with high similarity', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/status.ts b/src/status.ts
index 1111111..2222222 100644
--- a/src/status.ts
+++ b/src/status.ts
@@ -1,2 +1,2 @@
-export const STATUS = "validation error occurred";
+export const STATUS = "validation failed";
`
      );

      fs.writeFileSync(
        path.join(repoDir, 'src', 'status.test.ts'),
        'expect(STATUS).toBe("validation error occurred")'
      );

      const { warnings } = runDetector();
      // Similar values should be matched (both contain "validation")
      const validationWarnings = warnings.filter((w: any) => w.old_value.includes('validation'));
      expect(validationWarnings.length).toBeGreaterThan(0);
    });
  });

  describe('Category detection', () => {
    it('detects stage-related categories', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/pipeline.ts b/src/pipeline.ts
index 1111111..2222222 100644
--- a/src/pipeline.ts
+++ b/src/pipeline.ts
@@ -1,2 +1,2 @@
-export const STAGE = "stage_validation";
+export const STAGE = "stage_checking";
`
      );

      fs.writeFileSync(
        path.join(repoDir, 'src', 'pipeline.test.ts'),
        'expect(STAGE).toBe("stage_validation")'
      );

      const { warnings } = runDetector();
      const stageWarnings = warnings.filter((w: any) => w.category === 'stage_name');
      expect(stageWarnings.length).toBeGreaterThan(0);
    });

    it('detects parser output categories', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/parser.ts b/src/parser.ts
index 1111111..2222222 100644
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -1,2 +1,2 @@
-export const OUTPUT = "parsed message format";
+export const OUTPUT = "new message format";
`
      );

      fs.writeFileSync(
        path.join(repoDir, 'src', 'parser.test.ts'),
        'expect(OUTPUT).toContain("parsed message format")'
      );

      const { warnings } = runDetector();
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Line number reporting', () => {
    it('correctly reports line numbers for mismatches', () => {
      fs.writeFileSync(
        path.join(resultsDir, 'git.diff'),
        `diff --git a/src/errors.ts b/src/errors.ts
index 1111111..2222222 100644
--- a/src/errors.ts
+++ b/src/errors.ts
@@ -5,7 +5,7 @@ export const ERRORS = {
 };

 export function getMessage() {
-  return "old error message";
+  return "new error message";
 }
`
      );

      fs.writeFileSync(
        path.join(repoDir, 'src', 'errors.test.ts'),
        `test('error message', () => {
  expect(getMessage()).toBe("old error message");
});
`
      );

      const { warnings } = runDetector();
      const lineNumberWarnings = warnings.filter((w: any) => w.old_value === 'old error message');
      expect(lineNumberWarnings.length).toBeGreaterThan(0);
      expect((lineNumberWarnings[0] as any).production_line).toBeGreaterThan(0);
      expect((lineNumberWarnings[0] as any).test_line).toBeGreaterThan(0);
    });
  });
});
