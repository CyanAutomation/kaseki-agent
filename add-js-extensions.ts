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
const distDir = path.join(__dirname, 'dist');

function addJsExtensions(filePath: string): void {
  let content = fs.readFileSync(filePath, 'utf8');

  // Match imports/exports from relative paths without extensions
  // Pattern: from './path' or from "./path"
  // But not: from './path.js' or from 'npm-package' or from 'npm-package/subpath'
  content = content.replace(
    /from\s+['"](\.[\/\\][^'"]*?)['"](?!\.js\b)/g,
    (match: string, importPath: string) => {
      // Skip if already has .js extension
      if (importPath.endsWith('.js')) {
        return match;
      }
      // Add .js extension to relative imports
      return `from '${importPath}.js'`;
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
