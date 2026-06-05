/**
 * Tests for Preflight Summary
 *
 * Groups preflight check results and remediations by severity
 */

import { generatePreflightSummary, formatRemediationList } from './preflight-summary';
import type { PreflightCheck } from '../kaseki-api-types';

describe('Preflight Summary', () => {
  describe('generatePreflightSummary', () => {
    it('should generate ok status when all checks pass', () => {
      const checks: PreflightCheck[] = [
        { name: 'check1', ok: true, detail: 'Pass', elapsedMs: 10 },
        { name: 'check2', ok: true, detail: 'Pass', elapsedMs: 15 },
      ];

      const summary = generatePreflightSummary(checks);

      expect(summary.status).toBe('ok');
      expect(summary.checks.passed).toBe(2);
      expect(summary.checks.warnings).toBe(0);
      expect(summary.issues).toHaveLength(0);
    });

    it('should generate degraded status when checks fail', () => {
      const checks: PreflightCheck[] = [
        { name: 'check1', ok: true, detail: 'Pass' },
        {
          name: 'check2',
          ok: false,
          detail: 'Failed',
          remediation: 'Fix this',
        },
      ];

      const summary = generatePreflightSummary(checks);

      expect(summary.status).toBe('degraded');
      expect(summary.checks.passed).toBe(1);
      expect(summary.checks.warnings).toBe(1);
      expect(summary.issues.length).toBe(1);
    });

    it('should include timing in summary', () => {
      const checks: PreflightCheck[] = [
        { name: 'check1', ok: true, detail: 'Pass', elapsedMs: 25 },
      ];

      const summary = generatePreflightSummary(checks);

      expect(summary.timestamp).toBeDefined();
      expect(summary).toHaveProperty('checks');
    });
  });

  describe('formatRemediationList', () => {
    it('should format as markdown list', () => {
      const checks: PreflightCheck[] = [
        {
          name: 'git-safe-directory',
          ok: false,
          detail: 'Not configured',
          remediation: 'git config --global --add safe.directory /path',
        },
      ];

      const markdown = formatRemediationList(checks);

      expect(markdown).toContain('git-safe-directory');
      expect(markdown).toContain('git config');
      expect(markdown).toContain('##');
    });

    it('should group warnings with fixes', () => {
      const checks: PreflightCheck[] = [
        {
          name: 'check1',
          ok: false,
          detail: 'Issue 1',
          remediation: 'Fix 1',
        },
        {
          name: 'check2',
          ok: false,
          detail: 'Issue 2',
          remediation: 'Fix 2',
        },
      ];

      const markdown = formatRemediationList(checks);

      expect(markdown).toContain('check1');
      expect(markdown).toContain('check2');
      expect(markdown).toContain('Fix 1');
      expect(markdown).toContain('Fix 2');
    });
  });
});
