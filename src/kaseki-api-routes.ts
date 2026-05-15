import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readHostSecret, getSecretLocations } from './secrets/host-secrets-reader';
import { JobScheduler } from './job-scheduler';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import { execDockerCommand } from './lib/subprocess-helpers';
import {
  RunRequestSchema,
  RunResponse,
  ValidationResponse,
  PreflightCheck,
  PreflightResponse,
  Job,
} from './kaseki-api-types';
import { KasekiApiConfig, validateApiKey } from './kaseki-api-config';
import { createEventLogger } from './logger';
import { sendErrorResponse } from './utils/response-helpers';
import { readFirstLine, commandOutput } from './utils/file-helpers';
import { createStatusRoutes } from './routes/status-routes';
import { createLogRoutes } from './routes/log-routes';
import { createArtifactRoutes } from './routes/artifact-routes';
import { createWebhookRoutes } from './routes/webhook-routes';
import { metricsRegistry } from './metrics';
import { ResultCache } from './result-cache';
import { validateGitHubAppPrivateKey } from './github-app-private-key';

// Re-export UTF-8 helpers for backward compatibility
export { decodeUtf8TailSafely, tailLogByLines } from './utils/utf8-helpers';

const TEMPLATE_REMEDIATION = 'Run scripts/kaseki-activate.sh --controller bootstrap.';
const DEFAULT_TEMPLATE_DOCTOR_TIMEOUT_MS = 15000;
const TEMPLATE_DOCTOR_STDERR_TAIL_LINES = 25;
const REQUIRED_TEMPLATE_FILES = [
  'run-kaseki.sh',
  'kaseki-agent.sh',
  'scripts/kaseki-activate.sh',
  'scripts/kaseki-preflight.sh',
  'lib/pi-event-filter.js',
  'lib/pi-progress-stream.js',
  'lib/kaseki-report.js',
] as const;

function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return false;
  }

  return remoteAddress === '::1' ||
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::ffff:127.0.0.1' ||
    remoteAddress.startsWith('127.');
}

interface TemplateHealthStatus {
  ok: boolean;
  templateDir: string;
  runScript: string;
  checkoutDir: string;
  checkoutRef?: string;
  doctorCommand?: string;
  doctorExitCode?: number | null;
  doctorSignal?: NodeJS.Signals | null;
  doctorStderrTail?: string;
  detail: string;
  remediation?: string;
}

function getTemplateCheckoutRef(checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent'): string | undefined {
  return fs.existsSync(path.join(checkoutDir, '.git'))
    ? commandOutput('git', ['rev-parse', '--short', 'HEAD'], checkoutDir)
    : undefined;
}

function getTemplateDoctorTimeoutMs(): number {
  const configured = Number.parseInt(process.env.KASEKI_TEMPLATE_DOCTOR_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TEMPLATE_DOCTOR_TIMEOUT_MS;
}

function tailTextByLines(content: string, lineCount: number): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return lines.slice(-lineCount).join('\n').trim();
}

function validateTemplateRunScript(
  templateDir: string,
  runScript: string,
  templateRef: string | undefined,
  checkoutDir: string
): TemplateHealthStatus | null {
  if (!fs.existsSync(runScript)) {
    return {
      ok: false,
      templateDir,
      runScript,
      checkoutDir,
      checkoutRef: templateRef,
      detail: `Missing template runner: ${runScript}`,
      remediation: TEMPLATE_REMEDIATION,
    };
  }
  return null;
}

function validateTemplateFiles(
  templateDir: string,
  runScript: string,
  templateRef: string | undefined,
  checkoutDir: string
): TemplateHealthStatus | null {
  const missingFiles = REQUIRED_TEMPLATE_FILES.filter((file) => !fs.existsSync(path.join(templateDir, file)));
  if (missingFiles.length > 0) {
    return {
      ok: false,
      templateDir,
      runScript,
      checkoutDir,
      checkoutRef: templateRef,
      detail: `Template is incomplete at ${templateDir}; missing ${missingFiles.join(', ')}.`,
      remediation: 'Run scripts/kaseki-activate.sh --controller bootstrap, or scripts/kaseki-setup-host.sh --fix before starting the API.',
    };
  }
  return null;
}

