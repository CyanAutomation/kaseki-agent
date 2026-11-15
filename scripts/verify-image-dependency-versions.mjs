#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareVersions, dependencyRule } from './image-dependency-rules.mjs';

function* packageManifestPaths(root) {
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== '.bin') {
        directories.push(entryPath);
      } else if (entry.isFile() && entry.name === 'package.json') {
        yield entryPath;
      }
    }
  }
}

function vulnerabilityForPackage(root, entryPath) {
  const packageJson = JSON.parse(readFileSync(entryPath, 'utf8'));
  const installedMajor = Number.parseInt(packageJson.version?.split('.')[0] ?? '', 10);
  const rule = dependencyRule(packageJson.name, installedMajor);
  if (!rule) return undefined;

  const comparison = compareVersions(packageJson.version, rule.fixedVersion);
  if (comparison !== null && comparison >= 0) return undefined;

  const relativePath = path.relative(root, entryPath).split(path.sep).join('/');
  return {
    path: path.join(path.basename(root), relativePath).split(path.sep).join('/'),
    name: packageJson.name,
    version: packageJson.version,
    fixedVersion: rule.fixedVersion,
  };
}

export function findVulnerableDependencyVersions(roots) {
  const findings = [];
  for (const rootArgument of roots) {
    const root = path.resolve(rootArgument);
    for (const entryPath of packageManifestPaths(root)) {
      const finding = vulnerabilityForPackage(root, entryPath);
      if (finding) findings.push(finding);
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
    process.stdout.write(`No vulnerable brace-expansion, handlebars, or undici versions found under ${roots.join(', ')}.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
