import * as fs from 'fs';
import * as path from 'path';
import { SecretValueCache } from './secret-value-cache';

describe('SecretValueCache', () => {
  let testDir: string;
  let cache: SecretValueCache;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join('/tmp', 'secret-value-cache-test-'));
    cache = new SecretValueCache();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('returns cached file values while mtime and size are unchanged', () => {
    const secretFile = path.join(testDir, 'secret');
    const fixedTime = new Date('2020-01-01T00:00:00.000Z');
    fs.writeFileSync(secretFile, 'secret-one\n');
    fs.utimesSync(secretFile, fixedTime, fixedTime);

    expect(cache.readSecretValue(undefined, secretFile)).toBe('secret-one');

    fs.writeFileSync(secretFile, 'secret-two\n');
    fs.utimesSync(secretFile, fixedTime, fixedTime);

    expect(cache.readSecretValue(undefined, secretFile)).toBe('secret-one');
  });

  test('rereads file values when file metadata changes', () => {
    const secretFile = path.join(testDir, 'secret');
    fs.writeFileSync(secretFile, 'old-secret\n');

    expect(cache.readSecretValue(undefined, secretFile)).toBe('old-secret');

    fs.writeFileSync(secretFile, 'new-secret-value\n');

    expect(cache.readSecretValue(undefined, secretFile)).toBe('new-secret-value');
  });

  test('prefers inline values over file values', () => {
    const secretFile = path.join(testDir, 'secret');
    fs.writeFileSync(secretFile, 'file-secret\n');
    fs.rmSync(secretFile);

    expect(cache.readSecretValue(' inline-secret ', secretFile)).toBe('inline-secret');
  });

  test('clear drops cached values for tests', () => {
    const secretFile = path.join(testDir, 'secret');
    const fixedTime = new Date('2020-01-01T00:00:00.000Z');
    fs.writeFileSync(secretFile, 'old-secret\n');
    fs.utimesSync(secretFile, fixedTime, fixedTime);

    expect(cache.readSecretValue(undefined, secretFile)).toBe('old-secret');

    fs.writeFileSync(secretFile, 'new-secret\n');
    fs.utimesSync(secretFile, fixedTime, fixedTime);
    expect(cache.readSecretValue(undefined, secretFile)).toBe('old-secret');

    cache.clear();
    expect(cache.readSecretValue(undefined, secretFile)).toBe('new-secret');
  });
});
