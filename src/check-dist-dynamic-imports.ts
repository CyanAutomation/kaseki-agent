#!/usr/bin/env node
/**
 * check-dist-dynamic-imports.ts
 *
 * Fails the build if emitted JavaScript contains extensionless relative dynamic
 * imports. Node.js ESM requires emitted relative specifiers to include the
 * final .js extension.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = __dirname;
const extensionlessRelativeDynamicImportPattern = /import\(\s*(['"])(\.\{1,2\}\/(?:[^'"]*?(?:\/|^))?[^'"./]+)\1\s*\)/g;

interface MatchResult {
  filePath: string;
  line: number;
  column: number;
  specifier: string;
}

function findJavaScriptFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findJavaScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

function getLineAndColumn(content: string, index: number): { line: number; column: number } {
  const beforeMatch = content.slice(0, index);
  const lines = beforeMatch.split('\n');

  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function findExtensionlessRelativeDynamicImports(filePath: string): MatchResult[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const results: MatchResult[] = [];

  for (const match of content.matchAll(extensionlessRelativeDynamicImportPattern)) {
    const specifier = match[2];
    const index = match.index ?? 0;
    const { line, column } = getLineAndColumn(content, index);

    results.push({ filePath, line, column, specifier });
  }

  return results;
}

if (!fs.existsSync(distDir)) {
  console.error(`dist directory does not exist: ${distDir}`);
  process.exit(1);
}

const matches = findJavaScriptFiles(distDir).flatMap(findExtensionlessRelativeDynamicImports);

if (matches.length > 0) {
  console.error('Found extensionless relative dynamic imports in emitted JavaScript:');

  for (const match of matches) {
    const relativePath = path.relative(distDir, match.filePath);
    console.error(`${relativePath}:${match.line}:${match.column} import('${match.specifier}')`);
  }

  process.exit(1);
}

console.log('✓ No extensionless relative dynamic imports found in dist/');
