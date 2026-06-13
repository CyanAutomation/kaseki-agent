/**
 * Tests for scouting-allowlist.js CLI functionality
 * Verifies that the script works as a command-line tool
 * after converting exported functions to internal
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
      execSync(`node scripts/scouting-allowlist.js invalid-command`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
        stdio: 'pipe',
      });
    }).toThrow();
  });
});
