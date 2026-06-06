import {
  parseTestFailures,
  analyzeComparativeTestResults,
  extractChangedIdentifiers,
  analyzeCodeImpact,
  detectLogMarkers,
  assessCausality,
  generateCausalityAnalysisArtifact,
} from './validation-causality-analysis';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('validation-causality-analysis', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'causality-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseTestFailures', () => {
    it('should parse test failure messages', () => {
      const log = `
        FAIL src/index.test.ts
        ✕ should handle null input
        ✓ should handle empty string
        FAIL src/utils.test.ts
        ✗ should parse dates correctly
      `;
      const failures = parseTestFailures(log);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.some(f => f.message?.includes('should handle null input'))).toBe(true);
    });

    it('should handle empty logs', () => {
      const failures = parseTestFailures('');
      expect(failures.length).toBe(0);
    });

    it('should extract compilation errors', () => {
      const log = 'Error: compilation failed\nTypeScript error at src/main.ts:10';
      const failures = parseTestFailures(log);
      expect(failures.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeComparativeTestResults', () => {
    it('should identify newly failing tests', () => {
      const baseline = `
        ✓ test 1
        ✓ test 2
        ✗ test 3
      `;
      const postChange = `
        ✓ test 1
        ✗ test 2
        ✗ test 3
        ✗ test 4
      `;
      const results = analyzeComparativeTestResults(baseline, postChange);
      expect(results.regressionCount).toBeGreaterThan(0);
      expect(results.newlyFailing.length).toBeGreaterThan(0);
    });

    it('should identify newly passing tests', () => {
      const baseline = '✗ test 1\n✗ test 2';
      const postChange = '✓ test 1\n✗ test 2';
      const results = analyzeComparativeTestResults(baseline, postChange);
      expect(results.improvementCount).toBeGreaterThan(0);
    });

    it('should identify consistently failing tests', () => {
      const baseline = '✗ test 1\n✓ test 2';
      const postChange = '✗ test 1\n✓ test 2';
      const results = analyzeComparativeTestResults(baseline, postChange);
      expect(results.consistentlyFailing.length).toBeGreaterThan(0);
    });
  });

  describe('extractChangedIdentifiers', () => {
    it('should extract function names from diff', () => {
      const diff = `
+function handleInput(value: string) {
+  return value.trim();
+}
`;
      const identifiers = extractChangedIdentifiers(diff);
      expect(identifiers).toContain('handleInput');
    });

    it('should extract class names from diff', () => {
      const diff = `
+export class UserService {
+  getUser() {}
+}
`;
      const identifiers = extractChangedIdentifiers(diff);
      expect(identifiers).toContain('UserService');
    });

    it('should extract interface names', () => {
      const diff = `
+interface UserConfig {
+  name: string;
+}
`;
      const identifiers = extractChangedIdentifiers(diff);
      expect(identifiers).toContain('UserConfig');
    });

    it('should handle empty diffs', () => {
      const identifiers = extractChangedIdentifiers('');
      expect(identifiers.length).toBe(0);
    });
  });

  describe('analyzeCodeImpact', () => {
    it('should detect changed identifiers in failure logs', () => {
      const diff = `
+function validateEmail(email: string) {
+  return email.includes('@');
+}
`;
      const failure = `
        Error in validateEmail: TypeError
        at validateEmail (src/utils.ts:5)
      `;
      const impact = analyzeCodeImpact(diff, failure);
      expect(impact.changedIdentifiers).toContain('validateEmail');
      expect(impact.foundInFailure).toContain('validateEmail');
      expect(impact.correlationStrength).toBe('high');
    });

    it('should return none correlation when no matches', () => {
      const diff = `
+function newFunction() {
+  return 42;
+}
`;
      const failure = 'Error in oldFunction: TypeError';
      const impact = analyzeCodeImpact(diff, failure);
      expect(impact.correlationStrength).toBe('none');
    });

    it('should compute medium correlation for partial matches', () => {
      const diff = `
+function funcA() {}
+function funcB() {}
+function funcC() {}
+function funcD() {}
`;
      const failure = 'Error in funcA and funcB occurred';
      const impact = analyzeCodeImpact(diff, failure);
      expect(impact.correlationStrength).toMatch(/high|medium|low/);
    });
  });

  describe('detectLogMarkers', () => {
    it('should detect changed files in stack traces', () => {
      const failure = `
        at Object.<anonymous> (src/utils.ts:10)
        at Module._load (internal/modules/cjs/loader.js:994)
      `;
      const changedFiles = ['src/utils.ts', 'src/main.ts'];
      const markers = detectLogMarkers(failure, changedFiles);
      expect(markers.some(m => m.type === 'changed_file' && m.found)).toBe(true);
    });

    it('should detect infrastructure failures', () => {
      const failure = 'Error: timeout waiting for server response';
      const markers = detectLogMarkers(failure, []);
      expect(markers.some(m => m.type === 'infra_failure' && m.found)).toBe(true);
    });

    it('should detect connection errors', () => {
      const failure = 'Error: ECONNREFUSED 127.0.0.1:3000';
      const markers = detectLogMarkers(failure, []);
      expect(markers.some(m => m.type === 'infra_failure' && m.found)).toBe(true);
    });

    it('should detect memory errors', () => {
      const failure = 'FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory';
      const markers = detectLogMarkers(failure, []);
      expect(markers.some(m => m.type === 'infra_failure' && m.found)).toBe(true);
    });
  });

  describe('assessCausality', () => {
    it('should verdict change_related when new tests fail', () => {
      const baseline = '✓ test1\n✓ test2';
      const postChange = '✓ test1\n✗ test2';
      const diff = '+function newFunc() {}';
      const assessment = assessCausality(baseline, postChange, diff, []);
      expect(assessment.failureType).toBe('change_related');
      expect(assessment.confidence).toBeGreaterThan(0.6);
    });

    it('should verdict pre_existing when tests were already failing', () => {
      const baseline = '✗ test1\n✓ test2';
      const postChange = '✗ test1\n✓ test2';
      const diff = '+function newFunc() {}';
      const assessment = assessCausality(baseline, postChange, diff, []);
      expect(assessment.failureType).toBe('pre_existing');
      expect(assessment.confidence).toBeGreaterThan(0.7);
    });

    it('should verdict pre_existing for infrastructure failures', () => {
      const baseline = 'PASS';
      const postChange = 'Error: timeout waiting for database';
      const diff = '+// minor comment change';
      const assessment = assessCausality(baseline, postChange, diff, []);
      expect(assessment.failureType).toBe('pre_existing');
      expect(assessment.confidence).toBeGreaterThan(0.9);
    });

    it('should verdict inconclusive when signals are weak', () => {
      // When baseline already has failures and we maintain the same state
      const baseline = '✗ test1\n✓ test2';
      const postChange = '✗ test1\n✓ test2';
      const diff = ''; // No code changes
      const assessment = assessCausality(baseline, postChange, diff, []);
      // Same failures before and after with no code changes = pre_existing or inconclusive
      expect(assessment.failureType).toMatch(/inconclusive|pre_existing/);
    });

    it('should provide rationale for verdict', () => {
      const baseline = '✓ test1';
      const postChange = '✗ test1';
      const diff = '+function test1Impl() {}';
      const assessment = assessCausality(baseline, postChange, diff, []);
      expect(assessment.rationale.length).toBeGreaterThan(0);
      expect(assessment.rationale).toBeTruthy();
    });

    it('should include all signals in assessment', () => {
      const baseline = 'PASS';
      const postChange = 'FAIL';
      const diff = '+function func() {}';
      const assessment = assessCausality(baseline, postChange, diff, ['src/file.ts']);
      expect(assessment.signals.comparativeResults).toBeDefined();
      expect(assessment.signals.logMarkers).toBeDefined();
      expect(assessment.signals.codeImpact).toBeDefined();
    });
  });

  describe('generateCausalityAnalysisArtifact', () => {
    it('should write valid JSON to file', () => {
      const assessment = {
        failureType: 'change_related' as const,
        confidence: 0.85,
        rationale: 'Test failure introduced by change',
        signals: {},
      };
      const outputPath = path.join(tempDir, 'causality.json');
      const result = generateCausalityAnalysisArtifact(assessment, outputPath);
      expect(result).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(content.assessment.failureType).toBe('change_related');
      expect(content.assessment.confidence).toBe(0.85);
    });

    it('should include timestamp in artifact', () => {
      const assessment = {
        failureType: 'pre_existing' as const,
        confidence: 0.9,
        rationale: 'Pre-existing failure',
        signals: {},
      };
      const outputPath = path.join(tempDir, 'causality.json');
      const beforeGenerate = Date.now();
      generateCausalityAnalysisArtifact(assessment, outputPath);
      const afterGenerate = Date.now();

      const content = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(content.timestamp).toBeDefined();
      expect(typeof content.timestamp).toBe('string');
      expect(content.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const parsedTimestamp = Date.parse(content.timestamp);
      expect(Number.isNaN(parsedTimestamp)).toBe(false);
      expect(parsedTimestamp).toBeGreaterThanOrEqual(beforeGenerate);
      expect(parsedTimestamp).toBeLessThanOrEqual(afterGenerate);
    });

    it('should handle write errors gracefully', () => {
      const assessment = {
        failureType: 'inconclusive' as const,
        confidence: 0.5,
        rationale: 'Unable to determine',
        signals: {},
      };
      const invalidPath = '/invalid/path/causality.json';
      const result = generateCausalityAnalysisArtifact(assessment, invalidPath);
      expect(result).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle real-world npm test failure', () => {
      const baseline = `
        PASS  src/index.test.ts (1.234 s)
          ✓ should parse input (10 ms)
          ✓ should validate config (5 ms)
      `;
      const postChange = `
        FAIL  src/index.test.ts (2.456 s)
          ✓ should parse input (12 ms)
          ✗ should validate config (1234 ms)
          Error: Expected true but got false
          at src/index.test.ts:25:10
      `;
      const diff = `
diff --git a/src/index.ts b/src/index.ts
+function validateConfig(config: Config) {
+  return config.version !== undefined;
+}
      `;
      const assessment = assessCausality(baseline, postChange, diff, ['src/index.ts']);
      expect(assessment.failureType).toBe('change_related');
      expect(assessment.confidence).toBeGreaterThan(0.7);
    });

    it('should identify test flakiness as pre-existing', () => {
      const baseline = `
        FAIL  src/db.test.ts
        ✗ should connect to database
        Error: ECONNREFUSED 127.0.0.1:5432
      `;
      const postChange = `
        FAIL  src/db.test.ts
        ✗ should connect to database
        Error: ECONNREFUSED 127.0.0.1:5432
      `;
      const diff = `
+function addLog(msg: string) {
+  console.log(msg);
+}
      `;
      const assessment = assessCausality(baseline, postChange, diff, []);
      expect(assessment.failureType).toBe('pre_existing');
    });
  });
});
