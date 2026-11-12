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

export interface TestScore {
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

function maskCommentsAndStrings(source: string): { code: string; comments: string } {
  let code = '';
  let comments = '';
  let state: 'code' | 'single' | 'double' | 'template' | 'regex' | 'line' | 'block' = 'code';
  let escaped = false;
  let inRegexCharacterClass = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'line') {
      comments += char;
      code += char === '\n' ? '\n' : ' ';
      if (char === '\n') state = 'code';
      continue;
    }
    if (state === 'block') {
      comments += char;
      code += char === '\n' ? '\n' : ' ';
      if (char === '*' && next === '/') {
        comments += '/';
        code += ' ';
        index += 1;
        state = 'code';
      }
      continue;
    }
    if (state === 'regex') {
      code += char === '\n' ? '\n' : ' ';
      comments += char === '\n' ? '\n' : ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '[') inRegexCharacterClass = true;
      else if (char === ']') inRegexCharacterClass = false;
      else if (char === '/' && !inRegexCharacterClass) state = 'code';
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      code += char === '\n' ? '\n' : ' ';
      comments += char === '\n' ? '\n' : ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if ((state === 'single' && char === "'") || (state === 'double' && char === '"') || (state === 'template' && char === '`')) state = 'code';
      continue;
    }

    if (char === '/' && next === '/') {
      comments += '//';
      code += '  ';
      index += 1;
      state = 'line';
    } else if (char === '/' && next === '*') {
      comments += '/*';
      code += '  ';
      index += 1;
      state = 'block';
    } else if (char === '/') {
      const prefix = source.slice(0, index);
      const previous = prefix.match(/\S(?=\s*$)/)?.[0];
      const startsRegex = !previous
        || /[([{=:;,!?&|+\-*%^~<>]/.test(previous)
        || /\b(?:return|throw|case|typeof|instanceof|in|of|yield|await)\s*$/.test(prefix);
      if (startsRegex) {
        code += ' ';
        comments += ' ';
        state = 'regex';
        inRegexCharacterClass = false;
      } else {
        code += char;
        comments += ' ';
      }
    } else if (char === "'") {
      code += ' ';
      comments += ' ';
      state = 'single';
    } else if (char === '"') {
      code += ' ';
      comments += ' ';
      state = 'double';
    } else if (char === '`') {
      code += ' ';
      comments += ' ';
      state = 'template';
    } else {
      code += char;
      comments += ' ';
    }
  }
  return { code, comments };
}

function readStringLiteral(content: string, start: number): { value: string; end: number } | undefined {
  const quote = content[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return undefined;

  let value = '';
  let escaped = false;
  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) {
      value += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === quote) {
      return { value, end: index + 1 };
    } else {
      value += char;
    }
  }
  return undefined;
}

function findMatchingDelimiter(content: string, openIndex: number, open: string, close: string): number | undefined {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === open) depth += 1;
    else if (char === close && --depth === 0) return index;
  }
  return undefined;
}

