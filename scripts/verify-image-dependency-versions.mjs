#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FIXED_VERSIONS = {
  'brace-expansion': {
    1: '1.1.20',
    2: '2.1.6',
    3: '3.0.8',
    5: '5.0.11',
  },
  undici: {
    6: '6.28.1',
    7: '7.29.1',
    8: '8.10.2',
  },
};

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
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

export function findVulnerableDependencyVersions(roots) {
  const findings = [];

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
        const packageFixes = FIXED_VERSIONS[packageJson.name];
        if (!packageFixes) continue;

        const installedMajor = Number.parseInt(packageJson.version?.split('.')[0] ?? '', 10);
        const fixedVersion = packageFixes[installedMajor];
        if (!fixedVersion) continue;

        const comparison = compareVersions(packageJson.version, fixedVersion);
        if (comparison === null || comparison < 0) {
          const relativePath = path.relative(root, entryPath).split(path.sep).join('/');
          findings.push({
            path: path.join(path.basename(root), relativePath).split(path.sep).join('/'),
            name: packageJson.name,
            version: packageJson.version,
            fixedVersion,
          });
        }
      }
    }
  }

  return findings.sort((left, right) => left.path.localeCompare(right.path));
}

export function verifyImageDependencyVersions(roots) {
  if (roots.length === 0) throw new Error('Pass at least one installed node_modules directory to inspect.');
  const findings = findVulnerableDependencyVersions(roots);
  if (findings.length > 0) {
    const details = findings.map(({ path: packagePath, version, fixedVersion }) => (
      `${packagePath}: ${version} (fixed in ${fixedVersion})`
    ));
    throw new Error(`Vulnerable image dependencies remain:\n${details.join('\n')}`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const roots = process.argv.slice(2);
  try {
    verifyImageDependencyVersions(roots);
    process.stdout.write(`No vulnerable brace-expansion or undici versions found under ${roots.join(', ')}.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
