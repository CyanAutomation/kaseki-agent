/**
 * List Command
 * List all kaseki instances
 */

import fs from 'fs/promises';
import path from 'path';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';

const logger = createLogger('list-cmd');

interface InstanceSummary {
  id: string;
  status: string;
  createdAt: string;
  duration?: number;
  exitCode?: number;
}

export class ListCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      const { flags } = this.parseArgs(args);
      const statusFilter = flags.get('status') as string | undefined;

      console.log('📋 Kaseki Instances\n');

      // Load configuration
      await this.configManager.load();

      const kasekiRoot = this.configManager.get('directories.root');
      const resultsDir = path.join(kasekiRoot, 'kaseki-results');

      // Read instances
      const instances: InstanceSummary[] = [];

      try {
        const entries = await fs.readdir(resultsDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith('kaseki-')) {
            try {
              const metadataPath = path.join(resultsDir, entry.name, 'metadata.json');
              const content = await fs.readFile(metadataPath, 'utf-8');
              const metadata = JSON.parse(content);

              // Apply status filter
              if (statusFilter && metadata.status !== statusFilter) {
                continue;
              }

              instances.push({
                id: metadata.id,
                status: metadata.status,
                createdAt: metadata.createdAt,
                duration: metadata.stages?.['agent-run']?.duration,
                exitCode: metadata.exitCode,
              });
            } catch (error) {
              logger.debug(`Failed to read metadata for ${entry.name}: ${error}`);
            }
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.error(`Failed to read results directory: ${error}`);
          return 1;
        }
        // Directory doesn't exist yet
      }

      // Sort by creation date (newest first)
      instances.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      // Display results
      if (instances.length === 0) {
        console.log('No instances found.');
        return 0;
      }

      // Print as table
      console.log('ID              | Status    | Created                | Duration (s)');
      console.log('----------------|-----------|------------------------|---------------');

      for (const inst of instances) {
        const id = inst.id.padEnd(15);
        const status = inst.status.padEnd(9);
        const created = new Date(inst.createdAt).toISOString().substring(0, 19);
        const duration = inst.duration ? inst.duration.toFixed(1) : '-';

        console.log(`${id} | ${status} | ${created} | ${duration}`);
      }

      console.log(`\nTotal: ${instances.length} instance(s)`);

      return 0;
    } catch (error) {
      logger.error(`List failed: ${error}`);
      return 1;
    }
  }
}
