#!/usr/bin/env node
/**
 * add-js-extensions.ts
 *
 * Post-compilation script to add .js extensions to local imports in ES modules.
 * This is required for proper ES module resolution in Node.js.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = __dirname;

function hasExtension(importPath: string): boolean {
  return path.extname(importPath) !== '';
}

function addJsExtensions(filePath: string): void {
  let content = fs.readFileSync(filePath, 'utf8');

  // Match static imports/exports from relative paths without extensions.
  // Pattern: from './path', from "../path", from '../../path', etc.
  content = content.replace(
    /(from\s+)(['"])(\.{1,2}[/\\][^'"]*?)(\2)/g,
    (match: string, prefix: string, quote: string, importPath: string) => {
      if (hasExtension(importPath)) {
        return match;
      }

      return `${prefix}${quote}${importPath}.js${quote}`;
    },
  );

  // Match dynamic imports from relative paths without extensions.
  // Pattern: import('./path'), import("../path"), import('../../path'), etc.
  content = content.replace(
    /(import\(\s*)(['"])(\.{1,2}[/\\][^'"]*?)(\2\s*\))/g,
    (match: string, prefix: string, quote: string, importPath: string, suffix: string) => {
      if (hasExtension(importPath)) {
        return match;
      }

      return `${prefix}${quote}${importPath}.js${suffix}`;
    },
  );

  fs.writeFileSync(filePath, content, 'utf8');
}

function processDirectory(dir: string): void {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      processDirectory(filePath);
    } else if (file.endsWith('.js')) {
      addJsExtensions(filePath);
    }
  }
}

try {
  if (fs.existsSync(distDir)) {
    processDirectory(distDir);
    console.log('✓ Added .js extensions to imports in dist/');
  }
} catch (error) {
  const err = error as Error;
  console.error('Error adding .js extensions:', err.message);
  process.exit(1);
}
