/**
 * Setup Command
 * Interactive setup wizard for first-time configuration
 *
 * DEPRECATED: Use `kaseki-agent init` instead (unified setup wizard)
 * This command now delegates to SetupWizard for backwards compatibility
 */

import { SetupWizard } from '../../setup/SetupWizard';
import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';

const logger = createLogger('setup-cmd');

export class SetupCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      // Show deprecation notice
      console.log('\n⚠️  Note: "kaseki-agent setup" is now "kaseki-agent init"');
      console.log('   The unified setup wizard provides a simpler experience.\n');

      // Check for --dry-run flag
      const dryRun = args.includes('--dry-run');

      // Use new unified wizard
      const wizard = new SetupWizard();
      await wizard.run({ dryRun });

      return 0;
    } catch (error) {
      logger.error(`Setup failed: ${error}`);
      if (process.env.DEBUG === '1') {
        console.error(error);
      }
      return 1;
    }
  }
}

