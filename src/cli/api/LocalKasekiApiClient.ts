import { z } from 'zod';
import type { ConfigManager } from '../../config/ConfigManager';
import type { RunRequest, RunResponse } from '../../kaseki-api-types';

const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:8080/api';

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
    const baseUrl = process.env.KASEKI_API_BASE_URL || configuredBaseUrl || DEFAULT_LOCAL_API_BASE_URL;
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
