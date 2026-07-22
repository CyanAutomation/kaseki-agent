/**
 * Unit tests for artifact-recovery recovery logic
 * Tests JSON object collection, validation, and recovery strategies via CLI
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  stableStringify,
  collectBalancedJsonObjects,
  collectStrings,
  isRecord,
  goalSettingSchemaErrors,
  scoutingSchemaErrors,
  logScoutingRecoveryDiagnostic,
  recoverArtifactFromEventStream,
  runRecoveryCliFromArgs,
} from './artifact-recovery';

describe('artifact-recovery helper functions (direct unit tests)', () => {
  describe('stableStringify', () => {
    test('produces stable output with sorted keys', () => {
      const obj1 = { z: 1, a: 2, m: 3 };
      const obj2 = { a: 2, z: 1, m: 3 };
      expect(stableStringify(obj1)).toBe(stableStringify(obj2));
    });

    test('handles nested objects with sorted keys', () => {
      const obj1 = { outer: { z: 1, a: 2 }, b: 3 };
      const obj2 = { outer: { a: 2, z: 1 }, b: 3 };
      expect(stableStringify(obj1)).toBe(stableStringify(obj2));
    });

    test('produces deterministic output for identical objects', () => {
      const obj = { c: 3, a: 1, b: 2 };
      const result1 = stableStringify(obj);
      const result2 = stableStringify(obj);
      expect(result1).toBe(result2);
    });

    test('handles arrays correctly', () => {
      const obj = { items: [1, 2, 3], name: 'test' };
      const result = stableStringify(obj);
      expect(result).toContain('"items"');
      expect(result).toContain('"name"');
    });

    test('handles empty objects and arrays', () => {
      expect(stableStringify({})).toBe('{}');
      expect(stableStringify({ arr: [] })).toBe('{"arr":[]}');
    });
  });

  describe('collectBalancedJsonObjects', () => {
    test('extracts single top-level JSON object', () => {
      const text = '{"key":"value"}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('{"key":"value"}');
    });

    test('extracts multiple top-level JSON objects', () => {
      const text = '{"a":1}{"b":2}{"c":3}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(3);
    });

    test('handles objects separated by whitespace', () => {
      const text = '{"a":1}\n  \n{"b":2}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(2);
    });

    test('ignores non-JSON text before and after objects', () => {
      const text = 'garbage text {"a":1} more garbage';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('{"a":1}');
    });

    test('handles escaped quotes in strings', () => {
      const text = '{"msg":"He said \\"hello\\""}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });

    test('handles nested objects', () => {
      const text = '{"outer":{"inner":"value"}}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });

    test('handles deeply nested objects', () => {
      const text = '{"a":{"b":{"c":{"d":1}}}}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });

    test('ignores incomplete/mismatched braces', () => {
      const text = '{"complete":1}incomplete{broken';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('{"complete":1}');
    });

    test('handles escaped backslashes followed by quotes', () => {
      const text = '{"path":"C:\\\\Users\\\\name","ok":true}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
    });

    test('handles objects with arrays', () => {
      const text = '{"items":[1,2,3],"nested":{"arr":[{"a":1}]}}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
    });

    test('handles empty objects and arrays', () => {
      const text = '{"empty":{},"arr":[]}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
    });

    test('handles strings with special characters', () => {
      const text = '{"special":"line1\\nline2\\ttab"}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
    });

    test('returns empty array for text with no braces', () => {
      const text = 'just plain text with no braces at all';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(0);
    });

    test('extracts text with unmatched brace pairs as-is', () => {
      const text = 'just plain text with { or } matching';
      const result = collectBalancedJsonObjects(text);
      // Function extracts balanced braces from 'start' to 'end', so this will match
      expect(result.length).toBeGreaterThan(0);
    });

    test('returns empty array for empty string', () => {
      const result = collectBalancedJsonObjects('');
      expect(result).toHaveLength(0);
    });

    test('handles very large objects', () => {
      const largeObj = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })) };
      const text = JSON.stringify(largeObj);
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
      expect(JSON.parse(result[0])).toEqual(largeObj);
    });

    test('handles unicode characters in strings', () => {
      const text = '{"emoji":"😀🎉","chinese":"你好","arabic":"مرحبا"}';
      const result = collectBalancedJsonObjects(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });
  });

  describe('collectStrings', () => {
    test('collects strings from flat object', () => {
      const obj = { a: 'hello', b: 'world' };
      const result = collectStrings(obj);
      expect(result).toContain('hello');
      expect(result).toContain('world');
    });

    test('collects strings from nested object', () => {
      const obj = { outer: { inner: 'value' } };
      const result = collectStrings(obj);
      expect(result).toContain('value');
    });

    test('collects strings from arrays', () => {
      const obj = { items: ['a', 'b', 'c'] };
      const result = collectStrings(obj);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    test('collects strings from deeply nested structures', () => {
      const obj = { a: [{ b: { c: ['deep'] } }] };
      const result = collectStrings(obj);
      expect(result).toContain('deep');
    });

    test('ignores non-string values', () => {
      const obj = { str: 'hello', num: 42, bool: true, nil: null };
      const result = collectStrings(obj);
      expect(result).toEqual(['hello']);
    });

    test('returns empty array for objects with no strings', () => {
      const obj = { a: 1, b: [2, 3], c: { d: null } };
      const result = collectStrings(obj);
      expect(result).toHaveLength(0);
    });

    test('handles string input directly', () => {
      const result = collectStrings('test');
      expect(result).toContain('test');
    });

    test('handles array of strings', () => {
      const result = collectStrings(['a', 'b', 'c']);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    test('accumulates into provided array', () => {
      const out: string[] = ['initial'];
      const result = collectStrings({ val: 'added' }, out);
      expect(result).toEqual(['initial', 'added']);
      expect(result).toBe(out); // Same reference
    });

    test('handles mixed nested structures', () => {
      const obj = {
        level1: {
          level2: ['nested', { level3: 'deep' }],
          other: 123,
        },
      };
      const result = collectStrings(obj);
      expect(result).toContain('nested');
      expect(result).toContain('deep');
      expect(result).not.toContain('123');
    });
  });

  describe('isRecord', () => {
    test('returns true for plain objects', () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ key: 'value' })).toBe(true);
    });

    test('returns false for arrays', () => {
      expect(isRecord([])).toBe(false);
      expect(isRecord([1, 2, 3])).toBe(false);
    });

    test('returns false for primitives', () => {
      expect(isRecord('string')).toBe(false);
      expect(isRecord(123)).toBe(false);
      expect(isRecord(true)).toBe(false);
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
    });

    test('returns false for functions', () => {
      expect(isRecord(() => {})).toBe(false);
    });

    test('returns true for nested objects', () => {
      expect(isRecord({ nested: { obj: 1 } })).toBe(true);
    });

    test('returns true for objects with mixed properties', () => {
      expect(isRecord({ str: 'val', num: 42, arr: [1, 2], obj: {} })).toBe(true);
    });
  });

  describe('goalSettingSchemaErrors', () => {
    test('returns no errors for valid goal-setting artifact', () => {
      const artifact = {
        original_prompt: 'Fix bug',
        upgraded_goal: 'Implement feature',
        reasoning: 'Better design',
        key_requirements: ['req1'],
        success_criteria: ['pass tests'],
      };
      expect(goalSettingSchemaErrors(artifact)).toHaveLength(0);
    });

    test('returns error for non-object artifact', () => {
      expect(goalSettingSchemaErrors('string')).toContain('root must be an object');
      expect(goalSettingSchemaErrors(null)).toContain('root must be an object');
      expect(goalSettingSchemaErrors([1, 2, 3])).toContain('root must be an object');
    });

    test('returns error for missing original_prompt', () => {
      const artifact = { upgraded_goal: 'goal', reasoning: 'reason', key_requirements: [], success_criteria: [] };
      expect(goalSettingSchemaErrors(artifact)).toContain('original_prompt must be non-empty string');
    });

    test('returns error for empty original_prompt string', () => {
      const artifact = {
        original_prompt: '',
        upgraded_goal: 'goal',
        reasoning: 'reason',
        key_requirements: [],
        success_criteria: [],
      };
      expect(goalSettingSchemaErrors(artifact)).toContain('original_prompt must be non-empty string');
    });

    test('returns error for non-string original_prompt', () => {
      const artifact = {
        original_prompt: 123,
        upgraded_goal: 'goal',
        reasoning: 'reason',
        key_requirements: [],
        success_criteria: [],
      };
      expect(goalSettingSchemaErrors(artifact)).toContain('original_prompt must be non-empty string');
    });

    test('returns error for missing upgraded_goal', () => {
      const artifact = {
        original_prompt: 'prompt',
        reasoning: 'reason',
        key_requirements: [],
        success_criteria: [],
      };
      expect(goalSettingSchemaErrors(artifact)).toContain('upgraded_goal must be non-empty string');
    });

    test('returns error for missing reasoning', () => {
      const artifact = {
        original_prompt: 'prompt',
        upgraded_goal: 'goal',
        key_requirements: [],
        success_criteria: [],
      };
      expect(goalSettingSchemaErrors(artifact)).toContain('reasoning must be non-empty string');
    });

    test('returns error for non-array key_requirements', () => {
      const artifact = {
        original_prompt: 'prompt',
        upgraded_goal: 'goal',
        reasoning: 'reason',
        key_requirements: 'not an array',
        success_criteria: [],
      };
      expect(goalSettingSchemaErrors(artifact)).toContain('key_requirements must be array');
    });

    test('returns error for non-array success_criteria', () => {
      const artifact = {
        original_prompt: 'prompt',
        upgraded_goal: 'goal',
        reasoning: 'reason',
        key_requirements: [],
        success_criteria: { invalid: 'object' },
      };
      expect(goalSettingSchemaErrors(artifact)).toContain('success_criteria must be array');
    });

    test('returns multiple errors for multiple missing fields', () => {
      const artifact = {};
      const errors = goalSettingSchemaErrors(artifact);
      expect(errors.length).toBeGreaterThan(2);
    });

    test('allows empty arrays in key_requirements and success_criteria', () => {
      const artifact = {
        original_prompt: 'prompt',
        upgraded_goal: 'goal',
        reasoning: 'reason',
        key_requirements: [],
        success_criteria: [],
      };
      expect(goalSettingSchemaErrors(artifact)).toHaveLength(0);
    });
  });

  describe('scoutingSchemaErrors', () => {
    const validArtifact = {
      task: 'Do something',
      requirements: ['req1'],
      relevant_files: ['file.ts'],
      observations: ['obs1'],
      plan: ['step1'],
      validation: ['check1'],
      risks: ['risk1'],
      test_impact: ['impact1'],
    };

    test('returns no errors for valid scouting artifact in strict mode', () => {
      expect(scoutingSchemaErrors(validArtifact, true)).toHaveLength(0);
    });

    test('returns no errors for valid scouting artifact in non-strict mode', () => {
      expect(scoutingSchemaErrors(validArtifact, false)).toHaveLength(0);
    });

    test('returns error for non-object artifact', () => {
      expect(scoutingSchemaErrors('string')).toContain('root must be an object');
      expect(scoutingSchemaErrors(null)).toContain('root must be an object');
    });

    test('returns error for missing task field', () => {
      const artifact = { requirements: [] };
      expect(scoutingSchemaErrors(artifact)).toContain('task must be non-empty string');
    });

    test('returns error for empty task string', () => {
      const artifact = { task: '' };
      expect(scoutingSchemaErrors(artifact)).toContain('task must be non-empty string');
    });

    test('returns only task error in non-strict mode for missing arrays', () => {
      const artifact = { task: 'Valid task' };
      const errors = scoutingSchemaErrors(artifact, false);
      expect(errors).toHaveLength(0);
    });

    test('returns array field errors in strict mode', () => {
      const artifact = { task: 'task', requirements: 'not array' };
      const errors = scoutingSchemaErrors(artifact, true);
      expect(errors).toContain('requirements must be array');
    });

    test('returns all missing array errors in strict mode', () => {
      const artifact = { task: 'task' };
      const errors = scoutingSchemaErrors(artifact, true);
      expect(errors.length).toBeGreaterThan(3); // Multiple array fields missing
    });

    test('handles partially valid artifact in strict mode', () => {
      const artifact = {
        task: 'task',
        requirements: [],
        relevant_files: 'not array',
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        test_impact: [],
      };
      const errors = scoutingSchemaErrors(artifact, true);
      expect(errors).toContain('relevant_files must be array');
    });

    test('allows empty arrays for all fields', () => {
      const artifact = {
        task: 'task',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        test_impact: [],
      };
      expect(scoutingSchemaErrors(artifact, true)).toHaveLength(0);
    });
  });

  describe('logScoutingRecoveryDiagnostic', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('writes diagnostic entry to JSONL file', () => {
      const diagnosticPath = path.join(tmpDir, 'scouting-recovery-diagnostics.jsonl');
      logScoutingRecoveryDiagnostic(tmpDir, 'Test message', true);

      expect(fs.existsSync(diagnosticPath)).toBe(true);
      const content = fs.readFileSync(diagnosticPath, 'utf8');
      expect(content).toContain('Test message');
      expect(content).toContain('artifact_recovery');
    });

    test('logs recovery success correctly', () => {
      const diagnosticPath = path.join(tmpDir, 'scouting-recovery-diagnostics.jsonl');
      logScoutingRecoveryDiagnostic(tmpDir, 'Success case', true);

      const entry = JSON.parse(fs.readFileSync(diagnosticPath, 'utf8'));
      expect(entry.recovery_success).toBe(true);
    });

    test('logs recovery failure correctly', () => {
      const diagnosticPath = path.join(tmpDir, 'scouting-recovery-diagnostics.jsonl');
      logScoutingRecoveryDiagnostic(tmpDir, 'Failure case', false);

      const entry = JSON.parse(fs.readFileSync(diagnosticPath, 'utf8'));
      expect(entry.recovery_success).toBe(false);
    });

    test('appends to existing diagnostic file', () => {
      const diagnosticPath = path.join(tmpDir, 'scouting-recovery-diagnostics.jsonl');
      logScoutingRecoveryDiagnostic(tmpDir, 'First message', true);
      logScoutingRecoveryDiagnostic(tmpDir, 'Second message', false);

      const lines = fs.readFileSync(diagnosticPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    test('handles gracefully if directory is not writable', () => {
      // Should not throw
      expect(() => {
        logScoutingRecoveryDiagnostic('/nonexistent/path', 'message', true);
      }).not.toThrow();
    });

    test('includes timestamp in diagnostic entry', () => {
      const diagnosticPath = path.join(tmpDir, 'scouting-recovery-diagnostics.jsonl');
      logScoutingRecoveryDiagnostic(tmpDir, 'message', true);

      const entry = JSON.parse(fs.readFileSync(diagnosticPath, 'utf8'));
      expect(entry.timestamp).toBeDefined();
      // Validate ISO format timestamp
      expect(new Date(entry.timestamp).getTime()).toBeGreaterThan(0);
    });

    test('includes recovery_attempted flag', () => {
      const diagnosticPath = path.join(tmpDir, 'scouting-recovery-diagnostics.jsonl');
      logScoutingRecoveryDiagnostic(tmpDir, 'message', true);

      const entry = JSON.parse(fs.readFileSync(diagnosticPath, 'utf8'));
      expect(entry.recovery_attempted).toBe(true);
    });
  });
});

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

    test('selects the most complete scouting candidate when multiple recoverable objects exist', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');
      const minimal = { task: 'Minimal task' };
      const richer = {
        task: 'Richer task',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        test_impact: [],
      };

      fs.writeFileSync(rawEventsPath, [
        JSON.stringify({ wrapper: JSON.stringify(minimal) }),
        JSON.stringify({ wrapper: JSON.stringify(richer) }),
      ].join('\n'));

      const result = runCli(['scouting', rawEventsPath, candidatePath, tmpDir]);

      expect(result.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(candidatePath, 'utf8'))).toMatchObject({ task: 'Richer task' });
    });

    test('still recovers scouting artifact when diagnostic log cannot be written', () => {
      const rawEventsPath = path.join(tmpDir, 'raw-events.jsonl');
      const candidatePath = path.join(tmpDir, 'candidate.json');
      const blockedResultsPath = path.join(tmpDir, 'not-a-directory');
      fs.writeFileSync(blockedResultsPath, 'blocks diagnostic append');
      fs.writeFileSync(rawEventsPath, JSON.stringify({
        task: 'Recover without diagnostics',
        requirements: [],
        relevant_files: [],
        observations: [],
        plan: [],
        validation: [],
        risks: [],
        test_impact: [],
      }) + '\n');

      const result = runCli(['scouting', rawEventsPath, candidatePath, blockedResultsPath]);

      expect(result.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(candidatePath, 'utf8'))).toMatchObject({
        task: 'Recover without diagnostics',
      });
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
