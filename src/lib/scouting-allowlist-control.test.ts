import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

type ScoutingAllowlistOrchestrationResult = {
  validation: {
    status: 'ok' | 'rejected';
    reason_code: string;
    details: string;
    errors: Array<{
      field: string;
      expected: string;
      actual: string;
      severity: 'critical' | 'warning';
      suggestion: string;
    }>;
  };
  agentAllowlist: string;
  validationAllowlist: string;
  source: string;
};

const DEFAULT_CHANGED_FILES_ALLOWLIST = 'src/lib/parser.ts tests/parser.validation.ts';
const DEFAULT_VALIDATION_ALLOWLIST = '';
const scoutingAllowlistEntryPoint = path.resolve('dist/scouting-allowlist.js');

const runProductionScoutingAllowlistOrchestration = (inputPath: string): ScoutingAllowlistOrchestrationResult => {
  const output = execFileSync('node', [
    scoutingAllowlistEntryPoint,
    'orchestrate',
    inputPath,
    DEFAULT_CHANGED_FILES_ALLOWLIST,
    DEFAULT_VALIDATION_ALLOWLIST,
  ], { encoding: 'utf8' });

  return JSON.parse(output) as ScoutingAllowlistOrchestrationResult;
};

describe('Scouting allowlist derivation from scouting.json contract', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-scouting-derive-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects numeric suggested_allowlist.validation_patterns entries with a semantic scouting.json contract error', () => {
    const fixturePath = path.resolve('test/fixtures/scouting-invalid-numeric-pattern.json');
    const inPath = path.join(tmpDir, 'scouting.json');

    fs.copyFileSync(fixturePath, inPath);

    const result = runProductionScoutingAllowlistOrchestration(inPath);

    expect(result.validation.status).toBe('rejected');
    expect(result.validation.reason_code).toBe('schema_mismatch');
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'suggested_allowlist.validation_patterns',
        expected: 'array of strings',
        actual: 'array with non-strings',
        severity: 'warning',
        suggestion: 'All validation_patterns entries must be strings',
      }),
    ]));
  });

  it('rejects numeric suggested_allowlist.agent_patterns entries with a string-type contract error', () => {
    const inPath = path.join(tmpDir, 'scouting-numeric-agent-pattern.json');
    fs.writeFileSync(inPath, JSON.stringify({
      task: 'Update parser',
      requirements: [],
      relevant_files: [],
      observations: [], plan: [], validation: [], risks: [], test_impact: [],
      suggested_allowlist: {
        agent_patterns: ['src/**', 42],
        validation_patterns: ['tests/**'],
      },
    }) + '\n');

    const result = runProductionScoutingAllowlistOrchestration(inPath);

    expect(result.validation.status).toBe('rejected');
    expect(result.validation.reason_code).toBe('schema_mismatch');
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'suggested_allowlist.agent_patterns',
        expected: 'array of strings',
        actual: 'array with non-strings',
        severity: 'warning',
        suggestion: 'All agent_patterns entries must be strings',
      }),
    ]));
  });

  it('retains the repo-relative-glob diagnostic for invalid validation pattern strings', () => {
    const inPath = path.join(tmpDir, 'scouting-invalid-validation-glob.json');
    fs.writeFileSync(inPath, JSON.stringify({
      task: 'Update parser',
      requirements: [],
      relevant_files: [],
      observations: [], plan: [], validation: [], risks: [], test_impact: [],
      suggested_allowlist: {
        agent_patterns: ['src/**'],
        validation_patterns: ['npm test'],
      },
    }) + '\n');

    const result = runProductionScoutingAllowlistOrchestration(inPath);

    expect(result.validation.status).toBe('rejected');
    expect(result.validation.reason_code).toBe('schema_mismatch');
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'suggested_allowlist.validation_patterns',
        expected: 'array of repo-relative glob strings',
        actual: 'array with invalid glob patterns',
        severity: 'warning',
      }),
    ]));
  });

  it('rejects prose allowlist entries before they can restrict the coding agent', () => {
    const inPath = path.join(tmpDir, 'scouting-prose-allowlist.json');
    fs.writeFileSync(inPath, JSON.stringify({
      task: 'Update development documentation',
      requirements: [],
      relevant_files: [{ path: 'docs/DEVELOPMENT.md', reason: 'target documentation' }],
      observations: [], plan: [], validation: [], risks: [], test_impact: [],
      suggested_allowlist: {
        agent_patterns: ['kaseki-agent init', 'OPENROUTER_API_KEY_FILE'],
        validation_patterns: ['docs/**'],
      },
    }) + '\n');

    const result = runProductionScoutingAllowlistOrchestration(inPath);

    expect(result.validation.status).toBe('rejected');
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'suggested_allowlist.agent_patterns',
        expected: 'array of repo-relative glob strings',
      }),
    ]));
    expect(result.source).toBe('default_after_rejection');
  });

  it('rejects prose appended to a relevant file path', () => {
    const inPath = path.join(tmpDir, 'scouting-prose-path.json');
    fs.writeFileSync(inPath, JSON.stringify({
      task: 'Update development documentation',
      requirements: [],
      relevant_files: [{ path: 'docs/DEVELOPMENT.md - target file', reason: 'target documentation' }],
      observations: [], plan: [], validation: [], risks: [], test_impact: [],
    }) + '\n');

    const result = runProductionScoutingAllowlistOrchestration(inPath);
    expect(result.validation.status).toBe('rejected');
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'relevant_files[0]', severity: 'critical' }),
    ]));
  });

  // Contract reference: docs/ADVANCED_CONFIG.md documents that scouting suggested allowlists
  // are merged with KASEKI_CHANGED_FILES_ALLOWLIST/KASEKI_VALIDATION_ALLOWLIST, whose
  // production script defaults are src/lib/parser.ts tests/parser.validation.ts and empty.
  it.each([
    ['rejected suggested allowlist', () => path.resolve('test/fixtures/scouting-invalid-numeric-pattern.json'), 'default_after_rejection', 'rejected', 'schema_mismatch'],
    ['absent suggested allowlist', () => {
      const inPath = path.join(tmpDir, 'scouting-without-suggested-allowlist.json');
      fs.writeFileSync(inPath, JSON.stringify({
        task: 'inspect',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        test_impact: [],
      }, null, 2) + '\n');
      return inPath;
    }, 'default_after_absent_suggestion', 'ok', 'valid'],
  ] as const)('uses the documented default allowlist when %s reaches the real orchestration path', (_name, arrangeInput, expectedSource, expectedStatus, expectedReasonCode) => {
    const result = runProductionScoutingAllowlistOrchestration(arrangeInput());

    expect(result.validation.status).toBe(expectedStatus);
    expect(result.validation.reason_code).toBe(expectedReasonCode);
    expect(result.source).toBe(expectedSource);
    expect(result.agentAllowlist).toBe(DEFAULT_CHANGED_FILES_ALLOWLIST);
    expect(result.validationAllowlist).toBe(DEFAULT_VALIDATION_ALLOWLIST);
  });
});
