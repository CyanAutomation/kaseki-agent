import { describe, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');
const jsonHelper = join(repoRoot, 'scripts/lib/json.sh');

function runJsonEncode(input: string, helperPath = jsonHelper): string {
  return execFileSync('bash', ['-c', '. "$JSON_HELPER"; json_encode'], {
    cwd: repoRoot,
    env: { ...process.env, JSON_HELPER: helperPath },
    input,
    encoding: 'utf8',
  }).replace(/\n$/, '');
}

function expectJsonEncodeContract(input: string, encoded: string, expectedEncoded: string, contract: string): void {
  if (encoded !== expectedEncoded) {
    throw new Error(`${contract}: expected encoded JSON ${JSON.stringify(expectedEncoded)}, got ${JSON.stringify(encoded)}`);
  }

  const decoded = JSON.parse(encoded);
  if (decoded !== input) {
    throw new Error(`${contract}: expected decoded value ${JSON.stringify(input)}, got ${JSON.stringify(decoded)}`);
  }
}

describe('scripts/lib/json.sh::json_encode', () => {
  it('json_encode must escape quotes as JSON string escapes', () => {
    const contract = 'json_encode must escape quotes as JSON string escapes';
    expectJsonEncodeContract('hello "world"', runJsonEncode('hello "world"'), '"hello \\"world\\""', contract);
  });

  it('json_encode must escape control characters as JSON string escapes', () => {
    const contract = 'json_encode must escape control characters as JSON string escapes';
    const input = 'line1\nline2\tctrl:\u0001';
    expectJsonEncodeContract(input, runJsonEncode(input), '"line1\\nline2\\tctrl:\\u0001"', contract);
  });

  it('json_encode must preserve empty input as an empty JSON string', () => {
    const contract = 'json_encode must preserve empty input as an empty JSON string';
    expectJsonEncodeContract('', runJsonEncode(''), '""', contract);
  });

  it('json_encode must preserve non-empty input as a JSON string', () => {
    const contract = 'json_encode must preserve non-empty input as a JSON string';
    expectJsonEncodeContract('plain value', runJsonEncode('plain value'), '"plain value"', contract);
  });

  it('json_encode must work when scripts/lib/json.sh is sourced from a path containing spaces', () => {
    const contract = 'json_encode must work when scripts/lib/json.sh is sourced from a path containing spaces';
    const tempDir = mkdtempSync(join(tmpdir(), 'kaseki json helper.'));
    const helperCopy = join(tempDir, 'json helper.sh');

    try {
      copyFileSync(jsonHelper, helperCopy);
      expectJsonEncodeContract('space path', runJsonEncode('space path', helperCopy), '"space path"', contract);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