function runTemplateDoctor(runScript: string, checkoutDir: string) {
  const activateScript = path.join(checkoutDir, 'scripts', 'kaseki-activate.sh');
  const doctorArgs = fs.existsSync(activateScript)
    ? [activateScript, '--json', 'doctor']
    : [runScript, '--doctor'];

  return spawnSync(doctorArgs[0], doctorArgs.slice(1), {
    cwd: fs.existsSync(checkoutDir) ? checkoutDir : undefined,
    encoding: 'utf-8',
    timeout: getTemplateDoctorTimeoutMs(),
    maxBuffer: 128 * 1024,
  });
}

function validateTemplateDoctor(
  doctorResult: ReturnType<typeof spawnSync>,
  templateDir: string,
  runScript: string,
  templateRef: string | undefined,
  checkoutDir: string
): TemplateHealthStatus | null {
  const stderr = `${doctorResult.stderr || ''}${doctorResult.error ? `\n${doctorResult.error.message}` : ''}`;
  const doctorStderrTail = tailTextByLines(stderr, TEMPLATE_DOCTOR_STDERR_TAIL_LINES);
  const doctorArgs = fs.existsSync(path.join(checkoutDir, 'scripts', 'kaseki-activate.sh'))
    ? `${path.join(checkoutDir, 'scripts', 'kaseki-activate.sh')} --json doctor`
    : `${runScript} --doctor`;

  if (doctorResult.error || doctorResult.status !== 0) {
    const timedOut = doctorResult.error?.message.toLowerCase().includes('timeout') || doctorResult.signal === 'SIGTERM';
    return {
      ok: false,
      templateDir,
      runScript,
      checkoutDir,
      checkoutRef: templateRef,
      doctorCommand: doctorArgs,
      doctorExitCode: doctorResult.status,
      doctorSignal: doctorResult.signal,
      doctorStderrTail,
      detail: timedOut
        ? `Template doctor timed out after ${getTemplateDoctorTimeoutMs()}ms: ${doctorArgs}`
        : `Template doctor failed: ${doctorArgs} exited with ${doctorResult.status ?? 'unknown'}`,
      remediation: TEMPLATE_REMEDIATION,
    };
  }
  return null;
}

function buildTemplateHealthStatus(templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template'): TemplateHealthStatus {
  const checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent';
  const checkoutRef = getTemplateCheckoutRef(checkoutDir);
  const runScript = path.join(templateDir, 'run-kaseki.sh');

  // Check 1: Validate run script exists
  let validation = validateTemplateRunScript(templateDir, runScript, checkoutRef, checkoutDir);
  if (validation) return validation;

  // Check 2: Validate all required files exist
  validation = validateTemplateFiles(templateDir, runScript, checkoutRef, checkoutDir);
  if (validation) return validation;

  // Check 3: Run doctor check
  const doctorResult = runTemplateDoctor(runScript, checkoutDir);
  validation = validateTemplateDoctor(doctorResult, templateDir, runScript, checkoutRef, checkoutDir);
  if (validation) return validation;

  // All checks passed
  const doctorArgs = fs.existsSync(path.join(checkoutDir, 'scripts', 'kaseki-activate.sh'))
    ? `${path.join(checkoutDir, 'scripts', 'kaseki-activate.sh')} --json doctor`
    : `${runScript} --doctor`;

  return {
    ok: true,
    templateDir,
    runScript,
    checkoutDir,
    checkoutRef,
    doctorCommand: doctorArgs,
    doctorExitCode: doctorResult.status,
    doctorSignal: doctorResult.signal,
    doctorStderrTail: '',
    detail: `Template runner passed doctor check: ${runScript}`,
  };
}

interface TemplateVersionMetadata {
  gitRef?: string;
  supportedPublishModes?: string[];
  imageDigest?: string;
}

