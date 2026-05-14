/**
 * Run Command
 * Submit kaseki agent runs to the local API service.
 */

import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';
import { RunRequestSchema, type RunRequest, type RunResponse } from '../../kaseki-api-types';
import { LocalKasekiApiClient } from '../api/LocalKasekiApiClient';
import type { ConfigManager } from '../../config/ConfigManager';

const logger = createLogger('run-cmd');

export interface RunApiClient {
  readonly baseUrl: string;
  createRun(request: RunRequest): Promise<RunResponse>;
  getRunStatusUrl(runId: string): string;
}

type RunApiClientFactory = (configManager: ConfigManager) => RunApiClient;

export class RunCommand extends BaseCommand {
  private readonly apiClientFactory: RunApiClientFactory;

  constructor(
    configManager: ConfigManager,
    apiClientFactory: RunApiClientFactory = (manager) => LocalKasekiApiClient.fromConfig(manager)
  ) {
    super(configManager);
    this.apiClientFactory = apiClientFactory;
  }

  async execute(args: string[]): Promise<number> {
    try {
      const { positional, flags } = this.parseArgs(args);

      if (flags.has('local-direct')) {
        console.error('❌ --local-direct is no longer supported. Start the local API service and run without this flag.');
        return 1;
      }

      await this.configManager.load();

      const repoUrl = positional[0] || this.configManager.get('repo.url', '');
      const gitRef = positional[1] || this.configManager.get('repo.ref', 'main');
      const taskPrompt = positional[2] || this.configManager.get('repo.task_prompt', '');

      if (!repoUrl || !gitRef) {
        console.error('Usage: kaseki-agent run <REPO_URL> [GIT_REF] [TASK_PROMPT]');
        console.error('Example: kaseki-agent run https://github.com/org/repo main');
        return 1;
      }

      const runRequest = this.buildRunRequest(repoUrl, gitRef, taskPrompt);
      const apiClient = this.apiClientFactory(this.configManager);

      console.log('🚀 Kaseki Agent Runner\n');
      console.log(`Repository: ${runRequest.repoUrl}`);
      console.log(`Branch: ${runRequest.ref}`);
      console.log(`API: ${apiClient.baseUrl}\n`);
      console.log('Submitting run to local Kaseki API...');

      const run = await apiClient.createRun(runRequest);
      const statusUrl = apiClient.getRunStatusUrl(run.id);

      console.log('\n✅ Run submitted');
      console.log(`Job ID: ${run.id}`);
      console.log(`Status: ${run.status}`);
      console.log(`Status URL: ${statusUrl}`);
      console.log('\nPolling:');
      console.log(`  kaseki-agent status ${run.id}`);
      console.log(`  curl ${statusUrl}`);

      return 0;
    } catch (error) {
      logger.error(`Run failed: ${error}`);
      console.error(`❌ Run failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  private buildRunRequest(repoUrl: string, gitRef: string, taskPrompt: string): RunRequest {
    const request: Record<string, unknown> = {
      repoUrl,
      ref: gitRef,
    };

    if (taskPrompt) {
      request.taskPrompt = taskPrompt;
    }

    const allowlist = this.configManager.get<string[]>('validation.allowlist', []);
    if (allowlist.length > 0) {
      request.changedFilesAllowlist = allowlist;
    }

    const maxDiffBytes = this.configManager.get<number>('validation.max_diff_bytes', 0);
    if (maxDiffBytes) {
      request.maxDiffBytes = maxDiffBytes;
    }

    const validationCommands = this.configManager.get<string[]>('validation.commands', []);
    if (validationCommands.length > 0) {
      request.validationCommands = validationCommands;
    }

    const taskMode = this.configManager.get<'patch' | 'inspect'>('repo.task_mode', 'patch');
    if (taskMode) {
      request.taskMode = taskMode;
    }

    const githubPublishMode = this.configManager.get<string>('github.publish_mode', 'auto');
    request.publishMode = githubPublishMode === 'off' ? 'none' : githubPublishMode === 'on' ? 'pr' : githubPublishMode;

    const timeoutSeconds = this.configManager.get<number>('agent.timeout_seconds', 0);
    if (timeoutSeconds) {
      request.timeoutSeconds = timeoutSeconds;
    }

    return RunRequestSchema.parse(request);
  }
}
