import { readHostSecret } from '../../secrets/host-secrets-reader';

export interface SoyuzAdapterConfig {
  enabled: boolean;
  /** Enables API submissions through Soyuz independently from queue consumption. */
  submissionEnabled?: boolean;
  /** Scoped Kaseki credential used only for create, retry, and cancel requests. */
  submissionApiToken?: string;
  apiUrl: string;
  workerApiToken: string;
  accountId: string;
  queueId: string;
  queueApiToken: string;
  workerId: string;
  pollIntervalMs: number;
  visibilityTimeoutMs: number;
  requestTimeoutMs: number;
  cancellationPollIntervalMs: number;
  heartbeatIntervalMs: number;
}

function readSecret(env: NodeJS.ProcessEnv, envName: string, fileName: string): string {
  return env[envName]?.trim() || readHostSecret(fileName)?.trim() || '';
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}`);
  }
  return value;
}

export function loadSoyuzAdapterConfig(env: NodeJS.ProcessEnv = process.env): SoyuzAdapterConfig {
  const enabled = booleanSetting(env, 'SOYUZ_ENABLED');
  const submissionEnabled = booleanSetting(env, 'SOYUZ_SUBMISSION_ENABLED');
  const submissionApiToken = submissionEnabled
    ? readSecret(env, 'SOYUZ_SUBMISSION_API_TOKEN', 'soyuz_submission_api_token')
    : '';
  if (!enabled && !submissionEnabled) return disabledConfig(timingSettings(env));

  const apiUrl = validatedApiUrl(env.SOYUZ_API_URL);
  validateSubmissionToken(submissionApiToken, submissionEnabled);
  const credentials = readCredentials(env, enabled, submissionEnabled, submissionApiToken);
  validateQueueCredentials(credentials, enabled);
  validateSubmissionWorkerCredentials(credentials, submissionEnabled);

  return {
    enabled,
    submissionEnabled,
    ...credentials,
    apiUrl,
    ...timingSettings(env),
  };
}

function booleanSetting(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name]?.trim().toLowerCase() ?? 'false';
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
  return value === 'true';
}

type SoyuzTimingSettings = Pick<
  SoyuzAdapterConfig,
  'pollIntervalMs' | 'visibilityTimeoutMs' | 'requestTimeoutMs' | 'cancellationPollIntervalMs' | 'heartbeatIntervalMs'
>;

function timingSettings(env: NodeJS.ProcessEnv): SoyuzTimingSettings {
  return {
    pollIntervalMs: positiveInt(env, 'SOYUZ_POLL_INTERVAL_MS', 5_000, 250, 60_000),
    visibilityTimeoutMs: positiveInt(env, 'SOYUZ_VISIBILITY_TIMEOUT_MS', 120_000, 1_000, 43_200_000),
    requestTimeoutMs: positiveInt(env, 'SOYUZ_REQUEST_TIMEOUT_MS', 20_000, 1_000, 120_000),
    cancellationPollIntervalMs: positiveInt(env, 'SOYUZ_CANCELLATION_POLL_INTERVAL_MS', 60_000, 1_000, 300_000),
    heartbeatIntervalMs: positiveInt(env, 'SOYUZ_HEARTBEAT_INTERVAL_MS', 60_000, 10_000, 900_000),
  };
}

function disabledConfig(timings: SoyuzTimingSettings): SoyuzAdapterConfig {
  return {
    enabled: false,
    submissionEnabled: false,
    submissionApiToken: '',
    apiUrl: '',
    workerApiToken: '',
    accountId: '',
    queueId: '',
    queueApiToken: '',
    workerId: '',
    ...timings,
  };
}

function validatedApiUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) throw new Error('SOYUZ_API_URL is required when Soyuz submissions or queue consumption are enabled');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SOYUZ_API_URL must be a valid URL');
  }
  const isLocalHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('SOYUZ_API_URL must use HTTPS except for localhost development');
  }
  if (parsed.search || parsed.hash) throw new Error('SOYUZ_API_URL must not include a query string or fragment');
  return value.replace(/\/+$/, '');
}

interface SoyuzCredentials {
  submissionApiToken: string;
  workerApiToken: string;
  accountId: string;
  queueId: string;
  queueApiToken: string;
  workerId: string;
}

function readCredentials(
  env: NodeJS.ProcessEnv,
  enabled: boolean,
  submissionEnabled: boolean,
  submissionApiToken: string,
): SoyuzCredentials {
  return {
    submissionApiToken,
    workerApiToken: enabled || submissionEnabled
      ? readSecret(env, 'SOYUZ_WORKER_API_TOKEN', 'soyuz_worker_api_token')
      : '',
    accountId: env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '',
    queueId: env.CLOUDFLARE_QUEUE_ID?.trim() ?? '',
    queueApiToken: enabled
      ? readSecret(env, 'CLOUDFLARE_QUEUE_API_TOKEN', 'cloudflare_queue_api_token')
      : '',
    workerId: env.SOYUZ_WORKER_ID?.trim() ?? '',
  };
}

function validateSubmissionToken(submissionApiToken: string, submissionEnabled: boolean): void {
  if (!submissionEnabled) return;
  if (submissionApiToken.length < 16) {
    throw new Error('SOYUZ_SUBMISSION_API_TOKEN is required and must contain at least 16 characters when SOYUZ_SUBMISSION_ENABLED=true');
  }
}

function validateSubmissionWorkerCredentials(credentials: SoyuzCredentials, submissionEnabled: boolean): void {
  if (!submissionEnabled) return;
  if (credentials.workerApiToken.length < 16) {
    throw new Error('SOYUZ_WORKER_API_TOKEN is required for canonical run status reads when SOYUZ_SUBMISSION_ENABLED=true');
  }
  if (credentials.submissionApiToken === credentials.workerApiToken) {
    throw new Error('SOYUZ_SUBMISSION_API_TOKEN must be distinct from SOYUZ_WORKER_API_TOKEN');
  }
}

function validateQueueCredentials(credentials: SoyuzCredentials, enabled: boolean): void {
  if (!enabled) return;
  if (!/^[a-f0-9]{32}$/i.test(credentials.accountId)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID');
  }
  if (!credentials.queueId || credentials.queueId.length > 200) throw new Error('CLOUDFLARE_QUEUE_ID is required');
  if (credentials.workerApiToken.length < 16) {
    throw new Error('SOYUZ_WORKER_API_TOKEN is required and must contain at least 16 characters');
  }
  if (credentials.queueApiToken.length < 16) {
    throw new Error('CLOUDFLARE_QUEUE_API_TOKEN is required and must contain at least 16 characters');
  }
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(credentials.workerId)) {
    throw new Error('SOYUZ_WORKER_ID is required and must be a stable, unique host identifier');
  }
}
