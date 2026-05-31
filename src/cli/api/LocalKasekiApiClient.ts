import { z } from 'zod';
import type { ConfigManager } from '../../config/ConfigManager';
import { ArtifactAvailability, type AnalysisResponse, type LogResponse, type RunArtifactsResponse, type RunRequest, type RunResponse, type RunsListResponse, type StatusResponse } from '../../kaseki-api-types';

const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:8080/api';

const StatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.object({
    stage: z.string(),
    percentComplete: z.number().optional(),
    message: z.string().optional(),
    updatedAt: z.string().optional(),
  }).optional(),
  elapsedSeconds: z.number().optional(),
  timeoutRiskPercent: z.number().optional(),
  taskProgressPercent: z.number().optional(),
  exitCode: z.number().optional(),
  failureClass: z.string().optional(),
  validationFailureReason: z.string().optional(),
  qualityFailureReason: z.string().optional(),
  error: z.string().optional(),
  resultDir: z.string().optional(),
  correlationId: z.string().optional(),
  requestId: z.string().optional(),
  resultSummaryContent: z.string().optional(),
  failureJsonContent: z.record(z.any()).optional(),
  artifacts: z.object({
    metadataJson: z.boolean(),
    analysisMd: z.boolean(),
    resultSummaryMd: z.boolean(),
    failureJson: z.boolean(),
    stderrLog: z.boolean(),
    availableFiles: z.array(z.string()),
  }).optional(),
  diagnosticEntryPoint: z.enum(['failure.json', 'analysis.md', 'result-summary.md']).optional(),
});

const RunsListResponseSchema = z.object({
  runs: z.array(z.object({
    id: z.string(),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    createdAt: z.string(),
    completedAt: z.string().optional(),
    resultDir: z.string().optional(),
    exitCode: z.number().optional(),
    failureClass: z.string().optional(),
    error: z.string().optional(),
  })),
  total: z.number(),
  retention: z.object({
    terminalJobIndexMaxEntries: z.number(),
    note: z.string(),
  }).optional(),
});

const AnalysisResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  elapsedSeconds: z.number().optional(),
  exitCode: z.number().optional(),
  failureClass: z.string().optional(),
  metadata: z.object({
    model: z.string().optional(),
    instance: z.string().optional(),
    repo: z.string().optional(),
    ref: z.string().optional(),
  }).optional(),
  changes: z.object({
    changedFiles: z.array(z.string()),
    diffSize: z.number(),
  }).optional(),
  validation: z.object({
    passed: z.boolean(),
    commandResults: z.array(z.object({
      command: z.string(),
      exitCode: z.number(),
      elapsed: z.number(),
    })),
  }).optional(),
  errors: z.array(z.string()).optional(),
});

const RunArtifactsResponseSchema = z.object({
  id: z.string(),
  runStatus: z.enum(['queued', 'running', 'completed', 'failed']),
  exitCode: z.number().optional(),
  artifacts: z.array(z.object({
    name: z.string(),
    size: z.number(),
    contentType: z.string(),
    available: z.boolean(),
    description: z.string().optional(),
    availability: z.nativeEnum(ArtifactAvailability).optional(),
    triageOrder: z.number().optional(),
  })),
  recommended: z.array(z.string()),
  artifactCount: z.number(),
  downloadBaseUrl: z.string().optional(),
});

const LogResponseSchema = z.object({
  logType: z.enum(['stdout', 'stderr', 'validation', 'progress', 'quality', 'secret-scan']),
  content: z.string(),
  size: z.number(),
});

const RunResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  createdAt: z.string(),
  correlationId: z.string().optional(),
  requestId: z.string().optional(),
  cached: z.boolean().optional(),
  completedAt: z.string().optional(),
  exitCode: z.number().optional(),
  failureClass: z.string().optional(),
  error: z.string().optional(),
});

export interface LocalKasekiApiClientOptions {
  baseUrl?: string;
  apiKey?: string;
}

export class LocalKasekiApiClient {
  readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: LocalKasekiApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_LOCAL_API_BASE_URL).replace(/\/$/, '');
    this.apiKey = options.apiKey || undefined;
  }

  static fromConfig(configManager: ConfigManager): LocalKasekiApiClient {
    const configuredBaseUrl = configManager.get<string>('api.base_url', DEFAULT_LOCAL_API_BASE_URL);
    const baseUrl = process.env.KASEKI_API_URL || process.env.KASEKI_API_BASE_URL || configuredBaseUrl || DEFAULT_LOCAL_API_BASE_URL;
    const configuredApiKey = configManager.get<string>('api.key', '');
    const configuredApiKeys = configManager.get<string[]>('api.keys', []);
    const apiKey = process.env.KASEKI_API_KEY || configuredApiKey || configuredApiKeys[0] || undefined;

    return new LocalKasekiApiClient({ baseUrl, apiKey });
  }

  getRunStatusUrl(runId: string): string {
    return `${this.baseUrl}/runs/${encodeURIComponent(runId)}/status`;
  }

  async createRun(request: RunRequest): Promise<RunResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      const fallbackDetail = response.statusText || String(response.status);
      throw new Error(`Failed to submit run to local Kaseki API: ${detail ?? fallbackDetail}`);
    }

    const data = await response.json();
    return RunResponseSchema.parse(data);
  }

  async listRuns(): Promise<RunsListResponse> {
    const data = await this.requestJson('/runs', 'Failed to list runs from local Kaseki API');
    return RunsListResponseSchema.parse(data);
  }

  async getRunStatus(runId: string): Promise<StatusResponse> {
    const data = await this.requestJson(`/runs/${encodeURIComponent(runId)}/status`, 'Failed to fetch run status from local Kaseki API');
    return StatusResponseSchema.parse(data);
  }

  async getRunAnalysis(runId: string): Promise<AnalysisResponse> {
    const data = await this.requestJson(`/runs/${encodeURIComponent(runId)}/analysis`, 'Failed to fetch run analysis from local Kaseki API');
    return AnalysisResponseSchema.parse(data);
  }

  async getRunArtifacts(runId: string): Promise<RunArtifactsResponse> {
    const data = await this.requestJson(`/runs/${encodeURIComponent(runId)}/artifacts`, 'Failed to fetch run artifacts from local Kaseki API');
    return RunArtifactsResponseSchema.parse(data);
  }

  async getRunLog(runId: string, logType: LogResponse['logType']): Promise<LogResponse> {
    const data = await this.requestJson(`/runs/${encodeURIComponent(runId)}/logs/${encodeURIComponent(logType)}`, 'Failed to fetch run log from local Kaseki API');
    return LogResponseSchema.parse(data);
  }

  async cancelRun(runId: string): Promise<StatusResponse> {
    const data = await this.requestJson(`/runs/${encodeURIComponent(runId)}/cancel`, 'Failed to cancel run through local Kaseki API', {
      method: 'POST',
    });
    return StatusResponseSchema.parse(data);
  }

  private async requestJson(path: string, failureMessage: string, init: { method?: string } = {}): Promise<unknown> {
    const headers: Record<string, string> = {};

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      throw new Error(`${failureMessage}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      const fallbackDetail = response.statusText || String(response.status);
      throw new Error(`${failureMessage}: ${detail ?? fallbackDetail}`);
    }

    return response.json();
  }

  private async readErrorDetail(response: Response): Promise<string | undefined> {
    try {
      const data = await response.json();
      const parsed = z.object({ detail: z.string().optional(), error: z.string().optional() }).safeParse(data);
      return parsed.success ? parsed.data.detail || parsed.data.error : undefined;
    } catch {
      return undefined;
    }
  }
}
