/**
 * Startup Health Reporter
 *
 * Consolidates bootstrap timing, preflight checks, and environment data
 * into a unified health report for external monitoring and user visibility
 */

import type { PreflightCheck, StartupHealthReport, StartupIssue } from '../kaseki-api-types';

/**
 * Categorizes preflight check failures into startup issues
 * Groups by severity and includes remediation information
 *
 * @param checks - Array of preflight check results
 * @returns Array of StartupIssue objects categorized by severity
 */
export function categorizeStartupIssues(checks: PreflightCheck[]): StartupIssue[] {
  const failedChecks = checks.filter(check => !check.ok);

  return failedChecks.map(check => {
    const severity = determineSeverity(check.name);
    const autoFixable = isAutoFixable(check.name);

    return {
      severity,
      component: check.name,
      detail: check.detail || 'Check failed',
      remediation: check.remediation,
      autoFixable,
      timestamp: new Date().toISOString(),
    };
  });
}

/**
 * Determines severity level based on check type
 */
function determineSeverity(checkName: string): 'blocking' | 'warning' | 'info' {
  const blockingChecks = [
    'setup-completeness',
    'secrets-readable',
    'checkout-exists',
  ];

  if (blockingChecks.includes(checkName)) {
    return 'blocking';
  }

  // Most preflight checks are warnings (non-blocking)
  return 'warning';
}

/**
 * Determines if an issue can be auto-fixed
 */
function isAutoFixable(checkName: string): boolean {
  const autoFixableChecks = ['git-safe-directory'];
  return autoFixableChecks.includes(checkName);
}

/**
 * Generates a unified startup health report
 *
 * @param bootstrapDurationMs - Time to bootstrap all services
 * @param preflightDurationMs - Time to run preflight checks
 * @param preflight Checks - Array of preflight check results
 * @param componentTimings - Map of component name to duration in ms
 * @returns StartupHealthReport with consolidated health data
 */
export function generateStartupHealthReport(
  bootstrapDurationMs: number,
  preflightDurationMs: number,
  preflightChecks: PreflightCheck[],
  componentTimings: Record<string, number> = {}
): StartupHealthReport {
  const issues = categorizeStartupIssues(preflightChecks);

  // Build component timing info
  const components: Record<string, { durationMs: number; status: string; reason?: string; name?: string }> = {};
  const slowComponentThreshold = 1000; // 1 second

  for (const [name, durationMs] of Object.entries(componentTimings)) {
    const status = durationMs > slowComponentThreshold ? 'warning' : 'ok';
    const reason = durationMs > slowComponentThreshold ? 'slow_init' : undefined;

    components[name] = {
      name,
      durationMs,
      status,
      ...(reason && { reason }),
    };
  }

  // Build preflight check summary
  const preflight: Record<string, { ok: boolean; elapsedMs?: number; detail?: string }> = {};
  const passedChecks = preflightChecks.filter(c => c.ok);

  for (const check of preflightChecks) {
    preflight[check.name] = {
      ok: check.ok,
      ...(check.elapsedMs && { elapsedMs: check.elapsedMs }),
      ...(check.detail && { detail: check.detail }),
    };
  }

  const totalMs = bootstrapDurationMs + preflightDurationMs;

  // Determine overall status
  const blockingIssues = issues.filter(i => i.severity === 'blocking');
  const status = blockingIssues.length > 0 ? 'error' : issues.length > 0 ? 'degraded' : 'ok';

  return {
    timestamp: new Date().toISOString(),
    status,
    summary: {
      passed: passedChecks.length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      blocking: blockingIssues.length,
    },
    timing: {
      bootstrapMs: Math.round(bootstrapDurationMs),
      preflightMs: Math.round(preflightDurationMs),
      totalMs: Math.round(totalMs),
    },
    components: components as Record<string, any>,
    preflight,
    issues,
  };
}

/**
 * Converts health report to human-readable markdown
 */
export function healthReportToMarkdown(report: StartupHealthReport): string {
  const lines: string[] = [];

  lines.push('# Startup Health Report\n');
  lines.push('> Historical boot-time snapshot only. It does not determine current readiness; use `/api/preflight` for live diagnostics.\n');
  lines.push(`**Status:** ${getStatusEmoji(report.status)} ${report.status.toUpperCase()}\n`);

  lines.push('## Summary');
  lines.push(`- Passed: ${report.summary.passed}`);
  lines.push(`- Warnings: ${report.summary.warnings}`);
  lines.push(`- Blocking Issues: ${report.summary.blocking}\n`);

  lines.push('## Timing');
  lines.push(`- Bootstrap: ${report.timing.bootstrapMs}ms`);
  lines.push(`- Preflight: ${report.timing.preflightMs}ms`);
  lines.push(`- **Total: ${report.timing.totalMs}ms**\n`);

  if (Object.keys(report.components).length > 0) {
    lines.push('## Components');
    for (const [name, timing] of Object.entries(report.components)) {
      const icon = timing.status === 'warning' ? '⚠️' : '✓';
      lines.push(`${icon} ${name} (${timing.durationMs.toFixed(1)}ms)`);
      if (timing.reason) {
        lines.push(`  └─ ${timing.reason}`);
      }
    }
    lines.push('');
  }

  if (report.issues.length > 0) {
    lines.push('## Issues\n');
    for (const issue of report.issues) {
      const severityIcon =
        issue.severity === 'blocking'
          ? '🔴'
          : issue.severity === 'warning'
            ? '🟡'
            : '🔵';
      lines.push(`${severityIcon} **${issue.component}** (${issue.severity})`);
      lines.push(`   ${issue.detail}`);
      if (issue.remediation) {
        lines.push(`   → Fix: \`${issue.remediation}\``);
      }
      if (issue.autoFixable) {
        lines.push('   → Auto-fixable: Yes');
      }
      lines.push('');
    }
  } else {
    lines.push('## Issues\n');
    lines.push('✓ No issues found\n');
  }

  lines.push(`_Generated: ${report.timestamp}_`);

  return lines.join('\n');
}

/**
 * Get emoji for status
 */
function getStatusEmoji(status: string): string {
  switch (status) {
  case 'ok':
    return '✅';
  case 'degraded':
    return '⚠️';
  case 'error':
    return '❌';
  default:
    return '❓';
  }
}
