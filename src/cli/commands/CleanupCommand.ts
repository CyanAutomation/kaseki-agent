/**
 * Cleanup Command
 * Manage retention of kaseki run artifacts
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';
import {
  cleanupOldRuns,
  createCleanupPlan,
  type CleanupPlan,
} from '../../cleanup-manager';
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
      const countFlag = flags.get('count');
      let retentionCount =
        typeof countFlag === 'string' ? parseInt(countFlag, 10) : 5;

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
      const resultsDir =
        process.env.KASEKI_RESULTS_DIR || '/agents/kaseki-results';
      const cacheDir = process.env.KASEKI_CACHE_DIR || '/agents/kaseki-cache';

      // Check if results directory exists
      if (!fs.existsSync(resultsDir)) {
        console.log(`⚠️  Results directory does not exist: ${resultsDir}`);
        return 0;
      }

      // Consult the scheduler-owned durable job index before presenting any run
      // as deletable. cleanupOldRuns reads it again immediately before deletion.
      const plan = createCleanupPlan(resultsDir, retentionCount);
      const runCount = plan.allRuns.length;

      if (plan.runsToDelete.length === 0) {
        console.log(
          `✓ No cleanup needed: ${runCount} run(s) found, keeping ${retentionCount}`,
        );
        return 0;
      }

      const runsToDelete = plan.runsToDelete.length;

      // Display summary
      console.log('Cleanup Summary');
      console.log('===============');
      console.log(`Runs found:       ${runCount}`);
      console.log(`Retention count:  ${retentionCount}`);
      console.log(`Runs to delete:   ${runsToDelete}`);
      console.log('');

      // List runs with markers
      this.displayRuns(plan);
      console.log('');

      // Handle dry-run
      if (dryRun) {
        console.log('[DRY RUN] No changes were made');
        return 0;
      }

      // Ask for confirmation unless --force is set
      if (!force) {
        const confirm = await this.askConfirmation(
          'Proceed with deletion? (y/N) ',
        );
        if (!confirm) {
          console.log('Cancelled');
          return 0;
        }
      }

      // Execute cleanup
      console.log('Executing cleanup...\n');
      const result = await cleanupOldRuns(
        resultsDir,
        cacheDir,
        retentionCount,
        false,
      );

      console.log('✓ Cleanup complete:');
      console.log(`  Deleted runs:        ${result.deletedCount}`);
      console.log(
        `  Freed space:         ${(result.freedBytes / 1024 / 1024).toFixed(2)} MB`,
      );
      console.log(`  Cache entries removed: ${result.cachedEntriesRemoved}`);

      return 0;
    } catch (error) {
      logger.error(`Cleanup failed: ${error}`);
      console.error(
        `❌ Cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }

  /**
   * Display runs with KEEP/DELETE markers
   */
  private displayRuns(plan: CleanupPlan): void {
    try {
      const runsToDelete = new Set(plan.runsToDelete.map((run) => run.name));

      console.log('Runs (newest first):');
      for (const run of plan.allRuns) {
        const modTime = new Date(run.mtime).toISOString().substring(0, 19);
        const marker = runsToDelete.has(run.name) ? '[DELETE]' : '[KEEP]';
        console.log(`  ${marker} ${run.name}  (${modTime})`);
      }
    } catch (error) {
      logger.debug(`Error displaying runs: ${error}`);
    }
  }

  /**
   * Ask user for confirmation (async, for terminal input)
   */
  private askConfirmation(prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!process.stdin.isTTY) {
        logger.debug('Non-interactive mode: rejecting cleanup without --force');
        resolve(false);
        return;
      }

      let settled = false;
      let terminal: readline.Interface | undefined;
      const handleInputError = (): void => finish(false);

      const finish = (confirmed: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        process.stdin.removeListener('error', handleInputError);
        terminal?.close();
        resolve(confirmed);
      };

      try {
        terminal = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        terminal.once('close', () => finish(false));
        terminal.once('error', () => finish(false));
        process.stdin.once('error', handleInputError);
        terminal.question(prompt, (answer) => {
          const normalizedAnswer = answer.trim().toLowerCase();
          finish(normalizedAnswer === 'y' || normalizedAnswer === 'yes');
        });
      } catch (error) {
        logger.debug(`Unable to read cleanup confirmation: ${error}`);
        finish(false);
      }
    });
  }
}