interface TemplatePublishModeCompatibility {
  ok: boolean;
  metadataPath: string;
  supportedPublishModes?: string[];
  detail?: string;
  remediation?: string;
}

function readTemplateVersionMetadata(templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template'): TemplateVersionMetadata | undefined {
  const metadataPath = path.join(templateDir, '.kaseki-template-version');
  if (!fs.existsSync(metadataPath)) {
    return undefined;
  }

  const raw = fs.readFileSync(metadataPath, 'utf-8');
  const parsed = JSON.parse(raw) as TemplateVersionMetadata;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Template metadata is invalid: ${metadataPath}`);
  }
  if (parsed.supportedPublishModes !== undefined && !Array.isArray(parsed.supportedPublishModes)) {
    throw new Error(`Template metadata has invalid supportedPublishModes: ${metadataPath}`);
  }
  return parsed;
}

function checkTemplatePublishModeCompatibility(
  publishMode: string,
  templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template',
): TemplatePublishModeCompatibility {
  const metadataPath = path.join(templateDir, '.kaseki-template-version');
  const metadata = readTemplateVersionMetadata(templateDir);

  // Legacy templates do not have this metadata file. Allow them to continue so
  // operators can roll the API and template in either order; once present, the
  // metadata becomes authoritative for compatibility checks.
  if (!metadata?.supportedPublishModes) {
    return { ok: true, metadataPath };
  }

  if (metadata.supportedPublishModes.includes(publishMode)) {
    return { ok: true, metadataPath, supportedPublishModes: metadata.supportedPublishModes };
  }

  return {
    ok: false,
    metadataPath,
    supportedPublishModes: metadata.supportedPublishModes,
    detail: `Template does not support publish mode \`${publishMode}\`; redeploy kaseki-agent.`,
    remediation: 'Redeploy kaseki-agent.',
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildRequestFingerprint(runRequest: Record<string, unknown>): string {
  const requestForFingerprint = { ...runRequest };
  delete requestForFingerprint.idempotencyKey;
  return crypto.createHash('sha256').update(stableStringify(requestForFingerprint)).digest('hex');
}

function readKasekiImage(templateDir = '/agents/kaseki-template'): string {
  if (process.env.KASEKI_IMAGE) {
    return process.env.KASEKI_IMAGE;
  }
  const imageFile = path.join(templateDir, '.kaseki-image');
  try {
    const value = fs.readFileSync(imageFile, 'utf-8').trim();
    if (value) {
      return value;
    }
  } catch {
    // Fall through to the registry default.
  }
  return 'docker.io/cyanautomation/kaseki-agent:latest';
}

function inspectImageDigest(image: string): string | undefined {
  return commandOutput('docker', ['image', 'inspect', image, '--format', '{{range .RepoDigests}}{{println .}}{{end}}'])
    ?.split(/\r?\n/)
    .find((line) => line.trim().length > 0);
}

// Re-export from subprocess-helpers for backward compatibility with tests
export { classifyDockerFailure } from './lib/subprocess-helpers';

function parseMountInfo(): Array<{ root: string; mountPoint: string }> {
  try {
    const mountInfoPath = process.env.KASEKI_MOUNTINFO_PATH || '/proc/self/mountinfo';
    const content = fs.readFileSync(mountInfoPath, 'utf-8');
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const fields = line.split(' ');
        return {
          root: fields[3] || '',
          mountPoint: fields[4] || '',
        };
      });
  } catch {
    return [];
  }
}

