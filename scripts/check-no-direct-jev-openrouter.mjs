#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scannedRoots = ['src', 'scripts'];
const standaloneFiles = ['.pi-extensions.js', 'kaseki-agent.sh', 'run-kaseki.sh'];
const banned = [
  { pattern: /openrouter\.ai\/api\/alpha\/decisions/i, label: 'direct OpenRouter JEV endpoint' },
  { pattern: /resolveOpenRouterApiKey|jev-classifier-request|jev-classifier-response/, label: 'retired direct JEV transport module' },
  { pattern: /\bclassifyWithJev\b|\bjev-classifier(?:-types)?\b/i, label: 'retired caller-side JEV classifier shim' },
];
const findings = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath);
      continue;
    }
    if (!/\.(?:[cm]?js|tsx?|sh)$/.test(entry.name) || /(?:\.test\.|\.spec\.|\.integration\.)/.test(entry.name)) continue;
    inspect(entryPath);
  }
}

function inspect(file) {
  if (path.resolve(file) === path.resolve(fileURLToPath(import.meta.url))) return;
  const contents = fs.readFileSync(file, 'utf8');
  for (const rule of banned) {
    if (rule.pattern.test(contents)) findings.push(`${path.relative(root, file)}: ${rule.label}`);
  }
}

for (const relative of scannedRoots) {
  const directory = path.join(root, relative);
  if (fs.existsSync(directory)) walk(directory);
}
for (const relative of standaloneFiles) {
  const file = path.join(root, relative);
  if (fs.existsSync(file)) inspect(file);
}

if (findings.length > 0) {
  process.stderr.write(`Direct JEV/OpenRouter transport remains in active code:\n${findings.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('No active direct JEV/OpenRouter transport found.\n');
}
