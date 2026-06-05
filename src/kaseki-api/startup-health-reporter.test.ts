/**
 * Tests for Startup Health Reporter
 * 
 * Consolidates bootstrap, preflight, and environment data into a unified health report
 */

import { generateStartupHealthReport, categorizeStartupIssues } from './startup-health-reporter';
import type { PreflightCheck } from '../kaseki-api-types';

describe('Startup Health Reporter', () => {
  describe('generateStartupHealthReport', () => {
    it('should generate a report with ok status when no issues', () => {
      const checks: PreflightCheck[] = [
        { name: 'check1', ok: true, detail: 'Pass', elapsedMs: 10 },
        { name: 'check2', ok: true, detail: 'Pass', elapsedMs: 15 },
      ];

      const report = generateStartupHealthReport(
        156,  // bootstrapDurationMs
        42,   // preflightDurationMs
        checks,
        {     // componentTimings
          ResultCache: 12.3,
          WebhookManager: 18.5,
          JobScheduler: 89.2,
        }
      );

      expect(report.status).toBe('ok');
      expect(report.summary.passed).toBe(2);
      expect(report.summary.warnings).toBe(0);
      expect(report.timing.totalMs).toBe(198);
    });

    it('should generate a report with degraded status when warnings exist', () => {
      const checks: PreflightCheck[] = [
        { name: 'check1', ok: true, detail: 'Pass', elapsedMs: 10 },
        {
          name: 'check2',
          ok: false,
          detail: 'Warning',
          remediation: 'Fix this',
          elapsedMs: 15,
        },
      ];

      const report = generateStartupHealthReport(156, 42, checks, {});

      expect(report.status).toBe('degraded');
      expect(report.summary.warnings).toBe(1);
      expect(report.issues.length).toBeGreaterThan(0);
    });

    it('should detect slow components above threshold', () => {
      const checks: PreflightCheck[] = [{ name: 'check1', ok: true, detail: 'Pass' }];

      const report = generateStartupHealthReport(156, 42, checks, {
        SlowComponent: 1200, // Above 1000ms threshold
      });

      expect(report.components.SlowComponent.status).toBe('warning');
      expect(report.components.SlowComponent.reason).toContain('slow');
    });

    it('should categorize issues by severity', () => {
      const checks: PreflightCheck[] = [
        {
          name: 'blocking-issue',
          ok: false,
          detail: 'Critical failure',
          remediation: 'Fix immediately',
          elapsedMs: 10,
        },
      ];

      const report = generateStartupHealthReport(156, 42, checks, {});

      expect(report.issues.some(i => i.severity === 'warning')).toBe(true);
    });

    it('should include timestamp in ISO 8601 format', () => {
      const checks: PreflightCheck[] = [
        { name: 'check1', ok: true, detail: 'Pass' },
      ];
      const report = generateStartupHealthReport(156, 42, checks, {});

      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('categorizeStartupIssues', () => {
    it('should return empty array when no failed checks', () => {
      const checks: PreflightCheck[] = [
        { name: 'check1', ok: true, detail: 'Pass' },
      ];

      const issues = categorizeStartupIssues(checks);

      expect(issues).toHaveLength(0);
    });

    it('should include remediation info when available', () => {
      const checks: PreflightCheck[] = [
        {
          name: 'git-safe-directory',
          ok: false,
          detail: 'Not configured',
          remediation: 'git config --global --add safe.directory /path',
        },
      ];

      const issues = categorizeStartupIssues(checks);

      expect(issues[0].remediation).toBe(
        'git config --global --add safe.directory /path'
      );
    });

    it('should mark auto-fixable issues', () => {
      const checks: PreflightCheck[] = [
        {
          name: 'git-safe-directory',
          ok: false,
          detail: 'Not configured',
          remediation: 'git config ...',
        },
      ];

      const issues = categorizeStartupIssues(checks);

      // git-safe-directory is auto-fixable based on issue type
      expect(issues[0]).toHaveProperty('autoFixable');
    });
  });
});