function extractTestTitles(content: string): string[] {
  const titles: string[] = [];
  const callPattern = /\b(?:it|test)(?:\.(?:each|concurrent|only|skip))*\s*\(/g;
  const executableCode = maskCommentsAndStrings(content).code;
  for (const match of executableCode.matchAll(callPattern)) {
    const openIndex = match.index! + match[0].lastIndexOf('(');
    const leadingSpace = content.slice(openIndex + 1).match(/^\s*/)?.[0].length ?? 0;
    const argumentStart = openIndex + 1 + leadingSpace;
    let title = readStringLiteral(content, argumentStart);

    // `test.each(rows)('rejects invalid rows', ...)` puts the title in a second call.
    if (!title && content[argumentStart] === '[') {
      const tableEnd = findMatchingDelimiter(content, argumentStart, '[', ']');
      if (tableEnd !== undefined) {
        const closeCall = content.indexOf(')', tableEnd);
        const titleCall = closeCall === -1 ? -1 : content.indexOf('(', closeCall + 1);
        if (titleCall !== -1) {
          const titleStart = titleCall + 1 + (content.slice(titleCall + 1).match(/^\s*/)?.[0].length ?? 0);
          title = readStringLiteral(content, titleStart);
        }
      }
    }

    if (title?.value) titles.push(title.value.trim());
  }
  return titles;
}

function isDescriptiveTitle(title: string): boolean {
  return title.length >= 12 && !/^(?:test|helper|function|works?|todo)\b/i.test(title);
}

export function extractTestName(content: string, fileExt: string, filePath: string): string {
  if (/^(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(fileExt)) {
    const titles = extractTestTitles(content);
    const behaviorTitle = titles.find(isDescriptiveTitle);
    if (behaviorTitle) return behaviorTitle;

    const describeMatch = content.match(/describe\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/);
    if (describeMatch) return describeMatch[2];
    if (titles[0]) return titles[0];
  } else if (/^(?:sh|bash)$/i.test(fileExt)) {
    const testFunctionMatch = content.match(/^\s*(?:function\s+)?(test_[a-z0-9_]+)\s*\(\s*\)\s*\{/im);
    if (testFunctionMatch) return testFunctionMatch[1].replace(/_/g, ' ');
    const commentLines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('#') && !/^#!|^#\s*shellcheck\b/i.test(line));
    const contractComment = commentLines.find((line) =>
      /^#\s*(?:contract|build contract|publish contract|regression(?: test)?|integration test|test)\s*:/i.test(line),
    );
    const descriptiveComment = commentLines.find((line) =>
      line.length > 12 && !line.includes('|') && !/^#\s*(?:path|mode|usage|helper)\b/i.test(line),
    );
    const commentLine = contractComment || descriptiveComment;
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
    const hasAssertions = getAssertionCount(content, fileExt) > 0;
    if (descriptiveHeader && descriptiveHeader.length > 12 && hasAssertions) return 2;
    return descriptiveHeader && descriptiveHeader.length > 12
      || (descriptiveFileTitle && hasAssertions)
      ? 1
      : 0;
  }

  const testTitles = extractTestTitles(content);
  const descriptiveTestTitle = testTitles.some(isDescriptiveTitle);

  // Check if test name clearly states behavior
  const docBlock = /\/\*\*[\s\S]*?\*\//.test(content);
  const hasDescriptiveComment = /\/\/\s*(?:Should|Tests?|Validates?|Checks?|Ensures?)/i.test(content);
  const vacuousPattern = testTitles.some((title) => /^(?:test|helper|function|works?|tests?)\b/i.test(title));
  
  let score = 0;
  
  if (descriptiveTestTitle && !vacuousPattern) {
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

export function scoreBehavioralRelevance(content: string, fileExt = 'ts'): number {
  const extracted = maskCommentsAndStrings(content);
  const comments = /^(?:sh|bash)$/i.test(fileExt)
    ? content.split('\n').filter((line) => /^\s*#/.test(line) && !/^\s*#!/.test(line)).join('\n')
    : extracted.comments;
  const titles = extractTestTitles(content).join(' ');
  const traceText = `${comments} ${titles}`;
  const hasIssueReference = /(?:\b(?:GH|PR|ISSUE|BUG|KASEKI)[-# ]\d+\b|\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+\b|(?<!\w)#\d+\b|github\.com\/[^\s]+\/(?:issues|pull)\/\d+)/i.test(traceText);
  const hasSpecId = /\b(?:SPEC|REQ|PRD)[-:# ]+[A-Z]?\d+\b/i.test(traceText);
  const hasSectionLink = /\b(?:Spec|Contract|Requirement)\s*:\s*[^\s)]+\.md#[\w-]+/i.test(comments);
  if (hasIssueReference || hasSpecId || hasSectionLink) return 2;

  const hasUnlinkedSpec = /\b(?:Spec|Contract|Requirement)\b/i.test(comments);
  const shellTitle = (content.match(/^\s*(?:function\s+)?test_([a-z0-9_]+)\s*\(\s*\)/im)?.[1] || '').replace(/_/g, ' ');
  const explicitlyIncidental = /\b(?:private helper|internal helper|implementation detail|function exists|export exists|module structure)\b/i.test(`${titles} ${shellTitle} ${comments}`);
  if (explicitlyIncidental) return 0;
  if (hasUnlinkedSpec || getAssertionCount(extracted.code, fileExt) > 0) return 1;
  return 0;
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
    return /^(?:assert(?:_[a-z0-9_]+|\.[a-z0-9_]+)?(?:\s*\(|\s+)|\[\[?|test\s|(?:awk|grep|jq|cmp|diff)\s)/i.test(command)
      || /\bthrow\s+new\s+Error\b|\bexit\s+1\b/i.test(command)
      || /^(?:if|elif)\s+[a-z_][a-z0-9_]*\s+[^;]+;/i.test(line);
  });
}

function getAssertionCount(content: string, fileExt: string): number {
  if (/^(?:sh|bash)$/i.test(fileExt)) {
    return getShellAssertions(content).length;
  }
  const code = maskCommentsAndStrings(content).code;
  return (code.match(/\.(?:not\.)?(?:toBe|toEqual|toStrictEqual|toMatchObject|toContain|toContainEqual|toMatch|toThrow|toBeInstanceOf|toHaveBeenCalled(?:Times|With)?|toHaveProperty|toBeGreaterThan(?:OrEqual)?|toBeLessThan(?:OrEqual)?|toBeDefined|toBeUndefined|toBeTruthy|toBeFalsy|toHaveLength|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\bassert\.(?:equal|strictEqual|deepEqual|deepStrictEqual|match|ok|throws|doesNotThrow)\s*\(|(?<!function )\bassert[A-Z][\w$]*\s*\(|\bthrow\s+new\s+Error\b/gi) || []).length;
}

export function scoreAssertionQuality(content: string, fileExt: string): number {
  const isShell = /^(?:sh|bash)$/i.test(fileExt);
  const assertionCount = getAssertionCount(content, fileExt);

  if (assertionCount === 0) return 0;
  
  const code = maskCommentsAndStrings(content).code;
  const hasSnapshots = /\.(?:toMatchSnapshot|toMatchInlineSnapshot)\s*\(/.test(code);

  const semanticMatchers = isShell
    ? getShellAssertions(content)
    : code.match(/\.(?:not\.)?(?:toBe|toEqual|toStrictEqual|toMatchObject|toContain|toContainEqual|toMatch|toThrow|toBeInstanceOf|toHaveBeenCalled(?:Times|With)?|toHaveProperty|toBeGreaterThan(?:OrEqual)?|toBeLessThan(?:OrEqual)?)\s*\(|\bassert\.(?:equal|strictEqual|deepEqual|deepStrictEqual|match|ok|throws|doesNotThrow)\s*\(|(?<!function )\bassert[A-Z][\w$]*\s*\(|\bthrow\s+new\s+Error\b/gi) || [];
  const hasPreciseAssertion = !isShell && /\.(?:not\.)?(?:toBe|toEqual|toStrictEqual|toMatchObject|toContainEqual|toThrow|toBeInstanceOf|toHaveBeenCalledWith|toHaveProperty)\s*\(|\bassert\.(?:equal|strictEqual|deepEqual|deepStrictEqual|throws|doesNotThrow)\s*\(/i.test(code);
  const vacuousAssertions = isShell
    ? []
    : code.match(/\.(?:toBeTruthy|toBeDefined|toHaveLength)\s*\(/gi) || [];
  
  let score = 0;
  
  // Snapshot-only tests get lowest score
  if (hasSnapshots && semanticMatchers.length === 0) {
    score = 0;
  } 
  // Good semantic assertions
  else if (semanticMatchers.length >= 2 && !hasSnapshots) {
    score = 2;
  } 
  // A single exact contract assertion can carry more value than several broad checks.
  else if (hasPreciseAssertion && !hasSnapshots) {
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

export function scoreIsolationRobustness(content: string): number {
  const code = maskCommentsAndStrings(content).code;
  const hasElapsedTimeBound = /Date\.now\(\)\s*-\s*\w+\s*<\s*\d+/s.test(code);
  const hasBoundedPolling = hasElapsedTimeBound
    || /\b(?:for|while)\b[\s\S]{0,180}\b(?:attempts?|maxAttempts|retries|timeout|deadline)\b/i.test(code);
  const hasUncontrolledWait =
    /\bawait\s+new\s+Promise(?:<[^>]+>)?\s*\(\s*\w+\s*=>\s*setTimeout\s*\(\s*\w+\s*,\s*\d+/s.test(code)
    || /\bsleep\s+\d+(?:\.\d+)?\b/.test(code)
    || (/while\s*\([^)]*Date\.now\s*\(/s.test(code) && !hasElapsedTimeBound);
  if (hasUncontrolledWait) return hasBoundedPolling ? 1 : 0;
  if (hasElapsedTimeBound) return 1;

  const mutatesSharedState = /(?:process\.env(?:\.[A-Z0-9_]+|\[[^\]]+\])|global\.[\w$]+)\s*=(?!=)/i.test(code);
  const restoresSharedState = /\b(?:afterEach|afterAll|finally|restoreEnv|restoreAllMocks|resetAllMocks)\b/i.test(code);
  if (mutatesSharedState && !restoresSharedState) return 0;

  const mockCount = (code.match(/jest\.(?:mock|spyOn)\s*\(/g) || []).length;
  return mockCount > 5 ? 1 : 2;
}

export function scoreCostCoverage(content: string, fileExt: string): number {
  const assertionCount = getAssertionCount(content, fileExt);
  if (assertionCount === 0) return 0;

  const code = maskCommentsAndStrings(content).code;
  const invokesSlowTool = /\b(?:docker\s+(?:run|build|compose)|npm\s+(?:ci|install))\b/i.test(code);
  if (invokesSlowTool) return 1;

  const invokesSubprocess = /\b(?:execSync|execFileSync|spawnSync|spawn|fork)\s*\(/i.test(code);
  if (invokesSubprocess) return 1;

  return assertionCount >= 3 ? 2 : 1;
}

export function analyzeTest(filePath: string, content: string): TestScore {
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
    behavioralRelevance: scoreBehavioralRelevance(content, fileExt),
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
  
  const executableCode = maskCommentsAndStrings(content).code;
  const hasSnapshots = /\.(?:toMatchSnapshot|toMatchInlineSnapshot)\s*\(/.test(executableCode);
  const hasMocking = /jest\.(?:mock|spyOn)\s*\(/i.test(executableCode);
  const hasAsyncWaits = /\b(?:setTimeout|waitFor|await)\b/i.test(executableCode);
  
  const assertionTypes = [];
  if (/\.toBe\s*\(/.test(executableCode)) assertionTypes.push('toBe');
  if (/\.toEqual\s*\(/.test(executableCode)) assertionTypes.push('toEqual');
  if (/\.toContain\s*\(/.test(executableCode)) assertionTypes.push('toContain');
  if (/\.toThrow\s*\(/.test(executableCode)) assertionTypes.push('toThrow');
  if (/\.(?:toMatchSnapshot|toMatchInlineSnapshot)\s*\(/.test(executableCode)) assertionTypes.push('snapshot');
  
  const concerns = [];
  if (hasSnapshots && assertionTypes.length === 1) concerns.push('snapshot-only');
  if (lineCount > 300) concerns.push('large-file-review');
  if (hasAsyncWaits && scoreIsolationRobustness(content) === 0) concerns.push('timing-or-global-state-risk');
  if ((executableCode.match(/jest\.(?:mock|spyOn)\s*\(/g) || []).length > 5) concerns.push('many-mocks-review');

  const relativeFile = path.isAbsolute(filePath) ? path.relative(process.cwd(), filePath) : filePath;
  
  return {
    id: relativeFile,
    file: relativeFile,
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
    .sort((a, b) => a.total - b.total || a.id.localeCompare(b.id));
  
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
  console.log('Scores are source-based estimates; actual runtime and mutation coverage are not measured.');
  console.log(`Keep (≥8): ${bySegment.Keep}`);
  console.log(`Refactor (5–7): ${bySegment.Refactor}`);
  console.log(`Remove (≤4): ${bySegment.Remove}`);
  console.log(`\nFull results saved to: ${resultsFile}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath && /^score-tests\.(?:[cm]?[jt]s)$/i.test(path.basename(invokedPath))) {
  main();
}
