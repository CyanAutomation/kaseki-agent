import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import semver from 'semver';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const engineRange = packageJson.engines?.node;

if (!engineRange || !semver.validRange(engineRange)) {
  throw new Error(`package.json engines.node is missing or invalid: ${engineRange ?? '<missing>'}`);
}

const configuredVersions = [];
const workflowDirectory = path.join(root, '.github', 'workflows');
const workflowNames = (await readdir(workflowDirectory)).filter((name) => /\.ya?ml$/.test(name));

for (const name of workflowNames) {
  const relativePath = path.posix.join('.github', 'workflows', name);
  const content = await readFile(path.join(workflowDirectory, name), 'utf8');
  const environmentValues = new Map();

  for (const match of content.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*['"]?([^'"#\n]+?)['"]?\s*(?:#.*)?$/gm)) {
    const [, key, value] = match;
    if (environmentValues.has(key) && environmentValues.get(key) !== value.trim()) {
      throw new Error(`${relativePath} assigns conflicting values to ${key}`);
    }
    environmentValues.set(key, value.trim());
  }

  for (const match of content.matchAll(/^\s*node-version:\s*(.+?)\s*(?:#.*)?$/gm)) {
    let value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
    const environmentReference = value.match(/^\$\{\{\s*env\.([A-Z][A-Z0-9_]*)\s*\}\}$/);
    if (environmentReference) {
      const variableName = environmentReference[1];
      value = environmentValues.get(variableName);
      if (!value) {
        throw new Error(`${relativePath} references unresolved env.${variableName} as a Node version`);
      }
    }
    configuredVersions.push({ source: relativePath, value });
  }
}

const dockerfile = await readFile(path.join(root, 'Dockerfile'), 'utf8');
const dockerNodeImage = dockerfile.match(/^ARG\s+NODE_IMAGE=node:([^\s-]+)/m);
if (!dockerNodeImage) {
  throw new Error('Dockerfile must declare ARG NODE_IMAGE=node:<version>');
}
configuredVersions.push({ source: 'Dockerfile (NODE_IMAGE)', value: dockerNodeImage[1] });

if (configuredVersions.length === 0) {
  throw new Error('No repository-owned CI Node versions were found');
}

const failures = configuredVersions.filter(({ value }) => {
  const configuredRange = semver.validRange(value);
  return !configuredRange || !semver.subset(configuredRange, engineRange);
});

if (failures.length > 0) {
  const details = failures.map(({ source, value }) => `  - ${source}: ${value}`).join('\n');
  throw new Error(`Node versions must satisfy package.json engines.node (${engineRange}):\n${details}`);
}

for (const { source, value } of configuredVersions) {
  console.log(`OK ${source}: Node ${value} satisfies ${engineRange}`);
}
