/**
 * Cancel Command
 * Stop a queued or running kaseki run through the local API service.
 */

import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';
import { LocalKasekiApiClient } from '../api/LocalKasekiApiClient';
import type { ConfigManager } from '../../config/ConfigManager';
import type { StatusResponse } from '../../kaseki-api-types';

const logger = createLogger('cancel-cmd');

export interface CancelApiClient {
  readonly baseUrl: string;
  cancelRun(runId: string): Promise<StatusResponse>;
}

type CancelApiClientFactory = (configManager: ConfigManager) => CancelApiClient;

export class CancelCommand extends BaseCommand {
  private readonly apiClientFactory: CancelApiClientFactory;

  constructor(
    configManager: ConfigManager,
    apiClientFactory: CancelApiClientFactory = (manager) => LocalKasekiApiClient.fromConfig(manager)
  ) {
    super(configManager);
    this.apiClientFactory = apiClientFactory;
  }

  async execute(args: string[]): Promise<number> {
    try {
      const { positional, flags } = this.parseArgs(args);
      const runId = positional[0];

      if (!runId) {
        console.error('Usage: kaseki-agent cancel <RUN_ID> [--json]');
        return 1;
      }

      await this.configManager.load();
      const apiClient = this.apiClientFactory(this.configManager);
      const status = await apiClient.cancelRun(runId);

      if (flags.has('json')) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(`🛑 Cancellation requested for ${status.id} through ${apiClient.baseUrl}`);
      console.log(`Status: ${status.status}`);
      if (status.failureClass) {
        console.log(`Failure: ${status.failureClass}`);
      }
      if (status.error) {
        console.log(`Error: ${status.error}`);
      }

      return 0;
    } catch (error) {
      logger.error(`Cancel failed: ${error}`);
      console.error(`❌ Unable to cancel run through local Kaseki API: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
}
