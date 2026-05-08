/**
 * Serve Command
 * Start kaseki API service
 */

import { BaseCommand } from '../BaseCommand';
import { KasekiAPIService } from '../../kaseki-api-service-wrapper';
import { createLogger } from '../../logger';

const logger = createLogger('serve-cmd');

export class ServeCommand extends BaseCommand {
  async execute(args: string[]): Promise<number> {
    try {
      const { flags } = this.parseArgs(args);
      const portValue = flags.get('port');
      const port = parseInt(
        (typeof portValue === 'string' ? portValue : undefined) || '8080',
        10
      );

      console.log('🚀 Kaseki API Service\n');

      await this.configManager.load();

      // Get API keys from config or environment
      const apiKeysEnv = process.env.KASEKI_API_KEYS || '';
      const apiKeys = apiKeysEnv ? apiKeysEnv.split(',') : [];

      // Create and start service
      const apiService = new KasekiAPIService({
        port,
        apiKeys,
        logLevel: this.configManager.get('debug.log_level', 'info'),
      });

      await apiService.start();

      console.log('Press Ctrl+C to stop the service\n');

      // Keep the process alive
      return new Promise((resolve) => {
        process.on('SIGINT', async () => {
          console.log('\n\nShutting down...');
          await apiService.stop();
          console.log('✓ Service stopped');
          resolve(0);
        });

        process.on('SIGTERM', async () => {
          console.log('\n\nShutting down...');
          await apiService.stop();
          console.log('✓ Service stopped');
          resolve(0);
        });
      });
    } catch (error) {
      logger.error(`Serve failed: ${error}`);
      return 1;
    }
  }
}
