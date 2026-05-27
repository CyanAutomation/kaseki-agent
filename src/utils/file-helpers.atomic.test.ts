import * as os from 'os';
import * as path from 'path';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs') as typeof import('fs');
  return {
    ...actual,
    writeFileSync: jest.fn(actual.writeFileSync),
    renameSync: jest.fn(actual.renameSync),
    statSync: jest.fn(actual.statSync),
    unlinkSync: jest.fn(actual.unlinkSync),
    mkdirSync: jest.fn(actual.mkdirSync),
  };
});

import * as fs from 'fs';
import { writeAtomic, writeIfEmptyAtomic, logWriteError } from './file-helpers';

type MockedFn<T extends (...args: any[]) => any> = jest.MockedFunction<T>;

const writeFileSyncMock = fs.writeFileSync as MockedFn<typeof fs.writeFileSync>;
const renameSyncMock = fs.renameSync as MockedFn<typeof fs.renameSync>;
const statSyncMock = fs.statSync as MockedFn<typeof fs.statSync>;

const realFs = jest.requireActual('fs') as typeof import('fs');

describe('file-helpers atomic write behavior', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'file-helpers-atomic-'));
    jest.clearAllMocks();
    writeFileSyncMock.mockImplementation(realFs.writeFileSync);
    renameSyncMock.mockImplementation(realFs.renameSync);
    statSyncMock.mockImplementation(realFs.statSync);
  });

  afterEach(() => {
    realFs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('concurrent: only one parallel writer succeeds for writeIfEmptyAtomic and file stays stable', async () => {
    const targetPath = path.join(tempDir, 'artifact.log');
    realFs.writeFileSync(targetPath, '');

    const attempts = Array.from({ length: 20 }, (_, idx) => 
      new Promise<boolean>((resolve) => 
        setImmediate(() => resolve(writeIfEmptyAtomic(targetPath, `writer-${idx}`)))
      )
    );

    const results = await Promise.all(attempts);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toMatch(/^writer-\d+$/);
  });

  test('concurrent failure: intermittent fs errors are handled by best-effort callers and logging triggers', async () => {
    const targetPath = path.join(tempDir, 'best-effort.log');
    realFs.writeFileSync(targetPath, '');

    let statCalls = 0;
    statSyncMock.mockImplementation(((...args: Parameters<typeof fs.statSync>) => {
      statCalls += 1;
      if (statCalls % 3 === 0) {
        const error = new Error('intermittent stat failure') as NodeJS.ErrnoException;
        error.code = 'EIO';
        throw error;
      }
      return realFs.statSync(...args);
    }) as typeof fs.statSync);

    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const bestEffortWrite = async (content: string): Promise<boolean> => {
      try {
        return writeIfEmptyAtomic(targetPath, content);
      } catch (error) {
        logWriteError('write best-effort artifact', targetPath, error, 'job-concurrent');
        return false;
      }
    };

    const results = await Promise.all(Array.from({ length: 12 }, (_, idx) => bestEffortWrite(`content-${idx}`)));
    expect(results.every((value) => typeof value === 'boolean')).toBe(true);
    expect(logSpy).toHaveBeenCalled();
  });

  test('collision: rename collisions surface deterministically and preserve destination integrity', () => {
    const targetPath = path.join(tempDir, 'collision.txt');
    realFs.writeFileSync(targetPath, 'original');

    let renameCalls = 0;
    renameSyncMock.mockImplementation(((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      renameCalls += 1;
      if (renameCalls === 1) {
        const err = new Error('rename collision') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      }
      return realFs.renameSync(oldPath, newPath);
    }) as typeof fs.renameSync);

    expect(() => writeAtomic(targetPath, 'new-content')).toThrow(/rename collision/);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toBe('original');
    expect(realFs.existsSync(`${targetPath}.tmp`)).toBe(false);
  });

  test('interrupted: failure between temp write and rename cleans up temp and does not corrupt destination', () => {
    const targetPath = path.join(tempDir, 'interrupted.txt');
    realFs.writeFileSync(targetPath, 'safe-existing-content');

    renameSyncMock.mockImplementation(() => {
      const err = new Error('rename interrupted') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    expect(() => writeAtomic(targetPath, 'new-value')).toThrow(/rename interrupted/);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toBe('safe-existing-content');
    expect(realFs.existsSync(`${targetPath}.tmp`)).toBe(false);
  });

  test('recovery: stale temp files are recovered by overwrite and successful write', () => {
    const targetPath = path.join(tempDir, 'recovery.txt');
    realFs.writeFileSync(targetPath, '');
    realFs.writeFileSync(`${targetPath}.tmp`, 'stale-data');

    expect(writeIfEmptyAtomic(targetPath, 'fresh-data')).toBe(true);
    expect(realFs.readFileSync(targetPath, 'utf-8')).toBe('fresh-data');
    expect(realFs.existsSync(`${targetPath}.tmp`)).toBe(false);
  });
});