function checkDeletedBindMounts(paths: string[]): PreflightCheck {
  const mountInfo = parseMountInfo();
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const deletedMounts = mountInfo.filter((mount) => {
    const root = mount.root.toLowerCase();
    if (!root.includes('deleted')) {
      return false;
    }
    return uniquePaths.some((targetPath) => (
      targetPath === mount.mountPoint || targetPath.startsWith(`${mount.mountPoint}/`)
    ));
  });

  if (deletedMounts.length === 0) {
    return {
      name: 'bind-mounts',
      ok: true,
      detail: 'No deleted bind mounts detected for Kaseki paths.',
    };
  }

  const details = deletedMounts
    .map((mount) => `${mount.mountPoint} is backed by deleted source ${mount.root}`)
    .join('; ');

  return {
    name: 'bind-mounts',
    ok: false,
    detail: details,
    remediation: 'Recreate the missing host directory, then recreate the kaseki-api container so Docker binds the live path. For the default layout: sudo /agents/kaseki-agent/scripts/kaseki-setup-host.sh --fix && docker compose up -d --force-recreate.',
  };
}

function checkOpenRouterKey(): PreflightCheck {
  const keyValue = readHostSecret('openrouter_api_key');
  if (keyValue) {
    return { name: 'openrouter-key', ok: true, detail: 'OpenRouter API key is available from host secrets.' };
  }

  const locations = getSecretLocations('openrouter_api_key');
  return {
    name: 'openrouter-key',
    ok: false,
    detail: 'No OpenRouter API key was found in host secrets.',
    remediation: `Create a secret file with your OpenRouter API key (one key per file):\n  Primary: ${locations.primary}\n  Fallback: ${locations.secondary}`,
  };
}

/**
 * Read a secret from host secrets (no inline env var fallback).
 * Returns undefined if the secret is not found.
 */
function readHostSecretValue(secretName: string): string | undefined {
  const value = readHostSecret(secretName);
  return value || undefined;
}

function checkGitHubAppCredentials(): PreflightCheck {
  // Check if any GitHub App credentials are present in host secrets
  const appId = readHostSecretValue('github_app_id');
  const clientId = readHostSecretValue('github_app_client_id');
  const privateKey = readHostSecretValue('github_app_private_key');

  if (!appId && !clientId && !privateKey) {
    return {
      name: 'github-app',
      ok: false,
      detail: 'GitHub App credentials are not configured; PR creation will be disabled.',
    };
  }

  const missing: string[] = [];
  if (!appId) {
    missing.push('github_app_id');
  }
  if (!clientId) {
    missing.push('github_app_client_id');
  }
  if (!privateKey) {
    missing.push('github_app_private_key');
  }

  if (missing.length > 0) {
    const secretLocations = missing.map((name) => {
      const locations = getSecretLocations(name);
      return `${name}: ${locations.primary} or ${locations.secondary}`;
    }).join('; ');
    return {
      name: 'github-app',
      ok: false,
      detail: `GitHub App credentials are incomplete: missing ${missing.join(', ')}.`,
      remediation: `Create the missing secret files:\\n${secretLocations}`,
    };
  }
  if (!/^\d+$/.test(appId as string)) {
    return {
      name: 'github-app',
      ok: false,
      detail: 'GitHub App ID is present but is not numeric.',
      remediation: 'The github_app_id secret file must contain only the numeric GitHub App ID.',
    };
  }
  const privateKeyValidation = validateGitHubAppPrivateKey(privateKey as string);
  if (!privateKeyValidation.ok) {
    return {
      name: 'github-app',
      ok: false,
      detail: privateKeyValidation.error || 'GitHub App private key is not valid.',
      remediation: privateKeyValidation.remediation,
    };
  }

  return {
    name: 'github-app',
    ok: true,
    detail: 'GitHub App credentials are readable and structurally valid for PR creation.',
  };
}

function isGitHubAppReady(): boolean {
  const check = checkGitHubAppCredentials();
  return check.ok && check.name === 'github-app';
}

