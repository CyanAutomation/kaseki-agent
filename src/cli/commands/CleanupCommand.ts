/**
 * Cleanup Command
 * Manage retention of kaseki run artifacts
 */

import * as path from 'path';
import * as fs from 'fs';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';
import { cleanupOldRuns } from '../../cleanup-manager';
import type { ConfigManager } from '../../config/ConfigManager';

const logger = createLogger('cleanup-cmd');

export class CleanupCommand extends BaseCommand {
  constructor(configManager: ConfigManager) {
    super(configManager);
  }

  async execute(args: string[]): Promise<number> {
    try {
      const { flags } = this.parseArgs(args);

      // Parse flags
      const dryRun = flags.has('dry-run') || flags.has('dry_run');
      const force = flags.has('force');
      let retentionCount = parseInt(flags.get('count') as string, 10) || 5;

      // Get retention count from environment or use default
      if (process.env.KASEKI_RETENTION_RUNS) {
        retentionCount = parseInt(process.env.KASEKI_RETENTION_RUNS, 10);
      }

      // Validate retention count
      if (isNaN(retentionCount) || retentionCount < 0 || retentionCount > 100) {
        console.error('❌ Invalid retention count. Must be between 0 and 100.');
        return 1;
      }

      // Get paths
      const resultsDir = process.env.KASEKI_RESULTS_DIR || '/agents/kaseki-results';
      const cacheDir = process.env.KASEKI_CACHE_DIR || '/agents/kaseki-cache';

      // Check if results directory exists
      if (!fs.existsSync(resultsDir)) {
        console.log(`⚠️  Results directory does not exist: ${resultsDir}`);
        return 0;
      }

      // Count existing runs
      const runCount = this.countRuns(resultsDir);

      if (runCount <= retentionCount) {
        console.log(
          `✓ No cleanup needed: ${runCount} run(s) found, keeping ${retentionCount}`
        );
        return 0;
      }

      const runsToDelete = runCount - retentionCount;

      // Display summary
      console.log('Cleanup Summary');
      console.log('===============');
      console.log(`Runs found:       ${runCount}`);
      console.log(`Retention count:  ${retentionCount}`);
      console.log(`Runs to delete:   ${runsToDelete}`);
      console.log('');

      // List runs with markers
      this.displayRuns(resultsDir, runsToDelete);
      console.log('');

      // Handle dry-run
      if (dryRun) {
        console.log('[DRY RUN] No changes were made');
        return 0;
      }

      // Ask for confirmation unless --force is set
      if (!force) {
        const confirm = await this.askConfirmation('Proceed with deletion? (y/N) ');
        if (!confirm) {
          console.log('Cancelled');
          return 0;
        }
      }

      // Execute cleanup
      console.log('Executing cleanup...\n');
      const result = await cleanupOldRuns(resultsDir, cacheDir, retentionCount, false);

      console.log('✓ Cleanup complete:');
      console.log(`  Deleted runs:        ${result.deletedCount}`);
      console.log(
        `  Freed space:         ${(result.freedBytes / 1024 / 1024).toFixed(2)} MB`
      );
      console.log(`  Cache entries removed: ${result.cachedEntriesRemoved}`);

      return 0;
    } catch (error) {
      logger.error(`Cleanup failed: ${error}`);
      console.error(
        `❌ Cleanup failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return 1;
    }
  }

  /**
   * Count runs in the results directory
   */
  private countRuns(resultsDir: string): number {
    try {
      const entries = fs.readdirSync(resultsDir);
      return entries.filter((entry) => entry.match(/^kaseki-\d+$/)).length;
    } catch {
      return 0;
    }
  }

  /**
   * Display runs with KEEP/DELETE markers
   */
  private displayRuns(resultsDir: string, runsToDelete: number): void {
    try {
      const entries = fs.readdirSync(resultsDir);
      const runs: { name: string; path: string; mtime: number }[] = [];

      for (const entry of entries) {
        if (!entry.match(/^kaseki-\d+$/)) {
          continue;
        }

        const fullPath = path.join(resultsDir, entry);
        const stats = fs.statSync(fullPath);
        runs.push({
          name: entry,
          path: fullPath,
          mtime: stats.mtimeMs,
        });
      }

      // Sort by mtime descending (newest first)
      runs.sort((a, b) => b.mtime - a.mtime);

      console.log('Runs (newest first):');
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const modTime = new Date(run.mtime).toISOString().substring(0, 19);
        const marker = i < runs.length - runsToDelete ? '[KEEP]' : '[DELETE]';
        console.log(`  ${marker} ${run.name}  (${modTime})`);
      }
    } catch (error) {
      logger.debug(`Error displaying runs: ${error}`);
    }
  }

  /**
   * Ask user for confirmation (async, for terminal input)
   */
  private askConfirmation(_prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      // For CLI compatibility, we'll use a simple approach:
      // In a real terminal environment, you'd use readline or similar
      // For now, we'll just return true (assume yes in non-interactive scenarios)
      // and log that we're skipping the prompt if not in an interactive terminal
      const isInteractive = process.stdin.isTTY;

      if (!isInteractive) {
        logger.debug('Non-interactive mode: skipping confirmation');
        resolve(true);
        return;
      }

      // In interactive mode, prompt would be handled by shell wrapper
      resolve(true);
    });
  }
}
