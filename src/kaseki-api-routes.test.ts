import * as fs from 'fs';
import * as path from 'path';
import { decodeUtf8TailSafely, readArtifactContent, tailLogByLines } from './kaseki-api-routes';
import { ResultCache } from './result-cache';

describe('kaseki-api-routes log truncation helpers', () => {
  test('decodeUtf8TailSafely trims incomplete 2-byte sequence split at chunk boundary', () => {
    const input = Buffer.concat([Buffer.from('cafe ', 'utf-8'), Buffer.from([0xc3])]);
    expect(decodeUtf8TailSafely(input)).toBe('cafe ');
  });

  test('decodeUtf8TailSafely trims incomplete 3-byte sequence split at chunk boundary', () => {
    const input = Buffer.concat([Buffer.from('prefix ', 'utf-8'), Buffer.from([0xe4, 0xbd])]);
    expect(decodeUtf8TailSafely(input)).toBe('prefix ');
  });

  test('decodeUtf8TailSafely trims incomplete 4-byte sequence split at chunk boundary', () => {
    const input = Buffer.concat([Buffer.from('emoji ', 'utf-8'), Buffer.from([0xf0, 0x9f, 0x98])]);
    expect(decodeUtf8TailSafely(input)).toBe('emoji ');
  });

  test('decodeUtf8TailSafely keeps chunks that start with continuation bytes when tail is complete', () => {
    const input = Buffer.concat([Buffer.from([0x98, 0x80]), Buffer.from('alpha 你好 😀 beta', 'utf-8')]);
    expect(decodeUtf8TailSafely(input)).toBe('��alpha 你好 😀 beta');
  });

  test('decodeUtf8TailSafely keeps pure ASCII tails unchanged', () => {
    const input = Buffer.from('line1\nline2\nASCII tail', 'utf-8');
    expect(decodeUtf8TailSafely(input)).toBe('line1\nline2\nASCII tail');
  });

  test.each([
    {
      name: 'empty content',
      content: '',
      lineCount: 3,
      expected: '',
    },
    {
      name: 'exact boundary',
      content: 'a\nb\nc',
      lineCount: 3,
      expected: 'a\nb\nc',
    },
    {
      name: 'over-requested lines',
      content: 'a\nb\nc',
      lineCount: 10,
      expected: 'a\nb\nc',
    },
    {
      name: 'CRLF input',
      content: 'a\r\nb\r\nc\r\nd',
      lineCount: 2,
      expected: 'c\nd',
    },
    {
      name: 'trailing newline handling',
      content: 'a\nb\nc\n',
      lineCount: 2,
      expected: 'c\n',
    },
  ])('tailLogByLines handles $name', ({ content, lineCount, expected }) => {
    expect(tailLogByLines(content, lineCount)).toBe(expected);
  });
});

describe('kaseki-api-routes artifact read behavior', () => {
  let testDir: string;
  let artifactPath: string;
  let cache: ResultCache;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-routes-test-'));
    artifactPath = path.join(testDir, 'pi-summary.json');
    cache = new ResultCache(10, 60_000);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('returns fresh artifact content for running jobs when file changes between reads', () => {
    fs.writeFileSync(artifactPath, '{"version":1}');
    const firstRead = readArtifactContent(artifactPath, 'running', cache);
    expect(firstRead).toBe('{"version":1}');

    fs.writeFileSync(artifactPath, '{"version":2}');
    const secondRead = readArtifactContent(artifactPath, 'running', cache);
    expect(secondRead).toBe('{"version":2}');
  });
});

describe('kaseki-api-routes tail file descriptor cleanup', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('fs');
  });

  test('closes file descriptor when readSync throws', () => {
    const closeSyncMock = jest.fn();

    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        openSync: jest.fn(() => 42),
        readSync: jest.fn(() => {
          throw new Error('read failed');
        }),
        closeSync: closeSyncMock,
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readTailBytes } = require('./kaseki-api-routes') as typeof import('./kaseki-api-routes');
      expect(() => readTailBytes('/tmp/fake.log', 200, 100)).toThrow('read failed');
    });

    expect(closeSyncMock).toHaveBeenCalledWith(42);
  });
});
