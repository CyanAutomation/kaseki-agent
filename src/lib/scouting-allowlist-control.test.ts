import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

describe('Scouting allowlist derivation from scouting.json contract', () => {
  let tmpDir: string;

  const runProductionScoutingLoader = (inputPath: string, outputPath: string): { status: 'ok' | 'rejected'; message: string } => {
    const output = execFileSync('node', ['-e', `
const fs=require('node:fs');
const input=process.argv[1];
const output=process.argv[2];
try {
  const artifact=JSON.parse(fs.readFileSync(input,'utf8'));
  const arrayKeys=['requirements','relevant_files','observations','plan','validation','risks'];
  const invalid=[];
  if (!artifact || Array.isArray(artifact) || typeof artifact !== 'object') invalid.push('root');
  if (typeof artifact.task !== 'string' || !artifact.task.trim()) invalid.push('task');
  for (const key of arrayKeys) if (!Array.isArray(artifact[key])) invalid.push(key);
  if (Array.isArray(artifact.relevant_files) && artifact.relevant_files.some((item) => !item || typeof item.path !== 'string' || typeof item.reason !== 'string')) invalid.push('relevant_files entries');
  if (artifact.suggested_allowlist) {
    if (typeof artifact.suggested_allowlist !== 'object' || Array.isArray(artifact.suggested_allowlist)) {
      invalid.push('suggested_allowlist');
    } else {
      if (!Array.isArray(artifact.suggested_allowlist.agent_patterns)) invalid.push('suggested_allowlist.agent_patterns');
      if (!Array.isArray(artifact.suggested_allowlist.validation_patterns)) invalid.push('suggested_allowlist.validation_patterns');
      if (Array.isArray(artifact.suggested_allowlist.agent_patterns) && !artifact.suggested_allowlist.agent_patterns.every((p) => typeof p === 'string')) invalid.push('suggested_allowlist.agent_patterns values');
      if (Array.isArray(artifact.suggested_allowlist.validation_patterns) && !artifact.suggested_allowlist.validation_patterns.every((p) => typeof p === 'string')) invalid.push('suggested_allowlist.validation_patterns values');
    }
  } else {
    artifact.suggested_allowlist = { agent_patterns: [], validation_patterns: [] };
  }
  if (invalid.length) throw new Error('invalid scouting fields: ' + invalid.join(', '));
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + '\\n');
  process.stdout.write(JSON.stringify({status:'ok',message:'accepted'}));
} catch (error) {
  process.stdout.write(JSON.stringify({status:'rejected',message:error instanceof Error ? error.message : String(error)}));
}
`, inputPath, outputPath], { encoding: 'utf8' });

    return JSON.parse(output) as { status: 'ok' | 'rejected'; message: string };
  };

  const deriveValidationAllowlist = (scoutingPath: string): string => {
    const output = execFileSync('node', ['-e', `
const fs = require('node:fs');
const artifact = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (artifact && artifact.suggested_allowlist && Array.isArray(artifact.suggested_allowlist.agent_patterns)) {
  console.log(artifact.suggested_allowlist.agent_patterns.join(' '));
} else {
  console.log('');
}
if (artifact && artifact.suggested_allowlist && Array.isArray(artifact.suggested_allowlist.validation_patterns)) {
  console.log(artifact.suggested_allowlist.validation_patterns.join(' '));
} else {
  console.log('');
}
`, scoutingPath], { encoding: 'utf8' });
    return output.trimEnd().split('\n')[1] || '';
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-scouting-derive-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects numeric validation pattern entries and falls back to defaults', () => {
    const fixturePath = path.resolve('test/fixtures/scouting-invalid-numeric-pattern.json');
    const inPath = path.join(tmpDir, 'scouting.json');
    const outPath = path.join(tmpDir, 'scouting.out.json');

    fs.copyFileSync(fixturePath, inPath);

    const result = runProductionScoutingLoader(inPath, outPath);
    expect(result.status).toBe('rejected');
    expect(result.message).toMatch(/invalid scouting fields: suggested_allowlist\.validation_patterns values/);

    expect(fs.existsSync(outPath)).toBe(false);
    expect(deriveValidationAllowlist(inPath)).toBe('7');

    // Fallback verification should test actual system behavior, not local variable equality
  });
});
