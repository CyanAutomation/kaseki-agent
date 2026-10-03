export type ApiScope =
  | 'runs:read'
  | 'runs:write'
  | 'artifacts:read'
  | 'diagnostics:read'
  | 'diagnostics:run'
  | 'metrics:read'
  | 'github:read'
  | 'webhooks:write'
  | 'usage:read';

const DEFAULT_SCOPES: readonly ApiScope[] = [
  'runs:read', 'artifacts:read', 'diagnostics:read', 'metrics:read', 'usage:read',
];

export interface ApiUsageSnapshot {
  startedAt: string;
  requestCount: number;
  diagnosticProbeCount: number;
  webhookTestCount: number;
  githubIssueLookupCount: number;
  /** Token-level spend is not available from the current gateway probe interface. */
  costUsd: null;
}

export interface ApiAccessControllerOptions {
  apiKeys: readonly string[];
  apiKeyScopes?: Record<string, readonly ApiScope[]>;
  requestsPerMinute?: number;
  diagnosticsPerHour?: number;
  webhookTestsPerHour?: number;
  githubIssuesPerMinute?: number;
  now?: () => number;
}

interface RateWindow {
  start: number;
  count: number;
}

interface MutableUsage extends ApiUsageSnapshot {
}

/** In-process API key scope, burst limit, and usage accounting. */
export class ApiAccessController {
  private readonly scopes: Record<string, readonly ApiScope[]>;
  private readonly rates = new Map<string, RateWindow>();
  private readonly usage = new Map<string, MutableUsage>();
  private readonly now: () => number;

  constructor(private readonly options: ApiAccessControllerOptions) {
    this.scopes = options.apiKeyScopes ?? {};
    this.now = options.now ?? Date.now;
  }

  requiredScope(method: string, path: string, query: Record<string, unknown> = {}): ApiScope {
    const normalizedPath = path.toLowerCase();
    if (normalizedPath === '/usage') return 'usage:read';
    if (normalizedPath === '/metrics') return 'metrics:read';
    if (normalizedPath.startsWith('/results/')) return 'artifacts:read';
    if (normalizedPath.startsWith('/webhooks/')) return 'webhooks:write';
    if (/^\/runs\/[^/]+\/webhook-deliveries/.test(normalizedPath)) {
      return method.toUpperCase() === 'POST' ? 'webhooks:write' : 'runs:read';
    }
    if (normalizedPath === '/github-issues') return 'github:read';
    if (normalizedPath === '/gateway-test') return hasCostlyDiagnosticQuery(query) ? 'diagnostics:run' : 'diagnostics:read';
    if (normalizedPath === '/preflight' && isQueryTrue(query.agentCapability)) return 'diagnostics:run';
    if (['/preflight', '/startup-health', '/capabilities'].includes(normalizedPath)) return 'diagnostics:read';
    if (method.toUpperCase() === 'POST' && (normalizedPath === '/validate' || normalizedPath === '/runs' || /^\/runs\/[^/]+\/(retry|cancel)$/.test(normalizedPath))) {
      return 'runs:write';
    }
    if (normalizedPath.startsWith('/runs/')) return 'runs:read';
    return 'runs:read';
  }

  hasScope(apiKey: string, scope: ApiScope): boolean {
    if (this.options.apiKeys.length === 0) return true;
    if (!this.options.apiKeys.includes(apiKey)) return false;
    const configured = this.scopes[apiKey];
    return configured === undefined ? DEFAULT_SCOPES.includes(scope) : configured.includes(scope);
  }

  /** Return Retry-After seconds when a request exceeds a configured fixed-window limit. */
  checkAndRecord(
    apiKey: string,
    method: string,
    path: string,
    query: Record<string, unknown>,
  ): number | undefined {
    const now = this.now();
    const normalizedPath = path.toLowerCase();
    const usage = this.getMutableUsage(apiKey, now);
    usage.requestCount += 1;

    const isDiagnosticProbe = (normalizedPath === '/gateway-test' && hasCostlyDiagnosticQuery(query)) ||
      (normalizedPath === '/preflight' && isQueryTrue(query.agentCapability));
    const isWebhookTest = (normalizedPath === '/webhooks/test' || /^\/runs\/[^/]+\/webhook-deliveries\/[^/]+\/retry$/.test(normalizedPath)) && method.toUpperCase() === 'POST';
    const isGithubLookup = normalizedPath === '/github-issues' && method.toUpperCase() === 'POST';
    if (isDiagnosticProbe) usage.diagnosticProbeCount += 1;
    if (isWebhookTest) usage.webhookTestCount += 1;
    if (isGithubLookup) usage.githubIssueLookupCount += 1;

    const exceeded: number[] = [];
    this.consumeRate(apiKey, 'requests', 60_000, this.options.requestsPerMinute ?? 300, now, exceeded);
    if (isDiagnosticProbe) this.consumeRate(apiKey, 'diagnostics', 3_600_000, this.options.diagnosticsPerHour ?? 10, now, exceeded);
    if (isWebhookTest) this.consumeRate(apiKey, 'webhooks', 3_600_000, this.options.webhookTestsPerHour ?? 10, now, exceeded);
    if (isGithubLookup) this.consumeRate(apiKey, 'github', 60_000, this.options.githubIssuesPerMinute ?? 30, now, exceeded);
    return exceeded.length > 0 ? Math.max(...exceeded) : undefined;
  }

  getUsage(apiKey: string): ApiUsageSnapshot {
    const current = this.getMutableUsage(apiKey, this.now());
    return {
      startedAt: current.startedAt,
      requestCount: current.requestCount,
      diagnosticProbeCount: current.diagnosticProbeCount,
      webhookTestCount: current.webhookTestCount,
      githubIssueLookupCount: current.githubIssueLookupCount,
      costUsd: null,
    };
  }

  private consumeRate(
    apiKey: string,
    category: string,
    windowMs: number,
    maximum: number,
    now: number,
    exceeded: number[],
  ): void {
    const start = Math.floor(now / windowMs) * windowMs;
    const key = `${apiKey}\0${category}`;
    const current = this.rates.get(key);
    const window = current?.start === start ? current : { start, count: 0 };
    window.count += 1;
    this.rates.set(key, window);
    if (window.count > maximum) exceeded.push(Math.max(1, Math.ceil((start + windowMs - now) / 1000)));
  }

  private getMutableUsage(apiKey: string, now: number): MutableUsage {
    let current = this.usage.get(apiKey);
    if (!current) {
      current = {
        startedAt: new Date(now).toISOString(),
        requestCount: 0,
        diagnosticProbeCount: 0,
        webhookTestCount: 0,
        githubIssueLookupCount: 0,
        costUsd: null,
      };
      this.usage.set(apiKey, current);
    }
    return current;
  }
}

function hasCostlyDiagnosticQuery(query: Record<string, unknown>): boolean {
  return isQueryTrue(query.inference) || query.stage === '2' || isQueryTrue(query.responseSmoke) ||
    isQueryTrue(query.piProvider) || isQueryTrue(query.evaluation) || isQueryTrue(query.classification);
}

function isQueryTrue(value: unknown): boolean {
  return typeof value === 'string' && ['true', '1', 'on', 'yes'].includes(value.trim().toLowerCase());
}
