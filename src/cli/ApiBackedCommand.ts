import { LocalKasekiApiClient } from './api/LocalKasekiApiClient';
import { BaseCommand } from './BaseCommand';
import type { ConfigManager } from '../config/ConfigManager';

export type ApiClientFactory<TClient> = (configManager: ConfigManager) => TClient;

export abstract class ApiBackedCommand<TClient> extends BaseCommand {
  protected readonly apiClientFactory: ApiClientFactory<TClient>;

  constructor(
    configManager: ConfigManager,
    apiClientFactory: ApiClientFactory<TClient> = (manager) => LocalKasekiApiClient.fromConfig(manager) as TClient,
  ) {
    super(configManager);
    this.apiClientFactory = apiClientFactory;
  }
}
