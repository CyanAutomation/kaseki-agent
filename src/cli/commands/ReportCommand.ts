/**
 * Report Command
 * Generate report for a run using the local API by default.
 */

import { BaseCommand } from '../BaseCommand';
import { createLogger } from '../../logger';
import { LocalKasekiApiClient } from '../api/LocalKasekiApiClient';
import type { ConfigManager } from '../../config/ConfigManager';
import type { AnalysisResponse, LogResponse, RunArtifactsResponse, StatusResponse } from '../../kaseki-api-types';

const logger = createLogger('report-cmd');

export interface ReportApiClient {
  readonly baseUrl: string;
  getRunStatus(runId: string): Promise<StatusResponse>;
  getRunAnalysis(runId: string): Promise<AnalysisResponse>;
  getRunArtifacts(runId: string): Promise<RunArtifactsResponse>;
  getRunLog(runId: string, logType: LogResponse['logType']): Promise<LogResponse>;
}

type ReportApiClientFactory = (configManager: ConfigManager) => ReportApiClient;

interface DiskRunMetadata {
  id?: string;
  status?: string;
  createdAt?: string;
  completedAt?: string;
  repoUrl?: string;
  gitRef?: string;
  model?: string;
  stages?: Record<string, { duration?: number; exitCode?: number }>;
  exitCode?: number;
}

export class ReportCommand extends BaseCommand {
  private readonly apiClientFactory: ReportApiClientFactory;

  constructor(
    configManager: ConfigManager,
    apiClientFactory: ReportApiClientFactory = (manager) => LocalKasekiApiClient.fromConfig(manager)
  ) {
    super(configManager);
    this.apiClientFactory = apiClientFactory;
  }

