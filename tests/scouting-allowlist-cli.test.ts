/**
 * Tests for scouting-allowlist.js CLI functionality
 * Verifies that the script works as a command-line tool
 * after converting exported functions to internal
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PROMPT_SHAPE_PLACEHOLDERS = [
  'brief task interpretation',
  'important requirements and constraints',
  'why it matters',
  'ordered coding steps',
  'focused commands or checks to run',
  'uncertainties, edge cases, or assumptions',
  'repo-relative files that must be changed to satisfy the goal; use only when certain',
  'literal strings or diff hunk markers that must appear in git.diff; use only when certain',
  'glob patterns for files the coding agent should modify',
  'glob patterns for files validation commands may touch',
];

function extractScoutingPrompt(scriptText: string): string {
  const match = scriptText.match(/build_scouting_prompt\(\) \{\n  cat <<EOF\n([\s\S]*?)\nEOF\n\}/);
  if (!match) {
    throw new Error('Unable to locate build_scouting_prompt heredoc in kaseki-agent.sh');
  }
  return match[1];
}

describe('scouting-allowlist.js CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('should validate valid scouting artifact', () => {
    const artifact = {
      task: 'refactor parser',
      requirements: ['clean', 'type-safe'],
      relevant_files: [{ path: 'src/parser.ts', reason: 'main implementation' }],
      observations: ['file is large'],
      plan: ['step 1'],
      validation: ['test passed'],
      risks: ['none'],
      test_impact: [{ path: 'tests/parser.test.ts', reason: 'covers parser' }],
    };

    const artifactPath = path.join(tmpDir, 'scouting-candidate.json');
    const outputPath = path.join(tmpDir, 'scouting-output.json');
    fs.writeFileSync(artifactPath, JSON.stringify(artifact));

    // Run validate command
    const output = execSync(
      `node scripts/scouting-allowlist.js validate ${artifactPath} ${outputPath}`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    // Parse output as JSON
    const result = JSON.parse(output.trim());
    expect(result.status).toBe('ok');
    expect(result.reason_code).toBe('valid');
  });

  test('should reject artifact with missing required fields', () => {
    const artifact = {
      // missing task field
      requirements: ['clean'],
    };

    const artifactPath = path.join(tmpDir, 'scouting-candidate.json');
    fs.writeFileSync(artifactPath, JSON.stringify(artifact));

    // Run validate command - it will exit with code 1 for invalid artifact
    let output: string;
    let result: any;
    try {
      output = execSync(`node scripts/scouting-allowlist.js validate ${artifactPath}`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
      result = JSON.parse(output.trim());
    } catch (e: any) {
      // Extract JSON from stderr or stdout
      output = e.stdout || e.message || '';
      if (output.includes('{')) {
        result = JSON.parse(output.match(/\{[\s\S]*\}/)?.[0] || '{}');
      }
    }

    // Verify rejection
    expect(result.status).toBe('rejected');
    expect(['missing_required_fields', 'schema_mismatch']).toContain(result.reason_code);
  });

  test('should reject prompt-shape placeholder scouting content', () => {
    const [
      task,
      requirement,
      reason,
      plan,
      validation,
      risk,
      requiredFile,
      requiredSearchString,
      agentPattern,
      validationPattern,
    ] = PROMPT_SHAPE_PLACEHOLDERS;
    const artifact = {
      task,
      requirements: [requirement],
      relevant_files: [{ path: 'repo-relative path', reason }],
      observations: ['facts learned from repository inspection'],
      plan: [plan],
      validation: [validation],
      risks: [risk],
      test_impact: [],
      critical_change_expectations: {
        required_files: [requiredFile],
        required_search_strings: [requiredSearchString],
        forbidden_empty_diff: true,
      },
      suggested_allowlist: {
        agent_patterns: [agentPattern],
        validation_patterns: [validationPattern],
      },
    };

    const artifactPath = path.join(tmpDir, 'scouting-placeholder.json');
    fs.writeFileSync(artifactPath, JSON.stringify(artifact));

    let result: any;
    try {
      execSync(`node scripts/scouting-allowlist.js validate ${artifactPath}`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
    } catch (e: any) {
      result = JSON.parse(String(e.stdout || '{}'));
    }

    expect(result.status).toBe('rejected');
    expect(result.reason_code).toBe('schema_mismatch');
    expect(result.errors.some((error: any) => error.suggestion.includes('placeholder'))).toBe(true);
  });

  test('build_scouting_prompt should not include rejected placeholder literals', () => {
    const scriptText = fs.readFileSync(path.join(process.cwd(), 'kaseki-agent.sh'), 'utf8');
    const scoutingPrompt = extractScoutingPrompt(scriptText);

    for (const placeholder of PROMPT_SHAPE_PLACEHOLDERS) {
      expect(scoutingPrompt).not.toContain(placeholder);
    }
  });

  test('should derive allowlist from valid artifact', () => {
    const artifact = {
      task: 'refactor parser',
      requirements: [],
      relevant_files: [],
      observations: [],
      plan: [],
      validation: [],
      risks: [],
      test_impact: [],
      suggested_allowlist: {
        agent_patterns: ['src/parser.ts', 'src/ast.ts'],
        validation_patterns: ['tests/parser.test.ts'],
      },
    };

    const artifactPath = path.join(tmpDir, 'scouting-candidate.json');
    fs.writeFileSync(artifactPath, JSON.stringify(artifact));

    // Run derive command
    const output = execSync(`node scripts/scouting-allowlist.js derive ${artifactPath}`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    // Output should be two lines: agent allowlist and validation allowlist
    const lines = output.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('parser.ts');
    expect(lines[1]).toContain('test');
  });

  test('should orchestrate with defaults on invalid artifact', () => {
    const artifact = {
      // Invalid - missing task
      requirements: [],
    };

    const artifactPath = path.join(tmpDir, 'scouting-candidate.json');
    fs.writeFileSync(artifactPath, JSON.stringify(artifact));

    // Run orchestrate command with defaults
    const output = execSync(
      `node scripts/scouting-allowlist.js orchestrate ${artifactPath}`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    // Should return defaults wrapped in result object
    const result = JSON.parse(output.trim());
    expect(result.validation.status).toBe('rejected');
    expect(result.agentAllowlist).toBeDefined();
    expect(result.source).toBe('default_after_rejection');
  });

  test('should show usage on invalid command', () => {
    expect(() => {
      execSync('node scripts/scouting-allowlist.js invalid-command', {
        encoding: 'utf-8',
        cwd: process.cwd(),
        stdio: 'pipe',
      });
    }).toThrow();
  });
});
