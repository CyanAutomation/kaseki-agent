/**
 * List Command
 * List all kaseki instances
 */

import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';

const logger = createLogger('list-cmd');

export class ListCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      // TODO: Parse flags for --status filter
      void args; // TODO: use args when implemented

      console.log('📋 Kaseki Instances\n');

      // TODO: Implement list command
      // - Read from /agents/kaseki-results/
      // - Parse metadata.json files
      // - Filter by status (active|completed|failed)
      // - Output as table (default) or JSON

      console.log('List command not yet implemented.');
      console.log('TODO: Implement instance listing');

      return 0;
    } catch (error) {
      logger.error(`List failed: ${error}`);
      return 1;
    }
  }
}
