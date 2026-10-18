/**
 * Test Quality Scoring Script
 * 
 * Analyzes discovered test files and scores them on the following rubric (0-2 per dimension):
 * 1. Intent clarity — Test name + body state behavior (not implementation)
 * 2. Behavioral relevance — Maps to spec/issue with traceable ID
 * 3. Assertion quality — Precise, semantic assertions (not snapshots)
 * 4. Isolation & robustness — Deterministic, minimal mocking, no flakes
 * 5. Cost vs. coverage — Fast execution + meaningful mutation coverage
 * 
 * Outputs JSON report with one score per discovered test file and identifies the bottom 10 files.
 */

import fs from 'fs';
import path from 'path';

interface TestScore {
  id: string;
  file: string;
  testName: string;
  language: 'typescript' | 'javascript' | 'shell' | 'bash' | 'other';
  lineCount: number;
  intentClarity: number;
  behavioralRelevance: number;
  assertionQuality: number;
  isolationRobustness: number;
  costCoverage: number;
  total: number;
  segment: 'Keep' | 'Refactor' | 'Remove';
  summary: string;
  assertionTypes: string[];
  hasSnapshots: boolean;
  hasMocking: boolean;
  hasAsyncWaits: boolean;
  concerns: string[];
}

export function getAllTestFiles(rootDir: string): string[] {
  const testFiles: string[] = [];
  const ignoredDirectories = new Set([
    '.git',
    'node_modules',
    'dist',
    'coverage',
    '.next',
    '.turbo',
  ]);
  const testFilePattern = /(?:\.test\.(?:[cm]?[jt]sx?|sh|bash)|\.integration\.test\.(?:[cm]?[jt]sx?|sh|bash))$/i;
  
  function walk(dir: string) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !ignoredDirectories.has(file)) {
          walk(fullPath);
        } else if (stat.isFile() && testFilePattern.test(file)) {
          testFiles.push(fullPath);
        }
      }
    } catch (e) {
      // Skip inaccessible directories
    }
  }
  
  walk(rootDir);
  return testFiles.sort();
}

function readTestFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return '';
  }
}

