/**
 * Unit tests for artifact-recovery recovery logic
 * Tests JSON object collection, validation, and recovery strategies via CLI
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('artifact-recovery CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-recovery-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function runCli(args: string[]) {
    return spawnSync(path.join(process.cwd(), 'node_modules/.bin/tsx'), ['scripts/artifact-recovery.ts', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
  }

  describe('recoverArtifactFromEventStream', () => {
    test('recovers valid goal-setting artifact from event stream', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');

      const validArtifact = {
        original_prompt: 'Fix the parser',
        upgraded_goal: 'Refactor parser to use async/await',
        reasoning: 'Current parser uses callbacks which are hard to test',
        key_requirements: ['maintain API', 'add async support', 'improve error handling'],
        success_criteria: ['all tests pass', 'no performance regression'],
      };

      // Write event stream with valid goal-setting artifact
      fs.writeFileSync(rawEventsPath, JSON.stringify({ event: 'progress' }) + '\n');
      fs.appendFileSync(rawEventsPath, JSON.stringify(validArtifact) + '\n');
      fs.appendFileSync(rawEventsPath, JSON.stringify({ event: 'done' }) + '\n');

      const result = runCli(['goal-setting', rawEventsPath, candidatePath, tmpDir]);

      expect(result.status).toBe(0);
      expect(fs.existsSync(candidatePath)).toBe(true);

      const recovered = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      expect(recovered.original_prompt).toBe('Fix the parser');
      expect(recovered.upgraded_goal).toBe('Refactor parser to use async/await');
      expect(recovered.key_requirements).toHaveLength(3);
    });

    test('recovers valid scouting artifact from event stream (strict mode)', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');

      const validArtifact = {
        task: 'Add pagination support to list endpoint',
        requirements: ['Support offset/limit', 'Return total count'],
        relevant_files: ['src/api/list-routes.ts', 'src/db/queries.ts'],
        observations: ['Current implementation is O(n)', 'Need index on created_at'],
        plan: ['Add offset/limit params', 'Update database query', 'Add tests'],
        validation: ['Manual pagination test', 'Performance benchmark'],
        risks: ['Backward compatibility', 'Database migration'],
        test_impact: ['Add 3 new integration tests'],
      };

      fs.writeFileSync(rawEventsPath, JSON.stringify(validArtifact) + '\n');

      const result = runCli(['scouting', rawEventsPath, candidatePath, tmpDir]);

      expect(result.status).toBe(0);
      const recovered = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      expect(recovered.task).toBe('Add pagination support to list endpoint');
      expect(recovered.requirements).toHaveLength(2);
    });

    test('fails gracefully when no valid artifact found in goal-setting', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');

      // Write incomplete/invalid artifacts
      fs.writeFileSync(rawEventsPath, JSON.stringify({ original_prompt: 'missing other fields' }) + '\n');
      fs.appendFileSync(rawEventsPath, JSON.stringify({ upgraded_goal: 'incomplete' }) + '\n');

      const result = runCli(['goal-setting', rawEventsPath, candidatePath, tmpDir]);

      expect(result.status).toBe(1);
      expect(fs.existsSync(candidatePath)).toBe(false);
    });

    test('recovers partial scouting artifact when strict validation fails', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');

      // Partial artifact missing some required fields (not strict-valid)
      const partialArtifact = {
        task: 'Fix bug in parser',
        requirements: ['Must maintain backward compat'],
        // Missing: relevant_files, observations, plan, validation, risks, test_impact
      };

      fs.writeFileSync(rawEventsPath, JSON.stringify(partialArtifact) + '\n');

      const result = runCli(['scouting', rawEventsPath, candidatePath, tmpDir]);

      expect(result.status).toBe(0);
      const recovered = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      expect(recovered.task).toBe('Fix bug in parser');
      expect(recovered.requirements).toHaveLength(1);
    });

    test('selects best candidate when multiple valid scouting artifacts exist', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');

      // First artifact (partial)
      const partial1 = {
        task: 'First task',
        requirements: ['req1'],
      };

      // Second artifact (more complete)
      const partial2 = {
        task: 'Second task',
        requirements: ['req1', 'req2'],
        relevant_files: ['file1.ts', 'file2.ts'],
        observations: ['obs1'],
        plan: ['step1', 'step2'],
        validation: ['check1'],
        risks: ['risk1'],
        test_impact: ['test1'],
      };

      fs.writeFileSync(rawEventsPath, JSON.stringify(partial1) + '\n');
      fs.appendFileSync(rawEventsPath, JSON.stringify(partial2) + '\n');

      const result = runCli(['scouting', rawEventsPath, candidatePath, tmpDir]);

      expect(result.status).toBe(0);
      const recovered = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      // Should select the more complete one (partial2)
      expect(recovered.task).toBe('Second task');
      expect(Object.keys(recovered).length).toBeGreaterThan(2);
    });

    test('handles nested JSON objects within event strings', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');

      const validArtifact = {
        original_prompt: 'Refactor code',
        upgraded_goal: 'Make it async',
        reasoning: 'Better performance',
        key_requirements: ['speed', 'compatibility'],
        success_criteria: ['passes tests'],
      };

      // Write with embedded JSON string (common in logs)
      const eventWithEmbedded = {
        event: 'artifact_found',
        data: JSON.stringify(validArtifact),
      };

      fs.writeFileSync(rawEventsPath, JSON.stringify(eventWithEmbedded) + '\n');

      const result = runCli(['goal-setting', rawEventsPath, candidatePath, tmpDir]);

      expect(result.status).toBe(0);
      const recovered = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      expect(recovered.original_prompt).toBe('Refactor code');
    });

    test('handles malformed JSON gracefully', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');

      const validArtifact = {
        original_prompt: 'Fix bug',
        upgraded_goal: 'Implement feature',
        reasoning: 'User requested',
        key_requirements: [],
        success_criteria: [],
      };

      // Mix valid JSON with non-JSON content interspersed
      fs.writeFileSync(rawEventsPath, 'not json at all\n');
      fs.appendFileSync(rawEventsPath, JSON.stringify(validArtifact) + '\n');
      fs.appendFileSync(rawEventsPath, 'more garbage text\n');
      fs.appendFileSync(rawEventsPath, 'even more noise\n');

      const result = runCli(['goal-setting', rawEventsPath, candidatePath, tmpDir]);

      expect(result.status).toBe(0);
      const recovered = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      expect(recovered.original_prompt).toBe('Fix bug');
    });

    test('returns error when raw events file does not exist', () => {
      const candidatePath = path.join(tmpDir, 'candidate.json');

      const result = runCli(['goal-setting', path.join(tmpDir, 'nonexistent.jsonl'), candidatePath, tmpDir]);

      expect(result.status).toBe(1);
      expect(fs.existsSync(candidatePath)).toBe(false);
    });

    test('handles special characters in JSON strings', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');

      const validArtifact = {
        original_prompt: 'Fix "parser" error: it\'s broken with special chars',
        upgraded_goal: 'Implement async parser with "strict" mode',
        reasoning: 'Needed because quotes matter',
        key_requirements: [],
        success_criteria: [],
      };

      fs.writeFileSync(rawEventsPath, JSON.stringify(validArtifact) + '\n');

      const result = runCli(['goal-setting', rawEventsPath, candidatePath, tmpDir]);

      expect(result.status).toBe(0);
      const recovered = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      expect(recovered.original_prompt).toContain('parser');
      expect(recovered.upgraded_goal).toContain('async');
    });

    test('creates diagnostic log when recovery succeeds', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');
      const diagnosticPath = path.join(tmpDir, 'scouting-recovery-diagnostics.jsonl');

      const validArtifact = {
        task: 'Implement feature',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        test_impact: [],
      };

      fs.writeFileSync(rawEventsPath, JSON.stringify(validArtifact) + '\n');

      runCli(['scouting', rawEventsPath, candidatePath, tmpDir]);

      expect(fs.existsSync(diagnosticPath)).toBe(true);
      const diagnosticLines = fs.readFileSync(diagnosticPath, 'utf8').trim().split('\n');
      expect(diagnosticLines.length).toBeGreaterThan(0);

      const lastEvent = JSON.parse(diagnosticLines[diagnosticLines.length - 1]);
      expect(lastEvent.event).toBe('artifact_recovery');
      expect(lastEvent.recovery_success).toBe(true);
    });

    test('creates diagnostic log when recovery fails', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');
      const diagnosticPath = path.join(tmpDir, 'scouting-recovery-diagnostics.jsonl');

      fs.writeFileSync(rawEventsPath, 'not valid json\n');

      runCli(['scouting', rawEventsPath, candidatePath, tmpDir]);

      expect(fs.existsSync(diagnosticPath)).toBe(true);
      const lastEvent = JSON.parse(fs.readFileSync(diagnosticPath, 'utf8').trim().split('\n').pop()!);
      expect(lastEvent.recovery_success).toBe(false);
    });

    test('returns usage error when required arguments missing', () => {
      const result = runCli([]);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Usage:');
    });

    test('returns usage error for invalid phase', () => {
      const candidatePath = path.join(tmpDir, 'candidate.json');
      const result = runCli(['invalid-phase', path.join(tmpDir, 'events.jsonl'), candidatePath]);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Usage:');
    });
  });
});
