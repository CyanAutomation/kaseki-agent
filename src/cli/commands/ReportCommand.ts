/**
 * Report Command
 * Generate report for completed instance
 */

import fs from 'fs/promises';
import path from 'path';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';

const logger = createLogger('report-cmd');

export class ReportCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      const { positional } = this.parseArgs(args);
      const instanceId = positional[0];
      void args; // TODO: use remaining args when implemented

      if (!instanceId) {
        console.error('Usage: kaseki-agent report <INSTANCE_ID>');
        return 1;
      }

      console.log(`📊 Report: ${instanceId}\n`);

      // Load configuration
      await this.configManager.load();

      const kasekiRoot = this.configManager.get('directories.root');
      const resultsDir = path.join(kasekiRoot, 'kaseki-results', instanceId);

      // Read metadata
      try {
        const metadataPath = path.join(resultsDir, 'metadata.json');
        const content = await fs.readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(content);

        // Display metadata
        console.log('Instance Information');
        console.log('-------------------');
        console.log(`ID:        ${metadata.id}`);
        console.log(`Status:    ${metadata.status}`);
        console.log(`Created:   ${new Date(metadata.createdAt).toLocaleString()}`);

        if (metadata.completedAt) {
          console.log(`Completed: ${new Date(metadata.completedAt).toLocaleString()}`);
        }

        if (metadata.repoUrl) {
          console.log(`Repo:      ${metadata.repoUrl}`);
        }

        if (metadata.gitRef) {
          console.log(`Ref:       ${metadata.gitRef}`);
        }

        if (metadata.model) {
          console.log(`Model:     ${metadata.model}`);
        }

        // Display stages
        if (metadata.stages && Object.keys(metadata.stages).length > 0) {
          console.log('\nStages');
          console.log('------');

          for (const [stage, info] of Object.entries(metadata.stages)) {
            const stageInfo = info as any;
            console.log(`${stage}:`);
            if (stageInfo.duration) {
              console.log(`  Duration: ${stageInfo.duration.toFixed(1)}s`);
            }
            if (stageInfo.exitCode !== undefined) {
              console.log(`  Exit Code: ${stageInfo.exitCode}`);
            }
          }
        }

        // Display summary
        if (metadata.status === 'completed' && metadata.exitCode === 0) {
          console.log('\n✅ Instance completed successfully');
        } else if (metadata.status === 'completed') {
          console.log(`\n❌ Instance failed with exit code ${metadata.exitCode}`);
        } else {
          console.log(`\n⏳ Instance status: ${metadata.status}`);
        }

        // Try to read and show summary
        try {
          const summaryPath = path.join(resultsDir, 'result-summary.md');
          const summary = await fs.readFile(summaryPath, 'utf-8');
          console.log('\nDetailed Summary');
          console.log('----------------');
          console.log(summary);
        } catch {
          // Summary file not found, that's okay
        }

        return metadata.exitCode === 0 ? 0 : 1;
      } catch (error) {
        console.error(`Instance not found: ${instanceId}`);
        logger.debug(`Failed to read instance: ${error}`);
        return 1;
      }
    } catch (error) {
      logger.error(`Report failed: ${error}`);
      return 1;
    }
  }
}
