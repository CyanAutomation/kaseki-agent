#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_DIFF = '/results/git.diff';
const DEFAULT_OUTPUT = '/results/expectation-mismatch-warnings.jsonl';
const DEFAULT_PROGRESS = '/results/progress.log';
const CATEGORY_PATTERNS = [
  { category: 'stage_name', pattern: /\b(stage|phase|step|status)(?:\b|[A-Z_:-])/i },
  { category: 'parser_output', pattern: /\b(parse|parser|parsed|format|serialize|output|message|label|name|title|description)\b/i },
  { category: 'event_name', pattern: /\b(event|emit|dispatch|publish|subscribe|topic|type)\b/i },
  { category: 'regex_capture_output', pattern: /\b(regex|regexp|match|capture|group|replace|pattern)\b|\/.*\//i },
];
const TEST_FILE_RE = /(^|\/)(__tests__\/.*|tests?\/.*|[^/]+\.(test|spec)\.[cm]?[jt]sx?)$/i;
const PRODUCTION_EXT_RE = /\.[cm]?[jt]sx?$/i;
const MIN_LITERAL_LENGTH = 3;
const MAX_LITERAL_LENGTH = 160;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo']);

function parseArgs(argv) {
  const options = {
    diff: process.env.KASEKI_EXPECTATION_DIFF || DEFAULT_DIFF,
    output: process.env.KASEKI_EXPECTATION_WARNINGS || DEFAULT_OUTPUT,
    progress: process.env.KASEKI_PROGRESS_LOG || DEFAULT_PROGRESS,
    repo: process.env.KASEKI_REPO_DIR || (fs.existsSync('/workspace/repo') ? '/workspace/repo' : process.cwd()),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--diff') options.diff = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--progress') options.progress = argv[++index];
    else if (arg === '--repo') options.repo = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/detect-expectation-mismatches.js [--repo DIR] [--diff FILE] [--output FILE] [--progress FILE]');
      process.exit(0);
    }
  }
  return options;
}

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeDiffPath(rawPath) {
  return rawPath.replace(/^a\//, '').replace(/^b\//, '');
}

function isTestFile(filePath) {
  return TEST_FILE_RE.test(filePath);
}

function isProductionFile(filePath) {
  return PRODUCTION_EXT_RE.test(filePath) && !isTestFile(filePath) && !filePath.endsWith('.d.ts');
}

function unescapeLiteral(raw) {
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw.replace(/\\(['"`/\\bfnrtv])/g, '$1');
  }
}

function extractStringLiterals(line) {
  const literals = [];
  const literalRe = /(['"`])((?:\\.|(?!\1).)*?)\1/g;
  let match;
  while ((match = literalRe.exec(line)) !== null) {
    const value = unescapeLiteral(match[2]);
    if (isLikelyExpectationValue(value)) literals.push(value);
  }
  return literals;
}

function extractRegexFragments(line) {
  const fragments = [];
  const regexRe = /(?<![\w)$\]])\/((?:\\.|[^/\\\n]){3,})\/[dgimsuvy]*/g;
  let match;
  while ((match = regexRe.exec(line)) !== null) {
    const fragment = match[1];
    if (isLikelyExpectationValue(fragment)) fragments.push(fragment);
  }
  return fragments;
}

function isLikelyExpectationValue(value) {
  if (!value) return false;
  if (value.length < MIN_LITERAL_LENGTH || value.length > MAX_LITERAL_LENGTH) return false;
  if (/^[\s\d._/-]+$/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  return /[A-Za-z]/.test(value);
}

function hasExpectationSignal(value, contextLine) {
  const searchable = `${value}\n${contextLine}`;
  return CATEGORY_PATTERNS.some(({ pattern }) => pattern.test(searchable)) || /\s/.test(value) || /[_:-]/.test(value);
}

function categoriesFor(value, contextLine, type) {
  const searchable = `${value}\n${contextLine}`;
  const categories = CATEGORY_PATTERNS.filter(({ pattern }) => pattern.test(searchable)).map(({ category }) => category);
  if (type === 'regex' && !categories.includes('regex_capture_output')) categories.push('regex_capture_output');
  if (categories.length === 0 && /\s/.test(value)) categories.push('parser_output');
  return categories;
}

function similarityScore(oldValue, newValue) {
  if (oldValue === newValue) return 1;
  if (oldValue.includes(newValue) || newValue.includes(oldValue)) return 0.85;
  const oldTokens = new Set(oldValue.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const newTokens = new Set(newValue.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (oldTokens.size === 0 || newTokens.size === 0) return 0;
  const intersection = [...oldTokens].filter(token => newTokens.has(token)).length;
  return intersection / Math.max(oldTokens.size, newTokens.size);
}

function parseChangedCandidates(diffText) {
  const candidates = [];
  let currentFile = '';
  let oldLine = 0;
  let newLine = 0;
  let removed = [];
  let added = [];

  function flushPairs() {
    if (!currentFile || !isProductionFile(currentFile)) {
      removed = [];
      added = [];
      return;
    }

    for (const oldItem of removed) {
      let best = null;
      for (const newItem of added) {
        if (oldItem.type !== newItem.type) continue;
        if (oldItem.value === newItem.value) continue;
        const score = similarityScore(oldItem.value, newItem.value);
        if (score >= 0.35 && (!best || score > best.score)) best = { ...newItem, score };
      }
      if (!best) continue;
      const categories = categoriesFor(oldItem.value, `${oldItem.line}\n${best.line}`, oldItem.type);
      if (categories.length === 0 || !hasExpectationSignal(oldItem.value, `${oldItem.line}\n${best.line}`)) continue;
      candidates.push({
        productionFile: currentFile,
        oldValue: oldItem.value,
        newValue: best.value,
        literalType: oldItem.type,
        category: categories[0],
        categories,
        oldLine: oldItem.lineNumber,
        newLine: best.lineNumber,
        oldSourceLine: oldItem.line.trim(),
        newSourceLine: best.line.trim(),
      });
    }
    removed = [];
    added = [];
  }

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flushPairs();
      currentFile = '';
      continue;
    }
    if (line.startsWith('+++ b/')) {
      currentFile = normalizeDiffPath(line.slice('+++ '.length));
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      flushPairs();
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith('-') && !line.startsWith('---')) {
      const source = line.slice(1);
      const strings = extractStringLiterals(source).map(value => ({ value, type: 'string' }));
      const regexes = extractRegexFragments(source).map(value => ({ value, type: 'regex' }));
      removed.push(...strings.concat(regexes).map(item => ({ ...item, line: source, lineNumber: oldLine })));
      oldLine += 1;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const source = line.slice(1);
      const strings = extractStringLiterals(source).map(value => ({ value, type: 'string' }));
      const regexes = extractRegexFragments(source).map(value => ({ value, type: 'regex' }));
      added.push(...strings.concat(regexes).map(item => ({ ...item, line: source, lineNumber: newLine })));
      newLine += 1;
      continue;
    }
    if (!line.startsWith('\\')) {
      oldLine += 1;
      newLine += 1;
    }
  }
  flushPairs();

  const seen = new Set();
  return candidates.filter(candidate => {
    const key = `${candidate.productionFile}\0${candidate.oldValue}\0${candidate.newValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function walkTestFiles(repoDir) {
  const found = [];
  function walk(relativeDir) {
    const absoluteDir = path.join(repoDir, relativeDir);
    let entries = [];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(relativePath);
      } else if (entry.isFile() && isTestFile(relativePath)) {
        found.push(relativePath);
      }
    }
  }
  walk('');
  return found;
}

function basenameWithoutExt(filePath) {
  return path.basename(filePath).replace(/\.(test|spec)\.[cm]?[jt]sx?$/i, '').replace(/\.[cm]?[jt]sx?$/i, '');
}

function relatedTestFiles(candidate, allTests) {
  const productionBase = basenameWithoutExt(candidate.productionFile);
  const productionDir = path.dirname(candidate.productionFile).replace(/\\/g, '/');
  const ranked = allTests
    .map(testFile => {
      const testBase = basenameWithoutExt(testFile);
      let score = 0;
      if (testBase === productionBase) score += 5;
      if (testFile.includes(productionBase)) score += 3;
      if (testFile.startsWith(`${productionDir}/`)) score += 2;
      if (testFile.startsWith('tests/')) score += 1;
      return { testFile, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.testFile.localeCompare(b.testFile))
    .map(item => item.testFile);
  return ranked.length > 0 ? ranked : allTests;
}

function lineNumberFor(content, needle) {
  const index = content.indexOf(needle);
  if (index < 0) return 0;
  return content.slice(0, index).split('\n').length;
}

function contextAround(content, needle, radius = 120) {
  const index = content.indexOf(needle);
  if (index < 0) return '';
  return content.slice(Math.max(0, index - radius), Math.min(content.length, index + needle.length + radius));
}

function refineCategory(candidate, testContext) {
  const categories = categoriesFor(candidate.oldValue, `${candidate.oldSourceLine}\n${candidate.newSourceLine}\n${testContext}`, candidate.literalType);
  return { category: categories[0] || candidate.category, categories: [...new Set(categories.concat(candidate.categories))] };
}

function findMismatches(repoDir, candidates) {
  const allTests = walkTestFiles(repoDir);
  const findings = [];
  const seen = new Set();

  for (const candidate of candidates) {
    for (const testFile of relatedTestFiles(candidate, allTests)) {
      const absoluteTest = path.join(repoDir, testFile);
      const content = readFileIfExists(absoluteTest);
      if (!content.includes(candidate.oldValue)) continue;
      const key = `${candidate.productionFile}\0${testFile}\0${candidate.oldValue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const testContext = contextAround(content, candidate.oldValue);
      const refined = refineCategory(candidate, testContext);
      findings.push({
        type: 'expectation_mismatch_warning',
        severity: 'warning',
        category: refined.category,
        categories: refined.categories,
        production_file: candidate.productionFile,
        production_line: candidate.oldLine,
        test_file: testFile,
        test_line: lineNumberFor(content, candidate.oldValue),
        old_value: candidate.oldValue,
        new_value: candidate.newValue,
        literal_type: candidate.literalType,
        message: `Production ${candidate.literalType} changed from ${JSON.stringify(candidate.oldValue)} to ${JSON.stringify(candidate.newValue)}, but related test ${testFile} still contains the old value.`,
      });
    }
  }

  return findings;
}

function writeJsonl(filePath, rows) {
  ensureParent(filePath);
  fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''));
}

function appendProgress(filePath, findings, candidateCount) {
  ensureParent(filePath);
  const timestamp = new Date().toISOString();
  if (findings.length === 0) {
    fs.appendFileSync(filePath, `[expectation-mismatch] ${timestamp} no stale test expectations found (${candidateCount} changed literal candidates)\n`);
    return;
  }
  const byTest = new Map();
  for (const finding of findings) byTest.set(finding.test_file, (byTest.get(finding.test_file) || 0) + 1);
  const summary = [...byTest.entries()].map(([file, count]) => `${file}:${count}`).join(', ');
  fs.appendFileSync(filePath, `[expectation-mismatch] ${timestamp} ${findings.length} warning(s): ${summary}; details=/results/expectation-mismatch-warnings.jsonl\n`);
}

export function detectExpectationMismatches(options) {
  const diffText = readFileIfExists(options.diff);
  const candidates = diffText ? parseChangedCandidates(diffText) : [];
  const findings = diffText ? findMismatches(options.repo, candidates) : [];
  writeJsonl(options.output, findings);
  appendProgress(options.progress, findings, candidates.length);
  return { candidates, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  detectExpectationMismatches(options);
}
