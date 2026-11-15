#!/usr/bin/env node

import { cpSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareVersions, dependencyRule } from './image-dependency-rules.mjs';

function packageInventory(roots) {
  const packages = [];
  for (const rootArgument of roots) {
    const root = path.resolve(rootArgument);
    const directories = [root];
    while (directories.length > 0) {
      const directory = directories.pop();
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory() && entry.name !== '.bin') {
          directories.push(entryPath);
          continue;
        }
        if (!entry.isFile() || entry.name !== 'package.json') continue;
        const packageJson = JSON.parse(readFileSync(entryPath, 'utf8'));
        packages.push({ root, directory: path.dirname(entryPath), ...packageJson });
      }
    }
  }
  return packages;
}

function sourceForPackage(sourcesRoot, packageName, rule) {
  if (!rule.sourceDirectory) {
    throw new Error(`No fixed source package is configured for ${packageName}@${rule.fixedVersion}.`);
  }

  const sourcePath = path.resolve(sourcesRoot, rule.sourceDirectory);
  const sourcePackage = JSON.parse(readFileSync(path.join(sourcePath, 'package.json'), 'utf8'));
  if (sourcePackage.name !== packageName || compareVersions(sourcePackage.version, rule.fixedVersion) < 0) {
    throw new Error(`Replacement source ${sourcePath} must be ${packageName}@${rule.fixedVersion} or newer.`);
  }
  return { sourcePath, fixedVersion: rule.fixedVersion };
}

export function patchVulnerableDependencyBundles(sourcesRoot, targetRoots) {
  if (targetRoots.length === 0) throw new Error('Pass at least one installed node_modules directory to patch.');
  const replacements = [];

  for (const installedPackage of packageInventory(targetRoots)) {
    const major = Number.parseInt(installedPackage.version?.split('.')[0], 10);
    const rule = dependencyRule(installedPackage.name, major);
    if (!rule) continue;
    if (rule.noSameMajorFix) {
      throw new Error(`${installedPackage.name}@${installedPackage.version} has no patched ${major}.x source.`);
    }
    if (!rule.sourceDirectory) {
      continue;
    }

    const comparison = compareVersions(installedPackage.version, rule.fixedVersion);
    if (comparison === null) {
      throw new Error(`Cannot compare ${installedPackage.name} version ${installedPackage.version ?? '(missing)'}.`);
    }
    if (comparison >= 0) continue;

    const { sourcePath } = sourceForPackage(sourcesRoot, installedPackage.name, rule);
    if (path.resolve(installedPackage.directory) === sourcePath) {
      throw new Error(`Vulnerable replacement source found at ${sourcePath}.`);
    }
    replacements.push({
      name: installedPackage.name,
      installedVersion: installedPackage.version,
      directory: installedPackage.directory,
      sourcePath,
    });
  }

  for (const replacement of replacements) {
    rmSync(replacement.directory, { recursive: true, force: true });
    cpSync(replacement.sourcePath, replacement.directory, { recursive: true, force: true });
  }

  return replacements;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [sourcesRoot, ...targetRoots] = process.argv.slice(2);
  try {
    if (!sourcesRoot) throw new Error('Usage: patch-image-dependency-bundles.mjs <sources-node_modules> <target-node_modules...>');
    const replacements = patchVulnerableDependencyBundles(sourcesRoot, targetRoots);
    if (replacements.length === 0) {
      process.stdout.write('No vulnerable bundled brace-expansion or undici copies needed replacement.\n');
    } else {
      for (const replacement of replacements) {
        process.stdout.write(`${replacement.directory}: ${replacement.name}@${replacement.installedVersion} -> ${replacement.name}@${JSON.parse(readFileSync(path.join(replacement.sourcePath, 'package.json'), 'utf8')).version}\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
