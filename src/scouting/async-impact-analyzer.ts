/**
 * Async-impact analyzer for scouting phase
 *
 * Detects when a TASK_PROMPT involves async conversions and identifies
 * which files will likely be affected (mocks, tests, interfaces, consumers).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

export interface AsyncImpactAnalysis {
  hasAsyncChanges: boolean;
  asyncKeywords: string[];
  mockFiles: string[];
  testFiles: string[];
  interfaceFiles: string[];
  consumerFiles: string[];
  summary: string;
}

/**
 * Keywords that suggest async conversions are happening
 */
const ASYNC_KEYWORDS = [
  'async',
  'await',
  'promise',
  'callback',
  'convert.*async',
  'make.*async',
  'async.*conversion',
  'promisify',
  'async/await',
  'promise.*based',
  'callback.*async',
  'callback-to-promise',
];

/**
 * Common patterns for mock files
 */
const MOCK_PATTERNS = [
  '**/__mocks__/**/*.ts',
  '**/*.mock.ts',
  '**/*.mock.js',
  '**/mocks/**/*.ts',
  '**/test-fixtures/**/*.ts',
];

/**
 * Common patterns for test files
 */
const TEST_PATTERNS = [
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/*.test.js',
  '**/*.spec.js',
  '**/tests/**/*.ts',
  'test/**/*.ts',
];

/**
 * Common patterns for interface/type definition files
 */
const INTERFACE_PATTERNS = [
  '**/types/**/*.ts',
  '**/*.types.ts',
  '**/*.interface.ts',
  '**/interfaces/**/*.ts',
  '**/schemas/**/*.ts',
];

/**
 * Analyze whether a task prompt involves async changes and identify affected files
 *
 * @param taskPrompt - The TASK_PROMPT text
 * @param workspaceRoot - Root directory to scan for affected files
 * @returns AsyncImpactAnalysis with detected async keywords and affected files
 */
export function analyzeAsyncImpact(
  taskPrompt: string,
  workspaceRoot: string,
): AsyncImpactAnalysis {
  const detectedKeywords = detectAsyncKeywords(taskPrompt);
  const hasAsyncChanges = detectedKeywords.length > 0;

  let mockFiles: string[] = [];
  let testFiles: string[] = [];
  let interfaceFiles: string[] = [];
  let consumerFiles: string[] = [];
  let summary = '';

  if (hasAsyncChanges) {
    mockFiles = findFilesByPatterns(workspaceRoot, MOCK_PATTERNS);
    testFiles = findFilesByPatterns(workspaceRoot, TEST_PATTERNS);
    interfaceFiles = findFilesByPatterns(workspaceRoot, INTERFACE_PATTERNS);

    // For consumer files, try to find imports of common async-related modules
    consumerFiles = findConsumerFiles(workspaceRoot, taskPrompt);

    summary = buildSummary(detectedKeywords, mockFiles, testFiles, interfaceFiles, consumerFiles);
  }

  return {
    hasAsyncChanges,
    asyncKeywords: detectedKeywords,
    mockFiles,
    testFiles,
    interfaceFiles,
    consumerFiles,
    summary,
  };
}

/**
 * Detect async-related keywords in the task prompt
 */
function detectAsyncKeywords(taskPrompt: string): string[] {
  const lowerPrompt = taskPrompt.toLowerCase();
  const found: string[] = [];

  for (const keyword of ASYNC_KEYWORDS) {
    // Create regex that matches the keyword (case-insensitive, word boundaries)
    // Allow optional 's' for plurals
    const pattern = keyword.endsWith('s')
      ? keyword
      : `${keyword}s?`; // Allow singular or plural
    const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
    if (regex.test(lowerPrompt)) {
      found.push(keyword);
    }
  }

  // Deduplicate
  return Array.from(new Set(found));
}

/**
 * Find files matching glob patterns
 *
 * Uses git ls-files to find tracked files efficiently
 */
