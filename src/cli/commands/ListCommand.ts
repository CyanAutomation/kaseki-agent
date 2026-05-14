/**
 * List Command
 * List all kaseki instances from the local API service.
 */

import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';
import { LocalKasekiApiClient } from '../api/LocalKasekiApiClient';
import type { ConfigManager } from '../../config/ConfigManager';
import type { RunsListResponse } from '../../kaseki-api-types';

const logger = createLogger('list-cmd');

type RunsListItem = RunsListResponse['runs'][number];

export interface ListApiClient {
  readonly baseUrl: string;
  listRuns(): Promise<RunsListResponse>;
}

type ListApiClientFactory = (configManager: ConfigManager) => ListApiClient;

export class ListCommand extends BaseCommand {
  private readonly apiClientFactory: ListApiClientFactory;

  constructor(
    configManager: ConfigManager,
    apiClientFactory: ListApiClientFactory = (manager) => LocalKasekiApiClient.fromConfig(manager)
  ) {
    super(configManager);
    this.apiClientFactory = apiClientFactory;
  }

  async execute(args: string[]): Promise<number> {
    try {
      const { positional, flags } = this.parseArgs(args);
      const statusFilter = getStatusFilter(flags, positional);

      console.log('📋 Kaseki Instances\n');

      await this.configManager.load();
      const apiClient = this.apiClientFactory(this.configManager);
      const response = await apiClient.listRuns();
      const instances = response.runs
        .filter((run) => !statusFilter || run.status === statusFilter)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (instances.length === 0) {
        console.log('No instances found.');
        return 0;
      }

      console.log('ID              | Status    | Created                | Duration (s)');
      console.log('----------------|-----------|------------------------|---------------');

      for (const inst of instances) {
        const id = inst.id.padEnd(15);
        const status = inst.status.padEnd(9);
        const created = new Date(inst.createdAt).toISOString().substring(0, 19);
        const duration = calculateDurationSeconds(inst);

        console.log(`${id} | ${status} | ${created} | ${duration}`);
      }

      console.log(`\nTotal: ${instances.length} instance(s)`);

      return 0;
    } catch (error) {
      logger.error(`List failed: ${error}`);
      console.error(`❌ Unable to list runs from local Kaseki API: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
}

function calculateDurationSeconds(run: RunsListItem): string {
  if (!run.completedAt) {
    return '-';
  }

  const durationMs = new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime();
  return Number.isFinite(durationMs) && durationMs >= 0 ? (durationMs / 1000).toFixed(1) : '-';
}

function getStatusFilter(flags: Map<string, string | boolean>, positional: string[]): RunsListItem['status'] | undefined {
  const flagValue = flags.get('status');
  if (typeof flagValue === 'string') {
    return flagValue as RunsListItem['status'];
  }
  if (flagValue === true && positional[0]) {
    return positional[0] as RunsListItem['status'];
  }

  return undefined;
}
