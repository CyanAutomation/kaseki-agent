import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { cleanupOldRuns } from '../src/cleanup-manager';
import { CleanupCommand } from '../src/cli/commands/CleanupCommand';
import type { ConfigManager } from '../src/config/ConfigManager';

jest.mock('readline', () => ({
  createInterface: jest.fn(),
}));
jest.mock('../src/cleanup-manager', () => ({
  cleanupOldRuns: jest.fn(),
}));

const createInterfaceMock = jest.mocked(readline.createInterface);
const cleanupOldRunsMock = jest.mocked(cleanupOldRuns);

type InterfaceEvent = 'close' | 'error';

function preparePrompt(answer?: string): Map<InterfaceEvent, () => void> {
  const handlers = new Map<InterfaceEvent, () => void>();
  const terminal = {
    close: jest.fn(),
    once: jest.fn((event: InterfaceEvent, handler: () => void) => {
      handlers.set(event, handler);
      return terminal;
    }),
    question: jest.fn((_prompt: string, callback: (value: string) => void) => {
      if (answer !== undefined) {
        callback(answer);
      }
    }),
  };
  createInterfaceMock.mockReturnValue(terminal as unknown as readline.Interface);
  return handlers;
}

describe('CleanupCommand confirmation', () => {
  let tempDir: string;
  let resultsDir: string;
  let originalResultsDir: string | undefined;
  let originalCacheDir: string | undefined;
  let originalIsTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-cleanup-command-'));
    resultsDir = path.join(tempDir, 'results');
    fs.mkdirSync(resultsDir);
    fs.mkdirSync(path.join(resultsDir, 'kaseki-1'));
    fs.mkdirSync(path.join(resultsDir, 'kaseki-2'));

    originalResultsDir = process.env.KASEKI_RESULTS_DIR;
    originalCacheDir = process.env.KASEKI_CACHE_DIR;
    process.env.KASEKI_RESULTS_DIR = resultsDir;
    process.env.KASEKI_CACHE_DIR = path.join(tempDir, 'cache');
    originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });

    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    cleanupOldRunsMock.mockResolvedValue({
      deletedCount: 1,
      freedBytes: 0,
      cachedEntriesRemoved: 0,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalIsTTY) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    } else {
      delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    }
    if (originalResultsDir === undefined) delete process.env.KASEKI_RESULTS_DIR;
    else process.env.KASEKI_RESULTS_DIR = originalResultsDir;
    if (originalCacheDir === undefined) delete process.env.KASEKI_CACHE_DIR;
    else process.env.KASEKI_CACHE_DIR = originalCacheDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function execute(args: string[] = []): Promise<number> {
    const command = new CleanupCommand({} as ConfigManager);
    return command.execute(['--count=1', ...args]);
  }

  it.each(['y', 'yes', ' YES '])('cleans up after explicit confirmation %j', async answer => {
    preparePrompt(answer);

    await expect(execute()).resolves.toBe(0);

    expect(cleanupOldRunsMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a no response', async () => {
    preparePrompt('no');

    await expect(execute()).resolves.toBe(0);

    expect(cleanupOldRunsMock).not.toHaveBeenCalled();
  });

  it('rejects an empty response', async () => {
    preparePrompt('');

    await expect(execute()).resolves.toBe(0);

    expect(cleanupOldRunsMock).not.toHaveBeenCalled();
  });

  it('rejects EOF while waiting for a response', async () => {
    const handlers = preparePrompt();
    const execution = execute();
    handlers.get('close')?.();

    await expect(execution).resolves.toBe(0);
    expect(cleanupOldRunsMock).not.toHaveBeenCalled();
  });

  it('rejects a prompt error', async () => {
    const handlers = preparePrompt();
    const execution = execute();
    handlers.get('error')?.();

    await expect(execution).resolves.toBe(0);
    expect(cleanupOldRunsMock).not.toHaveBeenCalled();
  });

  it('rejects non-TTY input without opening a prompt', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });

    await expect(execute()).resolves.toBe(0);

    expect(createInterfaceMock).not.toHaveBeenCalled();
    expect(cleanupOldRunsMock).not.toHaveBeenCalled();
  });

  it('uses --force as the non-interactive cleanup path', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });

    await expect(execute(['--force'])).resolves.toBe(0);

    expect(createInterfaceMock).not.toHaveBeenCalled();
    expect(cleanupOldRunsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps --dry-run non-destructive even with --force', async () => {
    await expect(execute(['--dry-run', '--force'])).resolves.toBe(0);

    expect(createInterfaceMock).not.toHaveBeenCalled();
    expect(cleanupOldRunsMock).not.toHaveBeenCalled();
  });
});