  async execute(args: string[]): Promise<number> {
    try {
      const { positional, flags } = this.parseArgs(args);
      const instanceId = positional[0];

      if (!instanceId) {
        console.error('Usage: kaseki-agent report <INSTANCE_ID> [--from-disk]');
        return 1;
      }

      await this.configManager.load();

      if (flags.has('from-disk')) {
        return this.executeFromDisk(instanceId);
      }

      return this.executeFromApi(instanceId);
    } catch (error) {
      logger.error(`Report failed: ${error}`);
      console.error(`❌ Report failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  private async executeFromApi(instanceId: string): Promise<number> {
    console.log(`📊 Report: ${instanceId}\n`);

    const apiClient = this.apiClientFactory(this.configManager);
    const status = await apiClient.getRunStatus(instanceId);
    const [analysis, artifacts, stderrLog] = await Promise.all([
      optionalApiCall(() => apiClient.getRunAnalysis(instanceId)),
      optionalApiCall(() => apiClient.getRunArtifacts(instanceId)),
      optionalApiCall(() => apiClient.getRunLog(instanceId, 'stderr')),
    ]);

    this.printStatus(status, analysis);
    this.printAnalysis(analysis);
    this.printArtifactSummary(status, artifacts);
    this.printSummary(status, stderrLog);

    return status.exitCode === 0 ? 0 : 1;
  }

  private printStatus(status: StatusResponse, analysis?: AnalysisResponse): void {
    console.log('Instance Information');
    console.log('-------------------');
    console.log(`ID:        ${status.id}`);
    console.log(`Status:    ${status.status}`);

    const createdAt = analysis?.createdAt;
    if (createdAt) {
      console.log(`Created:   ${new Date(createdAt).toLocaleString()}`);
    }

    if (analysis?.completedAt) {
      console.log(`Completed: ${new Date(analysis.completedAt).toLocaleString()}`);
    }

    if (analysis?.elapsedSeconds !== undefined) {
      console.log(`Elapsed:   ${analysis.elapsedSeconds}s`);
    } else if (status.elapsedSeconds !== undefined) {
      console.log(`Elapsed:   ${status.elapsedSeconds}s`);
    }

    if (status.progress) {
      const percent = status.progress.percentComplete !== undefined ? ` (${status.progress.percentComplete}%)` : '';
      const message = status.progress.message ? ` - ${status.progress.message}` : '';
      console.log(`Progress:  ${status.progress.stage}${percent}${message}`);
    }

    const metadata = analysis?.metadata;
    if (metadata?.repo) {
      console.log(`Repo:      ${metadata.repo}`);
    }
    if (metadata?.ref) {
      console.log(`Ref:       ${metadata.ref}`);
    }
    if (metadata?.model) {
      console.log(`Model:     ${metadata.model}`);
    }
    if (status.failureClass) {
      console.log(`Failure:   ${status.failureClass}`);
    }
    if (status.error) {
      console.log(`Error:     ${status.error}`);
    }
  }

  private printAnalysis(analysis?: AnalysisResponse): void {
    if (!analysis) {
      return;
    }

    if (analysis.changes) {
      console.log('\nChanges');
      console.log('-------');
      console.log(`Diff Size: ${analysis.changes.diffSize} bytes`);
      if (analysis.changes.changedFiles.length > 0) {
        console.log('Changed Files:');
        for (const file of analysis.changes.changedFiles) {
          console.log(`  - ${file}`);
        }
      }
    }

    if (analysis.validation) {
      console.log('\nValidation');
      console.log('----------');
      console.log(`Status: ${analysis.validation.passed ? 'passed' : 'failed'}`);
      for (const result of analysis.validation.commandResults) {
        console.log(`  ${result.command}: exit ${result.exitCode} (${result.elapsed}s)`);
      }
    }

    if (analysis.errors && analysis.errors.length > 0) {
      console.log('\nErrors');
      console.log('------');
      for (const error of analysis.errors) {
        console.log(`  - ${error}`);
      }
    }
  }

  private printArtifactSummary(status: StatusResponse, artifacts?: RunArtifactsResponse): void {
    const availableFiles = status.artifacts?.availableFiles ?? [];
    const recommended = artifacts?.recommended ?? [];

    if (availableFiles.length === 0 && recommended.length === 0) {
      return;
    }

    console.log('\nArtifacts');
    console.log('---------');
    if (recommended.length > 0) {
      console.log(`Recommended: ${recommended.join(', ')}`);
    }
    if (availableFiles.length > 0) {
      console.log(`Available:   ${availableFiles.join(', ')}`);
    } else if (artifacts) {
      const names = artifacts.artifacts.filter((artifact) => artifact.available).map((artifact) => artifact.name);
      if (names.length > 0) {
        console.log(`Available:   ${names.join(', ')}`);
      }
    }
  }

  private printSummary(status: StatusResponse, stderrLog?: LogResponse): void {
    if (status.resultSummaryContent) {
      console.log('\nDetailed Summary');
      console.log('----------------');
      console.log(status.resultSummaryContent);
    }

    if (status.validationFailureReason) {
      console.log(`\nValidation Failure: ${status.validationFailureReason}`);
    }
    if (status.qualityFailureReason) {
      console.log(`\nQuality Failure: ${status.qualityFailureReason}`);
    }
    if (stderrLog?.content) {
      console.log('\nStderr Tail');
      console.log('-----------');
      console.log(stderrLog.content);
    }

    if (status.status === 'completed' && status.exitCode === 0) {
      console.log('\n✅ Instance completed successfully');
    } else if (status.status === 'completed' || status.status === 'failed') {
      const exitCode = status.exitCode !== undefined ? ` with exit code ${status.exitCode}` : '';
      console.log(`\n❌ Instance failed${exitCode}`);
    } else {
      console.log(`\n⏳ Instance status: ${status.status}`);
    }
  }

  private async executeFromDisk(instanceId: string): Promise<number> {
    console.log(`📊 Report: ${instanceId} (from disk)\n`);

    const fs = await import('fs/promises');
    const path = await import('path');
    const kasekiRoot = this.configManager.get('directories.root');
    const resultsDir = path.join(kasekiRoot, 'kaseki-results', instanceId);

    try {
      const metadataPath = path.join(resultsDir, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(content) as DiskRunMetadata;

      console.log('Instance Information');
      console.log('-------------------');
      console.log(`ID:        ${metadata.id ?? instanceId}`);
      console.log(`Status:    ${metadata.status ?? 'unknown'}`);

      if (metadata.createdAt) {
        console.log(`Created:   ${new Date(metadata.createdAt).toLocaleString()}`);
      }
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

      if (metadata.stages && Object.keys(metadata.stages).length > 0) {
        console.log('\nStages');
        console.log('------');
        for (const [stage, info] of Object.entries(metadata.stages)) {
          console.log(`${stage}:`);
          if (info.duration) {
            console.log(`  Duration: ${info.duration.toFixed(1)}s`);
          }
          if (info.exitCode !== undefined) {
            console.log(`  Exit Code: ${info.exitCode}`);
          }
        }
      }

      if (metadata.status === 'completed' && metadata.exitCode === 0) {
        console.log('\n✅ Instance completed successfully');
      } else if (metadata.status === 'completed') {
        console.log(`\n❌ Instance failed with exit code ${metadata.exitCode}`);
      } else {
        console.log(`\n⏳ Instance status: ${metadata.status ?? 'unknown'}`);
      }

      await this.printDiskSummary(fs, path.join(resultsDir, 'result-summary.md'));
      return metadata.exitCode === 0 ? 0 : 1;
    } catch (error) {
      console.error(`Instance not found on disk: ${instanceId}`);
      logger.debug(`Failed to read instance from disk: ${error}`);
      return 1;
    }
  }

  private async printDiskSummary(fs: typeof import('fs/promises'), summaryPath: string): Promise<void> {
    try {
      const summary = await fs.readFile(summaryPath, 'utf-8');
      console.log('\nDetailed Summary');
      console.log('----------------');
      console.log(summary);
    } catch {
      // Summary file not found, that's okay.
    }
  }
}

async function optionalApiCall<T>(call: () => Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch (error) {
    logger.debug(`Optional report enrichment unavailable: ${error}`);
    return undefined;
  }
}
