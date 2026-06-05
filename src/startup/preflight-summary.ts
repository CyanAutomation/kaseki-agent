/**
 * Preflight Summary Module
 *
 * Groups preflight check results by severity and provides
 * consolidated remediation action items
 */

import type { PreflightCheck, PreflightSummary, StartupIssue } from '../kaseki-api-types';

/**
 * Generate a preflight summary from check results
 *
 * @param checks - Array of preflight check results
 * @returns PreflightSummary with grouped issues and remediation
 */
export function generatePreflightSummary(checks: PreflightCheck[]): PreflightSummary {
  const failedChecks = checks.filter(c => !c.ok);
  const passedCount = checks.length - failedChecks.length;

  const issues: StartupIssue[] = failedChecks.map(check => ({
    severity: 'warning',
    component: check.name,
    detail: check.detail || 'Check failed',
    remediation: check.remediation,
    autoFixable: isAutoFixable(check.name),
    timestamp: new Date().toISOString(),
  }));

  const status = failedChecks.length > 0 ? 'degraded' : 'ok';

  return {
    timestamp: new Date().toISOString(),
    status,
    checks: {
      passed: passedCount,
      warnings: failedChecks.length,
    },
    issues,
  };
}

/**
 * Format preflight checks as markdown with remediation instructions
 *
 * @param checks - Array of preflight checks
 * @returns Markdown string with grouped issues and fixes
 */
export function formatRemediationList(checks: PreflightCheck[]): string {
  const failedChecks = checks.filter(c => !c.ok);

  if (failedChecks.length === 0) {
    return '# Preflight Remediation\n\n✓ No issues found\n';
  }

  const lines: string[] = [];

  lines.push('# Preflight Remediation\n');
  lines.push(`## Issues Found: ${failedChecks.length}\n`);

  for (const check of failedChecks) {
    const autoFixable = isAutoFixable(check.name);
    lines.push(`### ${check.name}`);
    lines.push('**Status:** ⚠️ Warning\n');

    if (check.detail) {
      lines.push(`**Issue:** ${check.detail}\n`);
    }

    if (check.remediation) {
      lines.push('**Fix:**\n```bash');
      lines.push(check.remediation);
      lines.push('```\n');
    }

    if (autoFixable) {
      lines.push('**Note:** This issue can be auto-fixed on next startup.\n');
    }
  }

  return lines.join('\n');
}

/**
 * Determine if an issue can be auto-fixed
 */
function isAutoFixable(checkName: string): boolean {
  const autoFixableChecks = [
    'git-safe-directory', // Can be fixed by git config command
  ];
  return autoFixableChecks.includes(checkName);
}

/**
 * Convert preflight summary to markdown
 */
export function preflightSummaryToMarkdown(summary: PreflightSummary): string {
  const lines: string[] = [];

  lines.push('# Preflight Health Summary\n');

  const statusEmoji = summary.status === 'ok' ? '✅' : '⚠️';
  const statusText =
    summary.status === 'ok'
      ? `ok (${summary.checks.passed} passed)`
      : `degraded (${summary.checks.passed} passed, ${summary.checks.warnings} warnings)`;

  lines.push(`**Status:** ${statusEmoji} ${statusText}\n`);

  if (summary.issues.length > 0) {
    lines.push('## Issues\n');

    for (const issue of summary.issues) {
      lines.push(`- **${issue.component}** — ${issue.detail}`);

      if (issue.remediation) {
        lines.push(`  - Fix: \`${issue.remediation}\``);
      }

      if (issue.autoFixable) {
        lines.push('  - Auto-fixable: Yes');
      }

      lines.push('');
    }
  } else {
    lines.push('## Issues\n');
    lines.push('✓ All checks passed\n');
  }

  return lines.join('\n');
}
