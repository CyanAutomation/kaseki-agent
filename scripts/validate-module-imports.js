#!/usr/bin/env node
/**
 * Validate Module Imports for Kaseki Agent
 *
 * This script ensures that all binaries compiled from TypeScript source files
 * can resolve their dependencies at runtime. It:
 * 1. Scans critical binaries (pi-progress-stream, pi-event-filter, kaseki-report, github-app-token)
 * 2. Parses their imports and builds a dependency graph
 * 3. Verifies all imports resolve to actual files in dist/
 * 4. Detects missing modules that should be copied to /app/lib/
 * 5. Reports any issues and fails if validation errors are found
 *
 * Exit codes:
 *   0 = All validations passed
 *   1 = Missing module dependencies detected
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m',
};
function log(color, prefix, message) {
  console.log(`${color}${prefix}${colors.reset} ${message}`);
}
/**
 * Extract all import paths from a TypeScript file content
 * Handles both ES6 imports and dynamic imports
 */
function extractImports(fileContent) {
  const imports = new Set();
  // ES6 import statements: import ... from '...' and side-effect imports: import '...'
  const importRegex = /import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(fileContent)) !== null) {
    const importPath = match[1];
    // Only track relative imports (starting with ./)
    if (importPath.startsWith('.')) {
      imports.add(importPath);
    }
  }
  // Dynamic imports: import('...')
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(fileContent)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.')) {
      imports.add(importPath);
    }
  }
  return Array.from(imports);
}
/**
 * Recursively resolve all dependencies for a given file
 */
function resolveDependencies(filePath, distDir, visited = new Set(), results = new Map()) {
  const normalizedPath = path.normalize(filePath);
  if (visited.has(normalizedPath)) {
    return results;
  }
  visited.add(normalizedPath);
  if (!fs.existsSync(filePath)) {
    results.set(normalizedPath, { exists: false, imports: [], missing: true });
    return results;
  }
  let fileContent;
  try {
    fileContent = fs.readFileSync(filePath, 'utf8');
  }
  catch (error) {
    results.set(normalizedPath, { exists: true, imports: [], error: error.message });
    return results;
  }
  const imports = extractImports(fileContent);
  const resolvedImports = [];
  const missingImports = [];
  for (const importPath of imports) {
    // Resolve the import path relative to the current file's directory
    const baseDir = path.dirname(filePath);
    let resolvedPath;
    // Handle .js and .ts extensions
    if (!importPath.endsWith('.js') && !importPath.endsWith('.ts')) {
      // Try .ts first, then .js
      const tsPath = path.resolve(baseDir, importPath + '.ts');
      const jsPath = path.resolve(baseDir, importPath + '.js');
      if (fs.existsSync(tsPath)) {
        resolvedPath = tsPath;
      }
      else if (fs.existsSync(jsPath)) {
        resolvedPath = jsPath;
      }
      else {
        missingImports.push(importPath);
        continue;
      }
    }
    else {
      resolvedPath = path.resolve(baseDir, importPath);
      if (!fs.existsSync(resolvedPath)) {
        // Try swapping .ts for .js
        const altPath = resolvedPath.replace(/\.ts$/, '.js');
        if (fs.existsSync(altPath)) {
          resolvedPath = altPath;
        }
        else {
          missingImports.push(importPath);
          continue;
        }
      }
    }
    resolvedImports.push(path.relative(distDir, resolvedPath));
    // Recursively resolve sub-dependencies
    resolveDependencies(resolvedPath, distDir, visited, results);
  }
  results.set(normalizedPath, {
    exists: true,
    imports: resolvedImports,
    missingImports: missingImports.length > 0 ? missingImports : undefined,
  });
  return results;
}
/**
 * Main validation logic
 */
