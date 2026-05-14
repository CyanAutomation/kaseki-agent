/**
 * Status Command
 * Poll a kaseki run through the local API service.
 */

import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';
import { LocalKasekiApiClient } from '../api/LocalKasekiApiClient';
import type { ConfigManager } from '../../config/ConfigManager';
import type { StatusResponse } from '../../kaseki-api-types';

const logger = createLogger('status-cmd');

export interface StatusApiClient {
  readonly baseUrl: string;
  getRunStatus(runId: string): Promise<StatusResponse>;
}

type StatusApiClientFactory = (configManager: ConfigManager) => StatusApiClient;

export class StatusCommand extends BaseCommand {
  private readonly apiClientFactory: StatusApiClientFactory;

  constructor(
    configManager: ConfigManager,
    apiClientFactory: StatusApiClientFactory = (manager) => LocalKasekiApiClient.fromConfig(manager)
  ) {
    super(configManager);
    this.apiClientFactory = apiClientFactory;
  }

  async execute(args: string[]): Promise<number> {
    try {
      const { positional, flags } = this.parseArgs(args);
      const runId = positional[0];

      if (!runId) {
        console.error('Usage: kaseki-agent status <RUN_ID> [--json]');
        return 1;
      }

      await this.configManager.load();
      const apiClient = this.apiClientFactory(this.configManager);
      const status = await apiClient.getRunStatus(runId);

      if (flags.has('json')) {
        console.log(JSON.stringify(status, null, 2));
        return status.exitCode === undefined ? 0 : status.exitCode === 0 ? 0 : 1;
      }

      console.log(`Status for ${status.id} (via ${apiClient.baseUrl})`);
      console.log('----------------------------------------');
      console.log(`State:     ${status.status}`);
      if (status.progress) {
        const percent = status.progress.percentComplete !== undefined ? ` (${status.progress.percentComplete}%)` : '';
        const message = status.progress.message ? ` - ${status.progress.message}` : '';
        console.log(`Progress:  ${status.progress.stage}${percent}${message}`);
      }
      if (status.elapsedSeconds !== undefined) {
        console.log(`Elapsed:   ${status.elapsedSeconds}s`);
      }
      if (status.timeoutRiskPercent !== undefined) {
        console.log(`Timeout:   ${status.timeoutRiskPercent}%`);
      }
      if (status.exitCode !== undefined) {
        console.log(`Exit Code: ${status.exitCode}`);
      }
      if (status.failureClass) {
        console.log(`Failure:   ${status.failureClass}`);
      }
      if (status.error) {
        console.log(`Error:     ${status.error}`);
      }

      return status.exitCode === undefined ? 0 : status.exitCode === 0 ? 0 : 1;
    } catch (error) {
      logger.error(`Status failed: ${error}`);
      console.error(`❌ Unable to fetch run status from local Kaseki API: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
}
