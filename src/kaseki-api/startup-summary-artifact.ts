/**
 * Startup Summary Artifact Writer
 *
 * Writes startup health reports to JSON and markdown artifacts
 * Caches in memory for API endpoint access
 */

import * as fs from 'fs';
import * as path from 'path';
import { createEventLogger } from '../logger';
import type { StartupHealthReport } from '../kaseki-api-types';
import { healthReportToMarkdown } from './startup-health-reporter';

const logger = createEventLogger('startup-artifacts');

let cachedHealthReport: StartupHealthReport | null = null;

/**
 * Write startup health report to artifacts directory
 *
 * Writes two files:
 * - startup-health-report.json (structured for parsing)
 * - startup-summary.md (human-readable)
 *
 * @param resultsDir - Directory to write artifacts to
 * @param report - Health report to write
 * @throws Error if write fails
 */
export function writeStartupHealthArtifacts(
  resultsDir: string,
  report: StartupHealthReport
): void {
  try {
    // Ensure directory exists
    fs.mkdirSync(resultsDir, { recursive: true });

    // Write JSON
    const jsonPath = path.join(resultsDir, 'startup-health-report.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    logger.debug('Wrote startup health report (JSON)', { filePath: jsonPath });

    // Write Markdown
    const markdown = healthReportToMarkdown(report);
    const mdPath = path.join(resultsDir, 'startup-summary.md');
    fs.writeFileSync(mdPath, markdown, 'utf-8');
    logger.debug('Wrote startup health report (Markdown)', { filePath: mdPath });

    // Cache for API access
    cachedHealthReport = report;
    logger.debug('Cached startup health report in memory');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to write startup health artifacts', {
      error: errorMsg,
      resultsDir,
    });
    throw new Error(`Failed to write startup artifacts: ${errorMsg}`);
  }
}

/**
 * Get cached startup health report (populated after startup)
 * Returns null if not yet generated
 */
export function getCachedStartupHealthReport(): StartupHealthReport | null {
  return cachedHealthReport;
}

/**
 * Clear cached report (for testing)
 */
export function clearCachedStartupHealthReport(): void {
  cachedHealthReport = null;
}
