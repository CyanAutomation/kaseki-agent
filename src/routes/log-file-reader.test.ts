import { afterEach, describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Request } from 'express';
import {
  collectDiagnostics,
  isPathInsideDirectory,
  logFileForType,
  readCombinedLogs,
  readLogContent,
} from './log-file-reader';

const requests = (query: Record<string, unknown> = {}): Request => ({ query } as unknown as Request);
const tempDirs: string[] = [];

function makeTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-log-reader-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('log-file-reader', () => {
  it('maps log types and rejects paths outside the run directory', () => {
    const runDir = '/tmp/run';
    expect(logFileForType(runDir, 'stdout')).toBe('/tmp/run/stdout.log');
    expect(logFileForType(runDir, 'goal-check-stderr')).toBe('/tmp/run/goal-check-stderr.log');
    expect(isPathInsideDirectory('/tmp/run/stdout.log', runDir)).toBe(true);
    expect(isPathInsideDirectory('/tmp/other/stdout.log', runDir)).toBe(false);
  });

  it('reads small logs without changing their content', () => {
    const directory = makeTempDir();
    const file = path.join(directory, 'stdout.log');
    fs.writeFileSync(file, 'first line\nsecond line\n');

    expect(readLogContent(file, requests())).toEqual({
      content: 'first line\nsecond line\n',
      size: fs.statSync(file).size,
    });
  });

  it('reads the final 100 KiB of large logs and applies line tails', () => {
    const directory = makeTempDir();
    const file = path.join(directory, 'stdout.log');
    fs.writeFileSync(file, `${'x'.repeat(100 * 1024)}\nkeep-one\nkeep-two\n`);

    const result = readLogContent(file, requests({ tail: 'lines', lines: '3' }));
    expect(result.size).toBe(fs.statSync(file).size);
    expect(result.content.startsWith('[... truncated, showing last 102400 bytes ...]\n')).toBe(true);
    expect(result.content.endsWith('keep-one\nkeep-two\n')).toBe(true);
  });

  it('combines existing logs in stable order and returns undefined when empty', () => {
    const directory = makeTempDir();
    fs.writeFileSync(path.join(directory, 'quality.log'), 'quality output');
    fs.writeFileSync(path.join(directory, 'stdout.log'), 'standard output');

    const combined = readCombinedLogs(directory, requests());
    expect(combined?.logType).toBe('combined');
    expect(combined?.content).toContain('===== stdout (stdout.log) =====\nstandard output');
    expect(combined?.content).toContain('===== quality (quality.log) =====\nquality output');
    expect(combined?.sources?.map(({ logType }) => logType)).toEqual(['stdout', 'quality']);

    expect(readCombinedLogs(makeTempDir(), requests())).toBeUndefined();
  });

  it('collects candidate files and valid validation JSONL details', () => {
    const directory = makeTempDir();
    fs.writeFileSync(path.join(directory, 'stdout.log'), 'stdout');
    fs.writeFileSync(
      path.join(directory, 'goal-setting-validation-errors.jsonl'),
      '{"code":"invalid_goal"}\n{"field":"confidence"}\n',
    );

    expect(collectDiagnostics(directory)).toEqual({
      entryPoint: 'goal-setting-validation-errors.jsonl',
      files: ['goal-setting-validation-errors.jsonl', 'stdout.log'],
      details: [{ code: 'invalid_goal' }, { field: 'confidence' }],
    });
  });

  it('ignores malformed, empty, and oversized diagnostic JSONL files', () => {
    const directory = makeTempDir();
    fs.writeFileSync(path.join(directory, 'goal-setting-validation-errors.jsonl'), '{bad json}\n');
    fs.writeFileSync(path.join(directory, 'scouting-validation-errors.jsonl'), '');
    fs.writeFileSync(path.join(directory, 'scouting-stderr.log'), 'diagnostic stderr');

    expect(collectDiagnostics(directory)).toEqual({
      entryPoint: 'goal-setting-validation-errors.jsonl',
      files: ['goal-setting-validation-errors.jsonl', 'scouting-stderr.log'],
    });
  });
});
