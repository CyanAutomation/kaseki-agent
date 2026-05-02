import * as fs from 'fs';
import * as path from 'path';
import { decodeUtf8TailSafely, readArtifactContent, tailLogByLines } from './kaseki-api-routes';
import { ResultCache } from './result-cache';

describe('kaseki-api-routes log truncation helpers', () => {
  test('decodeUtf8TailSafely removes split multibyte prefix and suffix', () => {
    const prefix = Buffer.from([0x98, 0x80]); // continuation bytes from 😀
    const body = Buffer.from('alpha 你好 😀 beta', 'utf-8');
    const truncatedSuffix = Buffer.from([0xe4, 0xbd]); // partial 你
    const input = Buffer.concat([prefix, body, truncatedSuffix]);

    expect(decodeUtf8TailSafely(input)).toBe('alpha 你好 😀 beta');
  });

  test('decodeUtf8TailSafely preserves valid multibyte content', () => {
    const input = Buffer.from('line1\nline2 😀\n最终行', 'utf-8');
    expect(decodeUtf8TailSafely(input)).toBe('line1\nline2 😀\n最终行');
  });

  test('tailLogByLines keeps trailing lines for readability', () => {
    const content = 'a\nb\nc\nd\n最后😀';
    expect(tailLogByLines(content, 2)).toBe('d\n最后😀');
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