function findFilesByPatterns(workspaceRoot: string, patterns: string[]): string[] {
  const files = new Set<string>();

  // Check if workspaceRoot exists before trying to use git
  if (!fs.existsSync(workspaceRoot)) {
    return [];
  }

  for (const pattern of patterns) {
    try {
      // Use git ls-files to find tracked files matching pattern
      // Use cwd option instead of cd command to avoid shell errors
      const result = execSync(`git ls-files "${pattern}"`, {
        cwd: workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      if (result) {
        result.split('\n').forEach(file => {
          if (file.trim()) {
            files.add(file.trim());
          }
        });
      }
    } catch {
      // Pattern didn't match or git command failed; continue
    }
  }

  // If git is not available or failed, try fs.walkSync pattern (simple fallback)
  if (files.size === 0 && fs.existsSync(workspaceRoot)) {
    return findFilesByPatternsSync(workspaceRoot, patterns);
  }

  return Array.from(files).sort();
}

/**
 * Fallback file finding using synchronous fs operations
 */
function findFilesByPatternsSync(workspaceRoot: string, patterns: string[]): string[] {
  const files = new Set<string>();

  function walkDir(dir: string, prefix = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip common ignored directories
        if (['node_modules', '.git', '.dist', 'build', 'dist'].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(prefix, entry.name);

        if (entry.isDirectory()) {
          walkDir(fullPath, relPath);
        } else if (entry.isFile()) {
          for (const pattern of patterns) {
            if (matchPattern(relPath, pattern)) {
              files.add(relPath);
            }
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  walkDir(workspaceRoot);
  return Array.from(files).sort();
}

/**
 * Simple glob pattern matcher
 * Supports basic patterns like **\/*.test.ts, src/**\/*.ts, etc.
 */
function matchPattern(filePath: string, pattern: string): boolean {
  // Normalize separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Handle ** pattern
  if (normalizedPattern.includes('**/')) {
    // Pattern like **\/*.test.ts
    // Extract the part after **/
    const afterGlob = normalizedPattern.split('**/').pop() || '';
    if (!afterGlob) return false;

    // Check if any segment of the path matches
    // For **\/*.test.ts, we want to match any /file.test.ts
    if (afterGlob.startsWith('*')) {
      // Pattern like **\/*.test.ts
      const suffix = afterGlob.substring(1); // Remove leading *
      return normalizedPath.includes('/') ? normalizedPath.endsWith(suffix) : normalizedPath.endsWith(suffix);
    }

    // For **\/{somedir}/**\/*.ts, recursively search
    return normalizedPath.includes(afterGlob) || normalizedPath.endsWith(afterGlob);
  }

  // Handle single * pattern in filename
  if (normalizedPattern.includes('*')) {
    const regex = new RegExp(
      `^${normalizedPattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`,
    );
    return regex.test(normalizedPath);
  }

  // Exact match
  return normalizedPath === normalizedPattern;
}

/**
 * Find consumer files (files that import async-related APIs)
 *
 * This is a heuristic search for files that might need updates when async changes are made.
 */
function findConsumerFiles(workspaceRoot: string, taskPrompt: string): string[] {
  const consumers = new Set<string>();

  // Extract potential module/function names from the prompt
  // Look for patterns like "function name" or "MyClass"
  const moduleMatches = taskPrompt.match(/\b[a-zA-Z_][a-zA-Z0-9_]*(?:Service|Handler|Manager|Client|API|Utils)\b/g);

  if (!moduleMatches || moduleMatches.length === 0) {
    return [];
  }

  // Check if workspaceRoot exists before trying to use git
  if (!fs.existsSync(workspaceRoot)) {
    return [];
  }

  try {
    // Search for files that import these modules
    for (const moduleName of new Set(moduleMatches)) {
      try {
        const result = execSync(
          `git grep -l "import.*${moduleName}" -- "*.ts" "*.js"`,
          {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }
        );

        if (result) {
          result.split('\n').forEach(file => {
            if (file.trim() && !file.includes('test') && !file.includes('mock')) {
              consumers.add(file.trim());
            }
          });
        }
      } catch {
        // Module not found in imports; continue
      }
    }
  } catch {
    // git grep not available; return empty
  }

  return Array.from(consumers).sort().slice(0, 10); // Limit to 10 files
}

/**
 * Build a human-readable summary of async impact
 */
function buildSummary(
  keywords: string[],
  mocks: string[],
  tests: string[],
  interfaces: string[],
  consumers: string[],
): string {
  const parts: string[] = [];

  if (keywords.length > 0) {
    parts.push(`Detected async keywords: ${keywords.join(', ')}`);
  }

  if (mocks.length > 0) {
    parts.push(`${mocks.length} mock files may need updates`);
  }

  if (tests.length > 0) {
    parts.push(`${tests.length} test files may need updates`);
  }

  if (interfaces.length > 0) {
    parts.push(`${interfaces.length} interface/type files affected`);
  }

  if (consumers.length > 0) {
    parts.push(`${consumers.length} consumer files may need updates`);
  }

  return parts.join('; ');
}