function buildPreflightResponse(config: KasekiApiConfig): PreflightResponse {
  const templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template';
  const secretsDir = process.env.KASEKI_SECRETS_DIR || '/agents/secrets';
  const image = readKasekiImage(templateDir);
  const templateImageDigest = readFirstLine(path.join(templateDir, '.kaseki-image-digest')) || inspectImageDigest(image);
  const checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent';
  const templateRef = getTemplateCheckoutRef(checkoutDir);
  const checks: PreflightCheck[] = [];

  checks.push(checkDeletedBindMounts([config.resultsDir, templateDir, checkoutDir, secretsDir]));

  try {
    fs.accessSync(config.resultsDir, fs.constants.R_OK | fs.constants.W_OK);
    checks.push({ name: 'results-dir', ok: true, detail: `${config.resultsDir} is readable and writable.` });
  } catch (err) {
    checks.push({
      name: 'results-dir',
      ok: false,
      detail: `${config.resultsDir} is not readable and writable: ${(err as Error).message}`,
      remediation: 'Create the results directory and make it writable by the API container user.',
    });
  }

  checks.push(checkOpenRouterKey());
  checks.push(checkGitHubAppCredentials());

  const dockerVersion = execDockerCommand(['version', '--format', '{{.Client.Version}} -> {{.Server.Version}}']);
  if (dockerVersion.ok) {
    checks.push({ name: 'docker-daemon', ok: true, detail: dockerVersion.stdout });
  } else {
    const classified = dockerVersion.classification || { detail: 'Docker command failed', remediation: 'Check Docker daemon' };
    checks.push({ name: 'docker-daemon', ok: false, ...classified });
  }

  const imageInspect = execDockerCommand(['image', 'inspect', image]);
  if (imageInspect.ok) {
    checks.push({ name: 'docker-image', ok: true, detail: `Image is present: ${image}` });
  } else {
    const classified = imageInspect.classification || { detail: 'Docker command failed', remediation: 'Check Docker daemon' };
    const daemonFailed = checks.some((check) => check.name === 'docker-daemon' && !check.ok);
    checks.push({
      name: 'docker-image',
      ok: false,
      detail: daemonFailed ? classified.detail : `Docker image is not present locally: ${image}`,
      remediation: daemonFailed ? classified.remediation : `Pull ${image} or set KASEKI_IMAGE to an available image.`,
    });
  }

  const templateHealth = buildTemplateHealthStatus(templateDir);
  checks.push({
    name: 'template',
    ok: templateHealth.ok,
    detail: templateHealth.detail,
    remediation: templateHealth.remediation,
    templatePath: templateHealth.templateDir,
    checkoutRef: templateHealth.checkoutRef,
    doctorCommand: templateHealth.doctorCommand,
    doctorStderrTail: templateHealth.doctorStderrTail,
  });

  const status = checks.every((check) => check.ok)
    ? 'ok'
    : checks.some((check) => check.name === 'docker-daemon' && !check.ok)
      ? 'error'
      : 'degraded';
  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
    image,
    imageDigest: templateImageDigest,
    templateImage: image,
    templateImageDigest,
    templateDir,
    templateRef,
    resultsDir: config.resultsDir,
    runtime: {
      nodeVersion: process.version,
      uid: process.getuid?.(),
      gid: process.getgid?.(),
      groups: process.getgroups?.(),
    },
    docker: {
      version: dockerVersion.stdout,
      clientVersion: dockerVersion.stdout?.split(' -> ')[0],
      serverVersion: dockerVersion.stdout?.split(' -> ')[1],
    },
  };
}

function buildRunResponse(job: Job, cached = false): RunResponse {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    correlationId: job.correlationId,
    requestId: job.requestId,
    cached: cached || undefined,
    completedAt: job.completedAt?.toISOString(),
    exitCode: job.exitCode,
    failureClass: job.failureClass,
    error: job.error,
  };
}

/**
 * Create the API routes.
 */
