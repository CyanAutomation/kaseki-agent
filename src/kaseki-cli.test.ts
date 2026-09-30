import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFollowPoller } from './kaseki-cli';

function createChunkRecorder() {
  const chunks: string[] = [];
  const waiters: Array<() => void> = [];
  return {
    chunks,
    onData(chunk: string) {
      chunks.push(chunk);
      waiters.shift()?.();
    },
    nextChunk() {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for log data')), 1000);
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

describe('kaseki-cli follow poller', () => {
  let directory: string;
  let logPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-follow-poller-'));
    logPath = path.join(directory, 'stdout.log');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('streams only newly appended log content', async () => {
    fs.writeFileSync(logPath, 'first line\n');
    const output = createChunkRecorder();
    const errors: Error[] = [];
    const poller = createFollowPoller(fs, logPath, {
      onData: output.onData,
      onError: (error) => errors.push(error),
    });

    try {
      const firstRead = output.nextChunk();
      poller.poll();
      await firstRead;
      poller.poll();
      fs.appendFileSync(logPath, 'second line\n');
      const secondRead = output.nextChunk();
      poller.poll();
      await secondRead;

      expect(output.chunks.join('')).toBe('first line\nsecond line\n');
      expect(errors).toEqual([]);
    } finally {
      poller.close();
    }
  });

  it('resets the cursor when a log path is replaced', async () => {
    fs.writeFileSync(logPath, 'old content\n');
    const rotatedPath = path.join(directory, 'stdout.old.log');
    const output = createChunkRecorder();
    const messages: string[] = [];
    const poller = createFollowPoller(fs, logPath, {
      onData: output.onData,
      onInfo: (message) => messages.push(message),
    });

    try {
      const firstRead = output.nextChunk();
      poller.poll();
      await firstRead;
      fs.renameSync(logPath, rotatedPath);
      fs.writeFileSync(logPath, 'replacement content\n');
      const replacementRead = output.nextChunk();
      poller.poll();
      await replacementRead;

      expect(output.chunks.join('')).toBe('old content\nreplacement content\n');
      expect(messages).toContain('[follow] log file replaced/rotated; resetting cursor.');
    } finally {
      poller.close();
    }
  });

  it('resets the cursor when the current log is truncated', async () => {
    fs.writeFileSync(logPath, 'a long line that will be replaced\n');
    const output = createChunkRecorder();
    const messages: string[] = [];
    const poller = createFollowPoller(fs, logPath, {
      onData: output.onData,
      onInfo: (message) => messages.push(message),
    });

    try {
      const firstRead = output.nextChunk();
      poller.poll();
      await firstRead;
      fs.writeFileSync(logPath, 'new\n');
      const truncatedRead = output.nextChunk();
      poller.poll();
      await truncatedRead;

      expect(output.chunks.join('')).toBe('a long line that will be replaced\nnew\n');
      expect(messages).toContain('[follow] log file truncated; resetting cursor.');
    } finally {
      poller.close();
    }
  });
});
