#!/usr/bin/env node

import { cpSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FIXED_VERSIONS = {
  'brace-expansion': {
    1: '1.1.20',
    2: '2.1.6',
    5: '5.0.11',
  },
  undici: {
    6: '6.28.1',
    7: '7.29.1',
    8: '8.10.2',
  },
};

// The advisory has no fixed 3.x or 4.x release. Do not hide the finding with
// an automatic major-version replacement; require an explicit compatibility review.
const VULNERABLE_UNPATCHED_MAJORS = {
  'brace-expansion': new Set([3, 4]),
};

const SOURCE_DIRECTORIES = {
  'brace-expansion': {
    1: 'brace-expansion-v1',
    2: 'brace-expansion-v2',
    5: 'brace-expansion',
  },
  undici: {
    6: 'undici-v6',
    7: 'undici-v7',
    8: 'undici',
  },
};

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version ?? '');
  if (!match) return null;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] ?? null,
  };
}

function compareVersions(left, right) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return null;
  for (let index = 0; index < parsedLeft.numbers.length; index += 1) {
    if (parsedLeft.numbers[index] !== parsedRight.numbers[index]) {
      return parsedLeft.numbers[index] < parsedRight.numbers[index] ? -1 : 1;
    }
  }
  if (parsedLeft.prerelease === parsedRight.prerelease) return 0;
  if (parsedLeft.prerelease === null) return 1;
  if (parsedRight.prerelease === null) return -1;
  return parsedLeft.prerelease.localeCompare(parsedRight.prerelease);
}

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

function sourceForPackage(sourcesRoot, packageName, major) {
  const sourceDirectory = SOURCE_DIRECTORIES[packageName]?.[major];
  const fixedVersion = FIXED_VERSIONS[packageName]?.[major];
  if (!sourceDirectory || !fixedVersion) {
    throw new Error(`No fixed source package is configured for ${packageName}@${major}.x`);
  }

  const sourcePath = path.resolve(sourcesRoot, sourceDirectory);
  const sourcePackage = JSON.parse(readFileSync(path.join(sourcePath, 'package.json'), 'utf8'));
  if (sourcePackage.name !== packageName || compareVersions(sourcePackage.version, fixedVersion) < 0) {
    throw new Error(`Replacement source ${sourcePath} must be ${packageName}@${fixedVersion} or newer.`);
  }
  return { sourcePath, fixedVersion };
}

export function patchVulnerableDependencyBundles(sourcesRoot, targetRoots) {
  if (targetRoots.length === 0) throw new Error('Pass at least one installed node_modules directory to patch.');
  const replacements = [];

  for (const installedPackage of packageInventory(targetRoots)) {
    const fixedVersions = FIXED_VERSIONS[installedPackage.name];
    if (!fixedVersions) continue;
    const major = Number.parseInt(installedPackage.version?.split('.')[0], 10);
    const fixedVersion = fixedVersions[major];
    if (!fixedVersion) {
      if (VULNERABLE_UNPATCHED_MAJORS[installedPackage.name]?.has(major)) {
        throw new Error(`${installedPackage.name}@${installedPackage.version} has no patched ${major}.x source.`);
      }
      continue;
    }

    const comparison = compareVersions(installedPackage.version, fixedVersion);
    if (comparison === null) {
      throw new Error(`Cannot compare ${installedPackage.name} version ${installedPackage.version ?? '(missing)'}.`);
    }
    if (comparison >= 0) continue;

    const { sourcePath } = sourceForPackage(sourcesRoot, installedPackage.name, major);
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