function extractTestName(content: string, fileExt: string, filePath: string): string {
  // Extract main describe block or test name
  if (/^(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(fileExt)) {
    const describeMatch = content.match(/describe\(['"`](.*?)['"`]/);
    if (describeMatch) return describeMatch[1];
    const testMatch = content.match(/(?:it|test)\s*\(\s*['"`](.*?)['"`]/);
    if (testMatch) return testMatch[1];
  } else if (/^(?:sh|bash)$/i.test(fileExt)) {
    const testFunctionMatch = content.match(/^\s*(?:function\s+)?(test_[a-z0-9_]+)\s*\(\s*\)\s*\{/im);
    if (testFunctionMatch) return testFunctionMatch[1].replace(/_/g, ' ');
    const commentLine = content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('#') && !/^#!|^#\s*shellcheck\b/i.test(line));
    if (commentLine) return commentLine.replace(/^#\s*/, '').trim();
  }
  return path.basename(filePath).replace(/\.test\..*/, '');
}

export function scoreIntentClarity(content: string, fileName: string, fileExt: string): number {
  if (/^(?:sh|bash)$/i.test(fileExt)) {
    const testFunction = content.match(/^\s*(?:function\s+)?test_([a-z0-9_]+)\s*\(\s*\)\s*\{/im)?.[1];
    if (testFunction && !/^(?:test|helper|function|main)$/i.test(testFunction)) {
      return 2;
    }
    const descriptiveHeader = content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('#') && !/^#!|^#\s*shellcheck\b/i.test(line));
    const fileTitle = fileName
      .replace(/(?:\.integration)?\.test\.[^.]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    const descriptiveFileTitle = fileTitle.length >= 8
      && !/^(?:test|helper|function|works?|tests?)$/i.test(fileTitle);
    return descriptiveHeader && descriptiveHeader.length > 12
      || (descriptiveFileTitle && getAssertionCount(content, fileExt) > 0)
      ? 1
      : 0;
  }

  const testTitles = [...content.matchAll(/(?:it|test)\s*\(\s*['"`]([^'"`\n]{1,})['"`]/gi)]
    .map((match) => match[1].trim());
  const descriptiveTestTitle = testTitles.some(
    (title) => title.length >= 12 && !/^(?:test|helper|function|works?|todo)\b/i.test(title),
  );

  // Check if test name clearly states behavior
  const docBlock = content.match(/\/\*\*[\s\S]*?\*\//) ? true : false;
  const hasDescriptiveComment = content.match(/\/\/\s*(?:Should|Tests?|Validates?|Checks?|Ensures?)/i) ? true : false;
  
  // Check for "should" statements in test names (TypeScript)
  const shouldPattern = content.match(/(?:it|describe|test)\(['"`].*?(?:should|must|will|can|returns?|validates?|handles?|fails?|throws?)/i);
  const vacuousPattern = /(?:it|describe|test)\s*\(\s*['"`](?:test|helper|function|works?|tests?)\b/i.test(content);
  
  let score = 0;
  
  // Clear "should" pattern = 2
  if ((shouldPattern || descriptiveTestTitle) && !vacuousPattern) {
    score = 2;
  }
  // Descriptive comments or doc blocks = 1
  else if (docBlock || hasDescriptiveComment) {
    score = 1;
  }
  // No clear intent = 0
  else {
    score = 0;
  }
  
  return Math.min(2, score);
}

export function scoreBehavioralRelevance(content: string): number {
  // Award full relevance only for a traceable issue/spec reference.
  const hasTraceableReference = /(?:#\d+|(?:GH|PR|ISSUE|SPEC|REQ|PRD)[-# ]?\d+|github\.com\/[^\s]+\/(?:issues|pull)\/\d+)/i.test(content);
  
  // Check for meaningful comment blocks describing what the test validates
  const hasDetailedComment = content.match(/\/\*\*[\s\S]*?(?:Validates?|Ensures?|Tests?|Checks?)[\s\S]*?\*\//m) ? true : false;
  const hasInlineComment = content.match(/\/\/\s*(?:Validates?|Ensures?|Tests?|Checks?|Regression|Issue|Spec)/i) ? true : false;
  
  let score = 0;
  
  if (hasTraceableReference) {
    score = 2; // Directly traceable to a requirement
  } else if (hasDetailedComment || hasInlineComment || /\b(?:requirement|PRD|bugfix|regression)\b|\bSpec\s*:/i.test(content)) {
    score = 1; // Has documented intent
  } else {
    score = 0; // No clear intent or traceability
  }
  
  return Math.min(2, score);
}

function getShellAssertions(content: string): string[] {
  const executableLines = content
    .split('\n')
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return executableLines.filter((line) => {
    const command = line
      .replace(/^(?:if|elif|while|until)\s+/i, '')
      .replace(/^!\s+/, '');
    return /^(?:assert(?:_[a-z0-9_]+|\.[a-z0-9_]+)?(?:\s*\(|\s+)|\[\[?|test\s|(?:grep|jq|cmp|diff)\s)/i.test(command)
      || /\bthrow\s+new\s+Error\b|\bexit\s+1\b/i.test(command)
      || /^(?:if|elif)\s+[a-z_][a-z0-9_]*\s+[^;]+;/i.test(line);
  });
}

function getAssertionCount(content: string, fileExt: string): number {
  if (/^(?:sh|bash)$/i.test(fileExt)) {
    return getShellAssertions(content).length;
  }
  return (content.match(/expect\(|assert(?:\.|\s*\()|throw\s+new\s+Error\b/gi) || []).length;
}

export function scoreAssertionQuality(content: string, fileExt: string): number {
  const isShell = /^(?:sh|bash)$/i.test(fileExt);
  const assertionCount = getAssertionCount(content, fileExt);

  if (assertionCount === 0) return 0;
  
  // Check for snapshot testing (brittle)
  const hasSnapshots = content.match(/toMatchSnapshot|snapshot/i) ? true : false;
  
  // Check for semantic assertions (these are more meaningful)
  const semanticMatchers = isShell
    ? getShellAssertions(content)
    : content.match(/toBe\(|toEqual\(|toContain\(|toMatch\(|toThrow\(|toHaveBeenCalled|toBeGreaterThan|toBeLessThan|toHaveProperty|toStrictEqual|assert\.(?:equal|strictEqual|deepEqual|deepStrictEqual|match|throws|doesNotThrow)\(|throw\s+new\s+Error\b/gi) || [];
  const vacuousAssertions = isShell
    ? []
    : content.match(/toBeTruthy|toBeDefined|toHaveLength/gi) || [];
  
  let score = 0;
  
  // Snapshot-only tests get lowest score
  if (hasSnapshots && semanticMatchers.length === 0) {
    score = 0;
  } 
  // Good semantic assertions
  else if (semanticMatchers.length >= 2 && !hasSnapshots) {
    score = 2;
  } 
  // Mixed approach or single assertion
  else if (semanticMatchers.length >= 1) {
    score = 1;
  } 
  // Only vacuous assertions
  else if (vacuousAssertions.length > 0) {
    score = 0;
  }
  
  return Math.min(2, score);
}

function scoreIsolationRobustness(content: string): number {
  let score = 2;
  
  // Check for timing sleeps (major red flag)
  if (content.match(/setTimeout|test.*sleep|delay.*\d{3,}|await.*new Promise.*\d{3,}/gi)) {
    score -= 2;
  }
  
  // Check for heavy mocking of internals (moderate concern)
  const mockCount = (content.match(/jest\.mock\(|jest\.spyOn\(/gi) || []).length;
  if (mockCount > 5) {
    score -= 1;
  } else if (mockCount > 0) {
    // Some mocking is okay, just deduct a bit
    score -= 0.5;
  }
  
  // Check for global state modifications
  if (content.match(/global\.|process\.env\[/gi)) {
    score -= 1;
  }
  
  // Check for nested describes or setup complexity (indicator of tight coupling)
  const nestedDescribes = (content.match(/describe\(/g) || []).length;
  if (nestedDescribes > 4) {
    score -= 0.5;
  }
  
  // Bonus for proper cleanup
  if (content.match(/afterEach|afterAll|finally|teardown/gi)) {
    score += 0.5;
  }
  
  // Bonus for fixed seeds
  if (content.match(/seed.*=|Math\.random.*fixed|randomSeed/i)) {
    score += 0.5;
  }
  
  return Math.max(0, Math.min(2, Math.round(score * 2) / 2));
}

export function scoreCostCoverage(content: string, fileExt: string): number {
  const lines = content.split('\n').length;
  const assertionCount = getAssertionCount(content, fileExt);
  
  let score = 1; // Start at 1 since most tests have some value
  
  // Reward focused tests (20-50 lines per test is optimal)
  const avgLinesPerTest = lines / Math.max(1, (content.match(/describe\(|it\(/gi) || []).length / 2);
  if (avgLinesPerTest >= 15 && avgLinesPerTest <= 50) {
    score = 2;
  } else if (avgLinesPerTest > 100) {
    score = 0; // Tests are too large/unfocused
  }
  
  // Heavy penalty for extremely slow patterns
  if (content.match(/execSync|spawn|fork|compilation|npm ci|npm install|docker/gi)) {
    score = Math.max(0, score - 1);
  }
  
  // Reward good assertion density
  if (assertionCount >= 3) {
    score = Math.min(2, score + 1);
  } else if (assertionCount === 0) {
    score = 0;
  }
  
  return Math.max(0, Math.min(2, score));
}

function analyzeTest(filePath: string, content: string): TestScore {
  const fileExt = path.extname(filePath).slice(1);
  const language = /^(?:ts|tsx)$/i.test(fileExt)
    ? 'typescript'
    : /^(?:js|jsx|mjs|cjs)$/i.test(fileExt)
      ? 'javascript'
      : /^(?:sh|bash)$/i.test(fileExt)
        ? 'shell'
        : 'other';
  const fileName = path.basename(filePath);
  const lineCount = content.split('\n').length;
  const testName = extractTestName(content, fileExt, filePath);
  
  const scores = {
    intentClarity: scoreIntentClarity(content, fileName, fileExt),
    behavioralRelevance: scoreBehavioralRelevance(content),
    assertionQuality: scoreAssertionQuality(content, fileExt),
    isolationRobustness: scoreIsolationRobustness(content),
    costCoverage: scoreCostCoverage(content, fileExt),
  };
  
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  
  let segment: 'Keep' | 'Refactor' | 'Remove' = 'Keep';
  if (total <= 4) {
    segment = 'Remove';
  } else if (total <= 7) {
    segment = 'Refactor';
  }
  
  const hasSnapshots = content.match(/toMatchSnapshot|snapshot/i) ? true : false;
  const hasMocking = content.match(/jest\.mock|jest\.spyOn/i) ? true : false;
  const hasAsyncWaits = content.match(/setTimeout|waitFor|await/i) ? true : false;
  
  const assertionTypes = [];
  if (content.match(/toBe\(/)) assertionTypes.push('toBe');
  if (content.match(/toEqual\(/)) assertionTypes.push('toEqual');
  if (content.match(/toContain\(/)) assertionTypes.push('toContain');
  if (content.match(/toThrow\(/)) assertionTypes.push('toThrow');
  if (content.match(/toMatchSnapshot/)) assertionTypes.push('snapshot');
  
  const concerns = [];
  if (hasSnapshots && assertionTypes.length === 1) concerns.push('snapshot-only');
  if (lineCount > 150) concerns.push('overly-long');
  if (hasAsyncWaits && content.match(/setTimeout|delay.*\d{3,}/)) concerns.push('timing-flake-risk');
  if (hasMocking && !hasSnapshots) concerns.push('heavy-internal-mocking');
  
  return {
    id: path.relative(process.cwd(), filePath),
    file: filePath,
    testName,
    language,
    lineCount,
    ...scores,
    total,
    segment,
    summary: `${scores.intentClarity} | ${scores.behavioralRelevance} | ${scores.assertionQuality} | ${scores.isolationRobustness} | ${scores.costCoverage}`,
    assertionTypes,
    hasSnapshots,
    hasMocking,
    hasAsyncWaits,
    concerns,
  };
}

function main() {
  const rootDir = process.cwd();
  const testFiles = getAllTestFiles(rootDir);
  
  console.log(`Found ${testFiles.length} test files`);
  
  const scores: TestScore[] = testFiles
    .map(file => {
      const content = readTestFile(file);
      if (!content) return null;
      return analyzeTest(file, content);
    })
    .filter((s): s is TestScore => s !== null)
    .sort((a, b) => a.total - b.total);
  
  // Output complete results
  const resultsFile = path.join(rootDir, 'test-scores.json');
  fs.writeFileSync(resultsFile, JSON.stringify(scores, null, 2));
  console.log(`\n✓ Saved all scores to ${resultsFile}`);
  
  // Identify bottom 10
  const bottom10 = scores.slice(0, 10);
  
  console.log('\n' + '='.repeat(80));
  console.log('BOTTOM 10 LOWEST-SCORING TEST FILES');
  console.log('='.repeat(80) + '\n');
  
  bottom10.forEach((test, idx) => {
    console.log(`${idx + 1}. [${test.total}/10] ${path.basename(test.file)}`);
    console.log(`   Test: "${test.testName}"`);
    console.log(`   Scores: Intent=${test.intentClarity} | Relevance=${test.behavioralRelevance} | Assertions=${test.assertionQuality} | Isolation=${test.isolationRobustness} | Cost=${test.costCoverage}`);
    console.log(`   Concerns: ${test.concerns.join(', ') || 'none'}`);
    console.log(`   Segment: ${test.segment}\n`);
  });
  
  // Summary statistics
  const bySegment = {
    Keep: scores.filter(s => s.segment === 'Keep').length,
    Refactor: scores.filter(s => s.segment === 'Refactor').length,
    Remove: scores.filter(s => s.segment === 'Remove').length,
  };
  
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total test files scored: ${scores.length}`);
  console.log(`Keep (≥8): ${bySegment.Keep}`);
  console.log(`Refactor (5–7): ${bySegment.Refactor}`);
  console.log(`Remove (≤4): ${bySegment.Remove}`);
  console.log(`\nFull results saved to: ${resultsFile}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath && /^score-tests\.(?:[cm]?[jt]s)$/i.test(path.basename(invokedPath))) {
  main();
}