export function createApiRouter(
  scheduler: JobScheduler,
  config: KasekiApiConfig,
  idempotencyStore: IdempotencyStore,
  preFlightValidator: PreFlightValidator,
  artifactCache = new ResultCache({
    maxEntries: config.artifactCacheMaxEntries,
    ttlMs: config.artifactCacheTtlMs,
    maxFileBytes: config.artifactCacheMaxFileBytes,
  }),
): Router {
  const router = Router();
  const logger = createEventLogger('api');

  /**
   * Middleware: Request/Response logging.
   */
  router.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const originalSend = res.send;

    res.send = function (data: any) {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Log request/response event
      logger.event('api_request_complete', {
        method: req.method,
        path: req.path,
        statusCode,
        durationMs: duration,
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
      });

      return originalSend.call(this, data);
    };

    next();
  });

  /**
   * Middleware: API key validation.
   */
  router.use((req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health check
    if (req.path === '/health' || req.path === '/ready') {
      return next();
    }

    if (config.apiKeys.length === 0) {
      if (isLoopbackRemoteAddress(req.socket.remoteAddress)) {
        return next();
      }

      logger.event('api_auth_failed', {
        path: req.path,
        reason: 'unauthenticated_mode_non_loopback_request',
        remoteAddress: req.socket.remoteAddress,
      });
      return sendErrorResponse(
        res,
        401,
        'Unauthorized',
        'Unauthenticated local mode only accepts loopback requests'
      );
    }

    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.event('api_auth_failed', {
        path: req.path,
        reason: 'missing_or_invalid_header',
      });
      return sendErrorResponse(res, 401, 'Unauthorized', 'Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    if (!validateApiKey(config, token)) {
      logger.event('api_auth_failed', {
        path: req.path,
        reason: 'invalid_api_key',
      });
      return sendErrorResponse(res, 401, 'Unauthorized', 'Invalid API key');
    }

    next();
  });

  /**
   * Health check endpoint.
   */
  router.get('/health', (_req: Request, res: Response) => {
    const queueStatus = scheduler.getQueueStatus();
    const errors: string[] = [];

    // Check if results directory is accessible
    if (!fs.existsSync(config.resultsDir)) {
      errors.push(`Results directory not accessible: ${config.resultsDir}`);
    }

    const status = errors.length === 0 ? 'healthy' : 'degraded';

    res.json({
      status,
      timestamp: new Date().toISOString(),
      queue: queueStatus,
      errors: errors.length > 0 ? errors : undefined,
    });
  });

  router.get('/ready', (_req: Request, res: Response) => {
    const readiness = scheduler.getReadiness();
    if (readiness.ready) {
      return res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
    }
    return res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      reasons: readiness.reasons,
    });
  });

  router.get('/metrics', (_req: Request, res: Response) => {
    const cacheStats = artifactCache.getStats();
    const artifactCacheMetrics = [
      '# HELP kaseki_artifact_cache_entries Number of artifact content cache entries currently held in memory.',
      '# TYPE kaseki_artifact_cache_entries gauge',
      `kaseki_artifact_cache_entries ${cacheStats.entries}`,
      '# HELP kaseki_artifact_cache_bytes Bytes of artifact content currently held in memory.',
      '# TYPE kaseki_artifact_cache_bytes gauge',
      `kaseki_artifact_cache_bytes ${cacheStats.bytes}`,
      '# HELP kaseki_artifact_cache_hits_total Total artifact content cache hits.',
      '# TYPE kaseki_artifact_cache_hits_total counter',
      `kaseki_artifact_cache_hits_total ${cacheStats.hits}`,
      '# HELP kaseki_artifact_cache_misses_total Total artifact content cache misses.',
      '# TYPE kaseki_artifact_cache_misses_total counter',
      `kaseki_artifact_cache_misses_total ${cacheStats.misses}`,
      '# HELP kaseki_artifact_cache_max_entries Configured maximum artifact content cache entries.',
      '# TYPE kaseki_artifact_cache_max_entries gauge',
      `kaseki_artifact_cache_max_entries ${cacheStats.maxEntries}`,
      '# HELP kaseki_artifact_cache_max_file_bytes Configured maximum file size eligible for artifact content caching.',
      '# TYPE kaseki_artifact_cache_max_file_bytes gauge',
      `kaseki_artifact_cache_max_file_bytes ${cacheStats.maxFileBytes}`,
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(`${metricsRegistry.renderPrometheus()}${artifactCacheMetrics}\n`);
  });

  /**
   * GET /api/preflight - Controller-oriented readiness diagnostics.
   */
  router.get('/preflight', (_req: Request, res: Response) => {
    const response = buildPreflightResponse(config);
    res.status(response.status === 'error' ? 503 : 200).json(response);
  });

  /**
   * POST /api/runs - Trigger a new kaseki run.
   */
  router.post('/runs', async (req: Request, res: Response) => {
    try {
      // Validate request body
      const runRequest = RunRequestSchema.parse({
        ...req.body,
        startupCheck:
          req.query.dryRun === 'true' || req.query.startupCheck === 'true'
            ? true
            : req.body?.startupCheck,
      });

      const effectivePublishMode = runRequest.publishMode || 'pr';
      const effectiveRunRequest = {
        ...runRequest,
        publishMode: effectivePublishMode,
      };
      if (
        (effectivePublishMode === 'branch' || effectivePublishMode === 'pr' || effectivePublishMode === 'draft_pr') &&
        !isGitHubAppReady()
      ) {
        return sendErrorResponse(
          res,
          400,
          'Bad Request',
          `publishMode=${effectivePublishMode} requires readable GitHub App credentials. Check /api/preflight before submitting publishable runs.`,
        );
      }

      if (process.env.KASEKI_SKIP_BOOTSTRAP_CHECK !== '1') {
        const templateHealth = buildTemplateHealthStatus();
        if (!templateHealth.ok) {
          return res.status(400).json({
            type: 'https://api.kaseki.local/errors#template-not-ready',
            title: 'Bad Request',
            status: 400,
            detail: `Kaseki template is not ready. ${templateHealth.detail}. ${TEMPLATE_REMEDIATION}`,
            templatePath: templateHealth.templateDir,
            checkoutRef: templateHealth.checkoutRef ?? 'unknown',
            doctorCommand: templateHealth.doctorCommand,
            doctorStderrTail: templateHealth.doctorStderrTail,
            remediation: TEMPLATE_REMEDIATION,
          });
        }
      }

      const templateCompatibility = checkTemplatePublishModeCompatibility(effectivePublishMode);
      if (!templateCompatibility.ok) {
        return res.status(400).json({
          type: 'https://api.kaseki.local/errors#template-incompatible',
          title: 'Bad Request',
          status: 400,
          detail: templateCompatibility.detail,
          templateMetadataPath: templateCompatibility.metadataPath,
          supportedPublishModes: templateCompatibility.supportedPublishModes,
          remediation: templateCompatibility.remediation,
        });
      }

      // Auto-generate idempotency key if not provided
      const idempotencyKey = runRequest.idempotencyKey || randomUUID();
      const requestFingerprint = buildRequestFingerprint(effectiveRunRequest as Record<string, unknown>);

      const claimResult = idempotencyStore.claimOrGet(idempotencyKey, requestFingerprint);
      if (claimResult.kind === 'fulfilled') {
        const currentJob = scheduler.getJob(claimResult.response.id);
        const response = currentJob
          ? buildRunResponse(currentJob, true)
          : {
            ...claimResult.response,
            cached: true,
          };
        logger.event('api_idempotent_resubmission', {
          jobId: response.id,
          idempotencyKey,
          currentStatus: currentJob?.status,
        });
        return res.status(200).json(response); // 200 OK, not 202
      }
      if (claimResult.kind === 'pending') {
        return sendErrorResponse(res, 409, 'Conflict', 'Request with this idempotency key is already being processed');
      }

      // Log request
      logger.event('api_run_request', {
        repoUrl: runRequest.repoUrl,
        ref: runRequest.ref,
        taskMode: runRequest.taskMode,
        publishMode: effectivePublishMode,
        startupCheck: runRequest.startupCheck,
        idempotencyKey,
      });

      // Submit to scheduler
      const job = await scheduler.submitJob(effectiveRunRequest);

      // Store idempotency key on job
      job.idempotencyKey = idempotencyKey;

      const response = buildRunResponse(job);

      // Store in idempotency cache
      idempotencyStore.storeResponse(idempotencyKey, response, requestFingerprint);

      res.status(202).json(response); // 202 Accepted
    } catch (err: unknown) {
      if (err instanceof Error && 'errors' in err) {
        // Zod validation error
        const details = (err as any).errors.map((e: any) => `${(e.path as string[]).join('.')}: ${e.message}`).join('; ');
        logger.event('api_validation_error', {
          path: '/runs',
          details,
        });
        return sendErrorResponse(res, 400, 'Bad Request', details);
      }
      logger.event('api_error', {
        path: '/runs',
        error: (err as Error).message,
      });
      return sendErrorResponse(res, 400, 'Bad Request', (err as Error).message);
    }
  });

  /**
   * POST /api/webhooks/test - Test webhook configuration.
   */
  router.post('/webhooks/test', async (req: Request, res: Response) => {
    try {
      const { url, secret } = req.body;

      if (!url || typeof url !== 'string') {
        return sendErrorResponse(res, 400, 'Bad Request', 'Webhook URL is required');
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return sendErrorResponse(res, 400, 'Bad Request', 'Invalid webhook URL format');
      }

      // Send test webhook
      let statusCode: number | undefined;
      let error: string | undefined;
      let durationMs = 0;
      const startTime = Date.now();

      try {
        const testPayload = {
          eventType: 'webhook.test',
          jobId: 'test',
          timestamp: new Date().toISOString(),
          data: { message: 'This is a test webhook from kaseki-agent API' },
        };

        // Generate HMAC signature if secret provided
        let signature: string | null = null;
        if (secret && typeof secret === 'string') {
          const body = JSON.stringify(testPayload);
          signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Kaseki-Event': 'webhook.test',
            'X-Kaseki-Job-Id': 'test',
            ...(signature && { 'X-Kaseki-Signature': `sha256=${signature}` }),
          },
          body: JSON.stringify(testPayload),
          signal: AbortSignal.timeout(10000),
        });

        durationMs = Date.now() - startTime;
        statusCode = response.status;

        if (!response.ok) {
          error = `HTTP ${response.status} ${response.statusText}`;
        }
      } catch (err) {
        durationMs = Date.now() - startTime;
        error = err instanceof Error ? err.message : String(err);
      }

      const result = {
        url,
        statusCode,
        durationMs,
        success: !error,
        error,
      };

      logger.event('webhook_test', result);

      res.json(result);
    } catch (err) {
      logger.event('api_error', {
        path: '/webhooks/test',
        error: (err as Error).message,
      });
      return sendErrorResponse(res, 400, 'Bad Request', (err as Error).message);
    }
  });

  /**
   * POST /api/validate - Pre-flight validation of job request (dry-run).
   */
  router.post('/validate', async (req: Request, res: Response) => {
    try {
      // Validate request body
      const runRequest = RunRequestSchema.parse(req.body);

      logger.event('api_validation_request', {
        repoUrl: runRequest.repoUrl,
        ref: runRequest.ref,
      });

      // Run pre-flight validation
      const validationResult = await preFlightValidator.validate(runRequest);

      const response: ValidationResponse = validationResult;

      res.json(response);
    } catch (err: unknown) {
      if (err instanceof Error && 'errors' in err) {
        // Zod validation error
        const details = (err as any).errors.map((e: any) => `${(e.path as string[]).join('.')}: ${e.message}`).join('; ');
        logger.event('api_validation_error', {
          path: '/validate',
          details,
        });
        return sendErrorResponse(res, 400, 'Bad Request', details);
      }
      logger.event('api_error', {
        path: '/validate',
        error: (err as Error).message,
      });
      return sendErrorResponse(res, 400, 'Bad Request', (err as Error).message);
    }
  });

  // Register domain-focused route modules
  router.use(createStatusRoutes(scheduler, config));
  router.use(createLogRoutes(scheduler, config));
  router.use(createArtifactRoutes(scheduler, config, artifactCache));
  router.use(createWebhookRoutes());

  return router;
}
