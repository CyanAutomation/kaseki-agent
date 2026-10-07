import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createTrivySummary,
  evaluateTrivyReport,
  formatTrivyFinding,
} from './check-trivy-image-findings.mjs';

const checkerPath = fileURLToPath(new URL('./check-trivy-image-findings.mjs', import.meta.url));

test('collects high and critical vulnerabilities, misconfigurations, and secrets', () => {
  const findings = evaluateTrivyReport({
    Results: [
      {
        Target: 'image/rootfs',
        Vulnerabilities: [
          { Severity: 'HIGH', VulnerabilityID: 'CVE-2026-1000', PkgName: 'libfoo' },
          { Severity: 'LOW', VulnerabilityID: 'CVE-2026-1001', PkgName: 'libbar' },
        ],
        Misconfigurations: [
          { Severity: 'CRITICAL', ID: 'DS002', Title: 'Container runs as root' },
        ],
        Secrets: [
          { Severity: 'HIGH', RuleID: 'generic-api-key', Match: 'sensitive-token-value' },
        ],
      },
    ],
  });

  assert.deepEqual(findings, [
    {
      target: 'image/rootfs',
      type: 'vulnerability',
      severity: 'HIGH',
      id: 'CVE-2026-1000',
      package: 'libfoo',
    },
    {
      target: 'image/rootfs',
      type: 'misconfiguration',
      severity: 'CRITICAL',
      id: 'DS002',
      package: 'unknown package',
    },
    {
      target: 'image/rootfs',
      type: 'secret',
      severity: 'HIGH',
      id: 'generic-api-key',
      package: 'unknown package',
    },
  ]);
});

test('returns no gate findings when all reported severities are below high', () => {
  assert.deepEqual(
    evaluateTrivyReport({
      Results: [{
        Vulnerabilities: [{ Severity: 'MEDIUM', VulnerabilityID: 'CVE-2026-1000' }],
        Misconfigurations: [{ Severity: 'LOW', ID: 'DS001' }],
        Secrets: [],
      }],
    }),
    [],
  );
});

test('rejects malformed scanner results instead of silently allowing promotion', () => {
  assert.throws(() => evaluateTrivyReport({}), /Results array/);
  assert.throws(
    () => evaluateTrivyReport({ Results: [{ Secrets: {} }] }),
    /Secrets must be an array/,
  );
});

test('formats safe finding metadata without exposing a secret match', () => {
  const [finding] = evaluateTrivyReport({
    Results: [{
      Target: 'image/rootfs',
      Secrets: [{
        Severity: 'CRITICAL',
        RuleID: 'generic-password',
        Match: 'sensitive-token-value',
      }],
    }],
  });

  const summary = formatTrivyFinding(finding);
  assert.equal(summary, 'image/rootfs | secret | CRITICAL | generic-password | unknown package');
  assert.equal(summary.includes('sensitive-token-value'), false);
});

test('creates an artifact summary that contains no raw secret fields', () => {
  const findings = evaluateTrivyReport({
    Results: [{
      Target: 'image/rootfs',
      Secrets: [{
        Severity: 'HIGH',
        RuleID: 'generic-api-key',
        Match: 'sensitive-token-value',
        Code: { Lines: [{ Content: 'token=sensitive-token-value' }] },
      }],
    }],
  });

  const summary = createTrivySummary(findings);
  assert.deepEqual(summary, {
    findingCount: 1,
    findings: [{
      target: 'image/rootfs',
      type: 'secret',
      severity: 'HIGH',
      id: 'generic-api-key',
      package: 'unknown package',
    }],
  });
  assert.equal(JSON.stringify(summary).includes('sensitive-token-value'), false);
});

test('writes a redacted summary before failing the gate on an embedded secret', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivy-gate-test-'));
  const reportPath = join(directory, 'raw-report.json');
  const summaryPath = join(directory, 'safe-summary.json');

  try {
    writeFileSync(reportPath, JSON.stringify({
      Results: [{
        Target: 'image/rootfs',
        Secrets: [{
          Severity: 'CRITICAL',
          RuleID: 'generic-api-key',
          Match: 'sensitive-token-value',
          Code: { Lines: [{ Content: 'token=sensitive-token-value' }] },
        }],
      }],
    }));

    const result = spawnSync(process.execPath, [checkerPath, reportPath, '--summary', summaryPath], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /1 high or critical image findings found/);
    assert.equal(`${result.stdout}${result.stderr}`.includes('sensitive-token-value'), false);
    assert.deepEqual(JSON.parse(readFileSync(summaryPath, 'utf8')), {
      findingCount: 1,
      findings: [{
        target: 'image/rootfs',
        type: 'secret',
        severity: 'CRITICAL',
        id: 'generic-api-key',
        package: 'unknown package',
      }],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