function main() {
  const srcDir = path.resolve(__dirname, '../src');
  const distDir = path.resolve(__dirname, '../dist');
  // Critical binaries that must have all dependencies resolved
  // These are copied to /usr/local/bin/ in the Dockerfile
  const criticalBinaries = [
    { source: 'pi-event-filter.ts', output: 'pi-event-filter.js', name: 'kaseki-pi-event-filter' },
    { source: 'pi-progress-stream.ts', output: 'pi-progress-stream.js', name: 'kaseki-pi-progress-stream' },
    { source: 'kaseki-report.ts', output: 'kaseki-report.js', name: 'kaseki-report' },
    {
      source: 'instance-state-derivation.ts',
      output: 'instance-state-derivation.js',
      name: 'instance-state-derivation',
    },
    { source: 'github-app-token.ts', output: 'github-app-token.js', name: 'github-app-token' },
  ];
  console.log(`\n${colors.bold}Validating Module Imports for Kaseki Agent${colors.reset}\n`);
  console.log(`Source directory: ${srcDir}`);
  console.log(`Dist directory:   ${distDir}\n`);
  let hasErrors = false;
  const validationResults = [];
  for (const binary of criticalBinaries) {
    const sourceFile = path.resolve(srcDir, binary.source);
    let binaryHasErrors = false;
    log(colors.blue, '→', `Validating ${colors.bold}${binary.name}${colors.reset}...`);
    // Check if source exists
    if (!fs.existsSync(sourceFile)) {
      log(colors.red, '  ✗', `Source file not found: ${sourceFile}`);
      hasErrors = true;
      continue;
    }
    // Resolve all dependencies
    const dependencies = resolveDependencies(sourceFile, srcDir);
    const result = {
      binary: binary.name,
      source: binary.source,
      imports: [],
      missingImports: [],
      errors: [],
    };
    // Check each dependency
    for (const [depPath, depInfo] of dependencies) {
      if (depPath === sourceFile)
        continue; // Skip the source file itself
      if (!depInfo.exists) {
        result.missingImports.push(depPath);
        log(colors.red, '    ✗', `Missing dependency: ${path.relative(srcDir, depPath)}`);
        hasErrors = true;
        binaryHasErrors = true;
      }
      else if (depInfo.missingImports && depInfo.missingImports.length > 0) {
        depInfo.missingImports.forEach((imp) => {
          result.errors.push(`${path.relative(srcDir, depPath)} imports missing module: ${imp}`);
          log(colors.red, '    ✗', `Transitive import failure in ${path.basename(depPath)}: ${imp}`);
          hasErrors = true;
          binaryHasErrors = true;
        });
      }
      else {
        result.imports.push(path.relative(srcDir, depPath));
      }
    }
    if (!binaryHasErrors && result.imports.length > 0) {
      const resolvedImports = result.imports.sort();
      log(colors.green, '  ✓', `All ${resolvedImports.length} dependencies resolved`);
      log(colors.green, '    ↳', `Transitive imports: ${resolvedImports.join(', ')}`);
    }
    validationResults.push(result);
  }
  // Verify that required utility files exist
  const requiredUtilities = [
    'event-aggregator.js',
    'timestamp-tracker.js',
    'progress-stream-utils.js',
    'pi-progress-summarizer.js',
    'instance-state-derivation.js',
    'instance-status-derivation.js',
    'instance-stage-derivation.js',
    'instance-failure-extraction.js',
    'instance-metadata-reader.js',
    'github-app-token.js',
    'github-utils.js',
    'github-app-private-key.js',
    'logger.js',
    'secrets/host-secrets-reader.js',
  ];
  log(colors.blue, '→', 'Checking for required utility files...');
  for (const utility of requiredUtilities) {
    const utilPath = path.resolve(distDir, utility);
    if (!fs.existsSync(utilPath)) {
      log(colors.red, '    ✗', `Missing utility file: ${utility}`);
      hasErrors = true;
    }
    else {
      log(colors.green, '    ✓', `Found: ${utility}`);
    }
  }
  // Summary
  console.log(`\n${colors.bold}Validation Summary${colors.reset}`);
  console.log(`Total binaries checked: ${validationResults.length}`);
  if (hasErrors) {
    log(colors.red, '✗', 'Validation FAILED');
    console.log('\nAction required: Add missing dependencies to Dockerfile.');
    console.log('See Dockerfile COPY commands for dist/ files.');
    process.exit(1);
  }
  else {
    log(colors.green, '✓', 'Validation PASSED - All dependencies resolved');
    process.exit(0);
  }
}
main();
//# sourceMappingURL=validate-module-imports.js.map