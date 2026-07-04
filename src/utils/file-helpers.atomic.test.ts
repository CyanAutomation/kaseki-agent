import * as os from 'os';
import * as path from 'path';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs') as typeof import('fs');
  return {
    ...actual,
    renameSync: jest.fn(actual.renameSync),
  };
});

import * as fs from 'fs';
import { writeAtomic, writeIfEmptyAtomic } from './file-helpers';

type MockedFn<T extends (...args: any[]) => any> = jest.MockedFunction<T>;

const realFs = jest.requireActual('fs') as typeof import('fs');
const renameSyncMock = fs.renameSync as MockedFn<typeof fs.renameSync>;

const tempArtifactsFor = (directory: string, targetPath: string): string[] =>
  realFs
    .readdirSync(directory)
    .filter((name) => name.startsWith(`${path.basename(targetPath)}.`) && (name.endsWith('.tmp') || name.endsWith('.lock')))
    .sort();

describe('file-helpers atomic write behavior', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'file-helpers-atomic-'));
  });

  afterEach(() => {
    renameSyncMock.mockImplementation(realFs.renameSync);
    jest.clearAllMocks();
    realFs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('writeAtomic writes the complete content to a real destination', () => {
    const targetPath = path.join(tempDir, 'artifact.log');

    writeAtomic(targetPath, 'complete artifact');

    expect(realFs.readFileSync(targetPath, 'utf-8')).toBe('complete artifact');
    expect(tempArtifactsFor(tempDir, targetPath)).toEqual([]);
  });

  test('writeIfEmptyAtomic does not overwrite an existing non-empty file', () => {
    const targetPath = path.join(tempDir, 'already-written.log');
    realFs.writeFileSync(targetPath, 'original artifact');

    const written = writeIfEmptyAtomic(targetPath, 'replacement artifact');

    expect(written).toBe(false);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toBe('original artifact');
    expect(tempArtifactsFor(tempDir, targetPath)).toEqual([]);
  });

  test('writeIfEmptyAtomic removes its lock file after filling an existing empty file', () => {
    const targetPath = path.join(tempDir, 'empty-existing.log');
    realFs.writeFileSync(targetPath, '');

    const written = writeIfEmptyAtomic(targetPath, 'first artifact');

    expect(written).toBe(true);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toBe('first artifact');
    expect(tempArtifactsFor(tempDir, targetPath)).toEqual([]);
  });

  test('writeIfEmptyAtomic leaves stale legacy temp files alone while still writing successfully', () => {
    const targetPath = path.join(tempDir, 'recovery.txt');
    const staleTempPath = `${targetPath}.tmp`;
    realFs.writeFileSync(targetPath, '');
    realFs.writeFileSync(staleTempPath, 'stale-data');

    const written = writeIfEmptyAtomic(targetPath, 'fresh-data');

    expect(written).toBe(true);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toBe('fresh-data');
    expect(realFs.readFileSync(staleTempPath, 'utf-8')).toBe('stale-data');
  });

  test('writeIfEmptyAtomic allows only one parallel writer to fill a real empty file', async () => {
    const targetPath = path.join(tempDir, 'parallel.log');
    realFs.writeFileSync(targetPath, '');

    const attempts = Array.from({ length: 20 }, (_, idx) =>
      new Promise<boolean>((resolve) =>
        setImmediate(() => resolve(writeIfEmptyAtomic(targetPath, `writer-${idx}`)))
      )
    );

    const results = await Promise.all(attempts);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toMatch(/^writer-\d+$/);
    expect(tempArtifactsFor(tempDir, targetPath)).toEqual([]);
  });

  test('writeAtomic preserves destination content and removes its temp file when rename fails', () => {
    const targetPath = path.join(tempDir, 'interrupted.txt');
    realFs.writeFileSync(targetPath, 'safe-existing-content');
    renameSyncMock.mockImplementation(() => {
      const error = new Error('rename interrupted') as NodeJS.ErrnoException;
      error.code = 'EIO';
      throw error;
    });

    expect(() => writeAtomic(targetPath, 'new-value')).toThrow(/rename interrupted/);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toBe('safe-existing-content');
    expect(tempArtifactsFor(tempDir, targetPath)).toEqual([]);
  });

  test('writeIfEmptyAtomic preserves destination content and removes lock/temp files when replacement fails', () => {
    const targetPath = path.join(tempDir, 'empty-replacement-failure.txt');
    realFs.writeFileSync(targetPath, '');
    renameSyncMock.mockImplementation(() => {
      const error = new Error('rename interrupted') as NodeJS.ErrnoException;
      error.code = 'EIO';
      throw error;
    });

    expect(() => writeIfEmptyAtomic(targetPath, 'new-value')).toThrow(/rename interrupted/);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toBe('');
    expect(tempArtifactsFor(tempDir, targetPath)).toEqual([]);
  });
});
