import { ReportCommand, type ReportApiClient } from './ReportCommand';
import { ConfigManager } from '../../config/ConfigManager';
import type { AnalysisResponse, LogResponse, RunArtifactsResponse, StatusResponse } from '../../kaseki-api-types';

describe('ReportCommand', () => {
  let configManager: ConfigManager;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    configManager = new ConfigManager();
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    jest.restoreAllMocks();
  });

  test('renders report output from local API status and enrichment endpoints', async () => {
    const status: StatusResponse = {
      id: 'kaseki-123',
      status: 'completed',
      elapsedSeconds: 12,
      exitCode: 0,
      resultSummaryContent: 'All checks passed.',
      artifacts: {
        metadataJson: true,
        analysisMd: true,
        resultSummaryMd: true,
        failureJson: false,
        stderrLog: false,
        availableFiles: ['metadata.json', 'result-summary.md'],
      },
    };
    const analysis: AnalysisResponse = {
      id: 'kaseki-123',
      status: 'completed',
      createdAt: '2026-05-14T00:00:00.000Z',
      completedAt: '2026-05-14T00:00:12.000Z',
      elapsedSeconds: 12,
      exitCode: 0,
      metadata: {
        model: 'gpt-5.5',
        repo: 'https://github.com/org/repo',
        ref: 'main',
      },
      changes: {
        changedFiles: ['src/index.ts'],
        diffSize: 42,
      },
      validation: {
        passed: true,
        commandResults: [{ command: 'npm test', exitCode: 0, elapsed: 3 }],
      },
    };
    const artifacts: RunArtifactsResponse = {
      id: 'kaseki-123',
      runStatus: 'completed',
      exitCode: 0,
      artifacts: [],
      recommended: ['result-summary.md'],
      artifactCount: 2,
    };
    const stderrLog: LogResponse = { logType: 'stderr', content: '', size: 0 };
    const apiClient: ReportApiClient = {
      baseUrl: 'http://localhost:8080/api',
      getRunStatus: jest.fn<Promise<StatusResponse>, [string]>().mockResolvedValue(status),
      getRunAnalysis: jest.fn<Promise<AnalysisResponse>, [string]>().mockResolvedValue(analysis),
      getRunArtifacts: jest.fn<Promise<RunArtifactsResponse>, [string]>().mockResolvedValue(artifacts),
      getRunLog: jest.fn<Promise<LogResponse>, [string, LogResponse['logType']]>().mockResolvedValue(stderrLog),
    };
    const command = new ReportCommand(configManager, () => apiClient);

    const exitCode = await command.execute(['kaseki-123']);

    expect(exitCode).toBe(0);
    expect(apiClient.getRunStatus).toHaveBeenCalledWith('kaseki-123');
    expect(apiClient.getRunAnalysis).toHaveBeenCalledWith('kaseki-123');
    expect(apiClient.getRunArtifacts).toHaveBeenCalledWith('kaseki-123');
    expect(apiClient.getRunLog).toHaveBeenCalledWith('kaseki-123', 'stderr');
    const output = consoleLog.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('https://github.com/org/repo');
    expect(output).toContain('src/index.ts');
    expect(output).toContain('All checks passed.');
    expect(output).toContain('Instance completed successfully');
  });
});
