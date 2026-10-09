import { readHostSecret } from '../../secrets/host-secrets-reader';

export interface SoyuzAdapterConfig {
  enabled: boolean;
  apiUrl: string;
  workerApiToken: string;
  accountId: string;
  queueId: string;
  queueApiToken: string;
  workerId: string;
  pollIntervalMs: number;
  batchSize: number;
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
  const enabledValue = env.SOYUZ_ENABLED?.trim().toLowerCase() ?? 'false';
  if (enabledValue !== 'true' && enabledValue !== 'false') {
    throw new Error('SOYUZ_ENABLED must be true or false');
  }
  const enabled = enabledValue === 'true';
  if (!enabled) {
    return {
      enabled: false,
      apiUrl: '',
      workerApiToken: '',
      accountId: '',
      queueId: '',
      queueApiToken: '',
      workerId: '',
      pollIntervalMs: positiveInt(env, 'SOYUZ_POLL_INTERVAL_MS', 5_000, 250, 60_000),
      batchSize: positiveInt(env, 'SOYUZ_BATCH_SIZE', 1, 1, 100),
      visibilityTimeoutMs: positiveInt(env, 'SOYUZ_VISIBILITY_TIMEOUT_MS', 120_000, 1_000, 43_200_000),
      requestTimeoutMs: positiveInt(env, 'SOYUZ_REQUEST_TIMEOUT_MS', 20_000, 1_000, 120_000),
      cancellationPollIntervalMs: positiveInt(env, 'SOYUZ_CANCELLATION_POLL_INTERVAL_MS', 15_000, 1_000, 300_000),
      heartbeatIntervalMs: positiveInt(env, 'SOYUZ_HEARTBEAT_INTERVAL_MS', 60_000, 10_000, 900_000),
    };
  }

  const apiUrlRaw = env.SOYUZ_API_URL?.trim();
  const workerApiToken = readSecret(env, 'SOYUZ_WORKER_API_TOKEN', 'soyuz_worker_api_token');
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const queueId = env.CLOUDFLARE_QUEUE_ID?.trim() ?? '';
  const queueApiToken = readSecret(env, 'CLOUDFLARE_QUEUE_API_TOKEN', 'cloudflare_queue_api_token');
  const workerId = env.SOYUZ_WORKER_ID?.trim() ?? '';

  if (!apiUrlRaw) throw new Error('SOYUZ_API_URL is required when SOYUZ_ENABLED=true');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiUrlRaw);
  } catch {
    throw new Error('SOYUZ_API_URL must be a valid URL');
  }
  if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname))) {
    throw new Error('SOYUZ_API_URL must use HTTPS except for localhost development');
  }
  if (parsedUrl.search || parsedUrl.hash) throw new Error('SOYUZ_API_URL must not include a query string or fragment');
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID');
  if (!queueId || queueId.length > 200) throw new Error('CLOUDFLARE_QUEUE_ID is required');
  if (workerApiToken.length < 16) throw new Error('SOYUZ_WORKER_API_TOKEN is required and must contain at least 16 characters');
  if (queueApiToken.length < 16) throw new Error('CLOUDFLARE_QUEUE_API_TOKEN is required and must contain at least 16 characters');
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(workerId)) throw new Error('SOYUZ_WORKER_ID is required and must be a stable, unique host identifier');

  return {
    enabled,
    apiUrl: apiUrlRaw.replace(/\/+$/, ''),
    workerApiToken,
    accountId,
    queueId,
    queueApiToken,
    workerId,
    pollIntervalMs: positiveInt(env, 'SOYUZ_POLL_INTERVAL_MS', 5_000, 250, 60_000),
    batchSize: positiveInt(env, 'SOYUZ_BATCH_SIZE', 1, 1, 100),
    visibilityTimeoutMs: positiveInt(env, 'SOYUZ_VISIBILITY_TIMEOUT_MS', 120_000, 1_000, 43_200_000),
    requestTimeoutMs: positiveInt(env, 'SOYUZ_REQUEST_TIMEOUT_MS', 20_000, 1_000, 120_000),
    cancellationPollIntervalMs: positiveInt(env, 'SOYUZ_CANCELLATION_POLL_INTERVAL_MS', 15_000, 1_000, 300_000),
    heartbeatIntervalMs: positiveInt(env, 'SOYUZ_HEARTBEAT_INTERVAL_MS', 60_000, 10_000, 900_000),
  };
}
