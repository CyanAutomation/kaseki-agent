/**
 * hashline-event-handler.test.ts
 *
 * Test suite for hashline-event-handler: Processes Pi JSONL events for hashline_edit tool calls.
 * Tests cover event parsing, anchor validation, application, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { processHashlineEventsFromFile } from '../src/hashline-event-handler';

describe('hashline-event-handler', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hashline-handler-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const writeEventsFile = (events: unknown[]): string => {
    const jsonlPath = path.join(tempDir, 'events.jsonl');
    fs.writeFileSync(jsonlPath, events.map((event) => JSON.stringify(event)).join('\n'));
    return jsonlPath;
  };

  const lineHash = (line: string): string => {
    const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
    return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 8);
  };

  const writeSummaryJson = (summary: unknown): string => {
    const summaryPath = path.join(tempDir, 'hashline-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    return summaryPath;
  };

  const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;

  describe('processHashlineEventsFromFile', () => {
    it('should process empty JSONL file', async () => {
      const jsonlPath = path.join(tempDir, 'events.jsonl');
      fs.writeFileSync(jsonlPath, '');

      const { results, summary } = await processHashlineEventsFromFile(jsonlPath, tempDir);

      expect(results).toHaveLength(0);
      expect(summary.applied).toBe(0);
      expect(summary.rejected).toBe(0);
      expect(summary.errors).toBe(0);
    });

    it('should skip non-hashline events', async () => {
      const jsonlPath = path.join(tempDir, 'events.jsonl');
      const events = [
        JSON.stringify({ type: 'message', content: 'hello' }),
        JSON.stringify({ type: 'tool_call', tool_name: 'bash', command: 'ls' }),
        JSON.stringify({ type: 'tool_result', tool_name: 'bash', output: 'file.ts' }),
      ].join('\n');

      fs.writeFileSync(jsonlPath, events);

      const { results } = await processHashlineEventsFromFile(jsonlPath, tempDir);

      expect(results).toHaveLength(0);
    });

    it('applies a valid hashline_edit event and records structured summary counts', async () => {
      const filePath = path.join(tempDir, 'test.ts');
      const content = `function hello() {
  console.log('world');
  return 42;
}`;

      fs.writeFileSync(filePath, content);

      const lines = content.split('\n');
      const jsonlPath = writeEventsFile([{
        type: 'tool_call',
        tool_name: 'hashline_edit',
        call: {
          file: 'test.ts',
          anchor: {
            start_hash: lineHash(lines[1]),
            end_hash: lineHash(lines[2]),
            context_lines: 3,
          },
          replacement: '  console.log("updated");\n  return 100;',
        },
      }]);

      const { results, summary } = await processHashlineEventsFromFile(jsonlPath, tempDir);
      const summaryJson = readJson<typeof summary>(writeSummaryJson(summary));

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('applied');
      expect(results[0].file).toBe('test.ts');
      expect(results[0].linesModified).toBe(2);
      expect(summaryJson).toMatchObject({
        applied: 1,
        rejected: 0,
        errors: 0,
        totalLinesModified: 2,
      });
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(`function hello() {
  console.log("updated");
  return 100;
}`);
    });

    it('rejects stale anchors without mutating files and records structured summary counts', async () => {
      const filePath = path.join(tempDir, 'test.ts');
      const originalContent = 'line 0\nline 1\nline 2';
      fs.writeFileSync(filePath, originalContent);

      const jsonlPath = writeEventsFile([{
        type: 'tool_call',
        tool_name: 'hashline_edit',
        call: {
          file: 'test.ts',
          anchor: {
            start_hash: 'deadbeef',
            end_hash: 'cafebabe',
            context_lines: 1,
          },
          replacement: 'replaced',
        },
      }]);

      const { results, summary } = await processHashlineEventsFromFile(jsonlPath, tempDir);
      const summaryJson = readJson<typeof summary>(writeSummaryJson(summary));

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('rejected');
      expect(results[0].reason).toContain('not found');
      expect(summaryJson).toMatchObject({
        applied: 0,
        rejected: 1,
        errors: 0,
        totalLinesModified: 0,
      });
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(originalContent);
    });

    it('should handle malformed JSON in events', async () => {
      const jsonlPath = path.join(tempDir, 'events.jsonl');
      const events = [
        JSON.stringify({ type: 'tool_call', tool_name: 'bash' }),
        '{this is invalid json',
        JSON.stringify({ type: 'message' }),
      ].join('\n');

      fs.writeFileSync(jsonlPath, events);

      const { results } = await processHashlineEventsFromFile(jsonlPath, tempDir);

      // Should skip invalid lines and process valid ones
      expect(results).toHaveLength(0); // No hashline events
    });

    it('should handle missing files gracefully', async () => {
      const jsonlPath = path.join(tempDir, 'events.jsonl');
      const event = JSON.stringify({
        type: 'tool_call',
        tool_name: 'hashline_edit',
        call: {
          file: 'nonexistent.ts',
          anchor: {
            start_hash: 'abc123',
            end_hash: 'def456',
            context_lines: 1,
          },
          replacement: 'replaced',
        },
      });

      fs.writeFileSync(jsonlPath, event);

      const { results } = await processHashlineEventsFromFile(jsonlPath, tempDir);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('rejected');
      expect(results[0].reason).toContain('not found');
    });

    it('should process multiple events and track stats', async () => {
      const filePath = path.join(tempDir, 'test.ts');
      const content = `line 0
line 1
line 2
line 3
line 4`;

      fs.writeFileSync(filePath, content);

      const getHash = (line: string) => {
        const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
        return crypto
          .createHash('sha256')
          .update(normalized, 'utf-8')
          .digest('hex')
          .slice(0, 8);
      };

      const lines = content.split('\n');

      const jsonlPath = path.join(tempDir, 'events.jsonl');
      const events = [
        // Valid event
        JSON.stringify({
          type: 'tool_call',
          tool_name: 'hashline_edit',
          call: {
            file: 'test.ts',
            anchor: {
              start_hash: getHash(lines[1]),
              end_hash: getHash(lines[1]),
              context_lines: 1,
            },
            replacement: 'REPLACED_1',
          },
        }),
        // Invalid event (stale anchor)
        JSON.stringify({
          type: 'tool_call',
          tool_name: 'hashline_edit',
          call: {
            file: 'test.ts',
            anchor: {
              start_hash: 'deadbeef',
              end_hash: 'cafebabe',
              context_lines: 1,
            },
            replacement: 'will fail',
          },
        }),
        // Non-hashline event (should be skipped)
        JSON.stringify({
          type: 'tool_call',
          tool_name: 'bash',
          call: { command: 'ls' },
        }),
        // Another valid event
        JSON.stringify({
          type: 'tool_call',
          tool_name: 'hashline_edit',
          call: {
            file: 'test.ts',
            anchor: {
              start_hash: getHash(lines[4]),
              end_hash: getHash(lines[4]),
              context_lines: 1,
            },
            replacement: 'REPLACED_4',
          },
        }),
      ].join('\n');

      fs.writeFileSync(jsonlPath, events);

      const { results, summary } = await processHashlineEventsFromFile(jsonlPath, tempDir);

      expect(results).toHaveLength(3); // 2 valid + 1 rejected
      expect(summary.applied).toBe(2);
      expect(summary.rejected).toBe(1);
      expect(summary.errors).toBe(0);
      expect(summary.totalLinesModified).toBe(2);
    });

    it('should handle events with alternative Pi event structures', async () => {
      const filePath = path.join(tempDir, 'test.ts');
      const content = `function test() {
  return 42;
}`;

      fs.writeFileSync(filePath, content);

      const getHash = (line: string) => {
        const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
        return crypto
          .createHash('sha256')
          .update(normalized, 'utf-8')
          .digest('hex')
          .slice(0, 8);
      };

      const lines = content.split('\n');

      const jsonlPath = path.join(tempDir, 'events.jsonl');
      // Alternative event structure: with 'arguments' instead of nested 'call'
      const event = JSON.stringify({
        type: 'tool_call',
        tool_name: 'hashline_edit',
        arguments: {
          file: 'test.ts',
          anchor: {
            start_hash: getHash(lines[1]),
            end_hash: getHash(lines[1]),
            context_lines: 1,
          },
          replacement: 'return 100;',
        },
      });

      fs.writeFileSync(jsonlPath, event);

      const { results, summary } = await processHashlineEventsFromFile(jsonlPath, tempDir);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('applied');
      expect(summary.applied).toBe(1);
    });

    it('applies multi-line replacements exactly and records structured summary counts', async () => {
      const filePath = path.join(tempDir, 'test.ts');
      const content = `function test() {
  return 42;
}`;

      fs.writeFileSync(filePath, content);

      const lines = content.split('\n');
      const jsonlPath = writeEventsFile([{
        type: 'tool_call',
        tool_name: 'hashline_edit',
        call: {
          file: 'test.ts',
          anchor: {
            start_hash: lineHash(lines[1]),
            end_hash: lineHash(lines[1]),
            context_lines: 1,
          },
          replacement: '  const answer = 100;\n  return answer;',
        },
      }]);

      const { results, summary } = await processHashlineEventsFromFile(jsonlPath, tempDir);
      const summaryJson = readJson<typeof summary>(writeSummaryJson(summary));

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('applied');
      expect(results[0].linesModified).toBe(1);
      expect(summaryJson).toMatchObject({
        applied: 1,
        rejected: 0,
        errors: 0,
        totalLinesModified: 1,
      });
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(`function test() {
  const answer = 100;
  return answer;
}`);
    });

    it('should continue processing after error', async () => {
      const filePath = path.join(tempDir, 'test.ts');
      const content = `line 0
line 1
line 2`;

      fs.writeFileSync(filePath, content);

      const getHash = (line: string) => {
        const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
        return crypto
          .createHash('sha256')
          .update(normalized, 'utf-8')
          .digest('hex')
          .slice(0, 8);
      };

      const lines = content.split('\n');

      const jsonlPath = path.join(tempDir, 'events.jsonl');
      const events = [
        // Valid event
        JSON.stringify({
          type: 'tool_call',
          tool_name: 'hashline_edit',
          call: {
            file: 'test.ts',
            anchor: {
              start_hash: getHash(lines[1]),
              end_hash: getHash(lines[1]),
              context_lines: 1,
            },
            replacement: 'REPLACED',
          },
        }),
        // Malformed event (missing required fields)
        JSON.stringify({
          type: 'tool_call',
          tool_name: 'hashline_edit',
          call: {
            file: 'test.ts',
            // Missing anchor and replacement
          },
        }),
        // Another valid event after malformed
        JSON.stringify({
          type: 'tool_call',
          tool_name: 'hashline_edit',
          call: {
            file: 'test.ts',
            anchor: {
              start_hash: getHash(lines[2]),
              end_hash: getHash(lines[2]),
              context_lines: 1,
            },
            replacement: 'REPLACED_2',
          },
        }),
      ].join('\n');

      fs.writeFileSync(jsonlPath, events);

      const { results, summary } = await processHashlineEventsFromFile(jsonlPath, tempDir);

      expect(results).toHaveLength(3); // 2 valid + 1 error
      expect(summary.applied).toBe(2);
      expect(summary.errors).toBe(1);
    });
  });

  describe('hashline-event-handler CLI', () => {
    it('writes empty artifacts and zero-count summary for a no-edit event', () => {
      const workspaceDir = path.join(tempDir, 'workspace');
      const artifactsDir = path.join(tempDir, 'artifacts');
      fs.mkdirSync(workspaceDir);
      fs.mkdirSync(artifactsDir);

      const eventsPath = path.join(artifactsDir, 'pi-events.raw.jsonl');
      const outputJsonlPath = path.join(artifactsDir, 'hashline-events.jsonl');
      const outputSummaryPath = path.join(artifactsDir, 'hashline-summary.json');
      fs.writeFileSync(eventsPath, `${JSON.stringify({ type: 'message', content: 'No edits needed' })}\n`, 'utf-8');

      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'src/hashline-event-handler-cli.ts',
          eventsPath,
          workspaceDir,
          outputJsonlPath,
          outputSummaryPath,
        ],
        {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf-8',
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(fs.existsSync(outputJsonlPath)).toBe(true);
      expect(fs.readFileSync(outputJsonlPath, 'utf-8')).toBe('');
      expect(fs.existsSync(outputSummaryPath)).toBe(true);

      const summary = readJson<{
        applied: number;
        rejected: number;
        errors: number;
        totalLinesModified: number;
      }>(outputSummaryPath);

      expect(summary).toMatchObject({
        applied: 0,
        rejected: 0,
        errors: 0,
        totalLinesModified: 0,
      });
    });
  });

  describe('Event result structure', () => {
    it('should include correct fields in result', async () => {
      const filePath = path.join(tempDir, 'test.ts');
      const content = `function test() {
  return 42;
}`;

      fs.writeFileSync(filePath, content);

      const getHash = (line: string) => {
        const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
        return crypto
          .createHash('sha256')
          .update(normalized, 'utf-8')
          .digest('hex')
          .slice(0, 8);
      };

      const lines = content.split('\n');

      const jsonlPath = path.join(tempDir, 'events.jsonl');
      const event = JSON.stringify({
        type: 'tool_call',
        tool_name: 'hashline_edit',
        call: {
          file: 'test.ts',
          anchor: {
            start_hash: getHash(lines[1]),
            end_hash: getHash(lines[1]),
            context_lines: 1,
          },
          replacement: 'return 100;',
        },
      });

      fs.writeFileSync(jsonlPath, event);

      const { results } = await processHashlineEventsFromFile(jsonlPath, tempDir);

      expect(results[0]).toHaveProperty('eventId');
      expect(results[0]).toHaveProperty('file');
      expect(results[0]).toHaveProperty('status');
      expect(results[0]).toHaveProperty('reason');
      expect(results[0]).toHaveProperty('timestamp');
      expect(results[0]).toHaveProperty('linesModified');

      expect(typeof results[0].timestamp).toBe('string');
      expect(results[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
    });
  });
});
