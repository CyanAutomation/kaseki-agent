import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

describe('Scouting allowlist parsing and ingestion', () => {
  let tmpDir: string;

  const canonicalizeScoutingArtifact = (inputPath: string, outputPath: string): void => {
    execFileSync('node', ['-e', `
const fs=require('node:fs');
const input=process.argv[1];
const output=process.argv[2];
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
fs.writeFileSync(output, JSON.stringify(artifact, null, 2));
`, inputPath, outputPath], { stdio: 'pipe' });
  };

  const deriveAllowlistFromScouting = (scoutingPath: string): { agent: string; validation: string } => {
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
    const lines = output.trimEnd().split('\n');
    const agent = lines[0] || '';
    const validation = lines[1] || '';
    return { agent, validation };
    return { agent, validation };
  };



  const runProductionScoutingLoader = (inputPath: string, outputPath: string): { status: number; stderr: string } => {
    const loaderScriptPath = path.resolve(__dirname, '../../kaseki-agent.sh');
    const extraction = spawnSync('node', ['-e', `
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[1], 'utf8');
const start = source.indexOf('const fs=require("node:fs");');
const endMarker = 'if (invalid.length) throw new Error("invalid scouting fields: " + invalid.join(", "));';
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('unable to locate scouting loader in kaseki-agent.sh');
const loader = source.slice(start, end + endMarker.length) + '\\nfs.writeFileSync(output, JSON.stringify(artifact, null, 2) + \"\\\\n\");';
process.stdout.write(loader);
`, loaderScriptPath], { encoding: 'utf8' });

    if (extraction.status !== 0) {
      throw new Error(`failed to extract production scouting loader: ${extraction.stderr}`);
    }

    const result = spawnSync('node', ['-e', extraction.stdout, inputPath, outputPath], { encoding: 'utf8' });
    return { status: result.status ?? 1, stderr: result.stderr };
  };

  const mergeAllowlists = (scoutingPatterns: string, userPatterns: string): string => {
    return execFileSync('bash', ['-lc', `
scouting_patterns="$1"; user_patterns="$2";
if [ -n "$scouting_patterns" ] && [ -n "$user_patterns" ]; then
  printf '%s' "$scouting_patterns $user_patterns"
elif [ -n "$scouting_patterns" ]; then
  printf '%s' "$scouting_patterns"
elif [ -n "$user_patterns" ]; then
  printf '%s' "$user_patterns"
fi
`, '--', scoutingPatterns, userPatterns], { encoding: 'utf8' });
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-allowlist-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts valid suggested_allowlist and derives both allowlists', () => {
    const inputPath = path.join(tmpDir, 'scouting.valid.json');
    const outputPath = path.join(tmpDir, 'scouting.out.json');
    fs.writeFileSync(inputPath, JSON.stringify({
      task: 'Fix parser bug',
      requirements: ['Fix parse error'],
      relevant_files: [{ path: 'src/parser.ts', reason: 'contains bug' }],
      observations: ['repro in parser'],
      plan: ['patch parser'],
      validation: ['npm test'],
      risks: ['regression risk'],
      suggested_allowlist: {
        agent_patterns: ['src/parser.ts', 'tests/parser.test.ts'],
        validation_patterns: ['src/**', 'tests/**'],
      },
    }));

    canonicalizeScoutingArtifact(inputPath, outputPath);
    const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    const derived = deriveAllowlistFromScouting(outputPath);

    expect(parsed.suggested_allowlist.agent_patterns).toEqual(['src/parser.ts', 'tests/parser.test.ts']);
    expect(derived.agent).toBe('src/parser.ts tests/parser.test.ts');
    expect(derived.validation).toBe('src/** tests/**');
  });

  it('rejects invalid numeric allowlist patterns via production loader and falls back to empty derived patterns', () => {
    const fixturePath = path.resolve(__dirname, '../../tests/fixtures/scouting/invalid-numeric-pattern.json');
    const inputPath = path.join(tmpDir, 'scouting.invalid.json');
    const outputPath = path.join(tmpDir, 'scouting.out.json');
    fs.copyFileSync(fixturePath, inputPath);

    const result = runProductionScoutingLoader(inputPath, outputPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('invalid scouting fields: suggested_allowlist.agent_patterns values');
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('applies default empty allowlist when suggested_allowlist is missing', () => {
    const inputPath = path.join(tmpDir, 'scouting.missing-allowlist.json');
    const outputPath = path.join(tmpDir, 'scouting.out.json');
    fs.writeFileSync(inputPath, JSON.stringify({
      task: 'Fix parser bug',
      requirements: [],
      relevant_files: [],
      observations: [],
      plan: [],
      validation: [],
      risks: [],
    }));

    canonicalizeScoutingArtifact(inputPath, outputPath);
    const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    const derived = deriveAllowlistFromScouting(outputPath);

    expect(parsed.suggested_allowlist).toEqual({ agent_patterns: [], validation_patterns: [] });
    expect(derived.agent).toBe('');
    expect(derived.validation).toBe('');
  });

  it('merges scouting and user allowlists through CLI ingestion semantics', () => {
    expect(mergeAllowlists('src/parser.ts tests/parser.test.ts', 'src/**')).toBe('src/parser.ts tests/parser.test.ts src/**');
    expect(mergeAllowlists('README.md docs/**', '')).toBe('README.md docs/**');
    expect(mergeAllowlists('', 'src/**')).toBe('src/**');
  });
});
