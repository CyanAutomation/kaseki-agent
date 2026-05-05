import { Router, Request, Response, NextFunction } from 'express';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { randomUUID } from 'node:crypto';
import { JobScheduler } from './job-scheduler';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
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
import { createStatusRoutes } from './routes/status-routes';
import { createLogRoutes } from './routes/log-routes';
import { createArtifactRoutes } from './routes/artifact-routes';
import { createWebhookRoutes } from './routes/webhook-routes';
import { metricsRegistry } from './metrics';

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

function utf8SequenceLength(leadingByte: number): number {
  if ((leadingByte & 0x80) === 0) return 1;
  if ((leadingByte & 0xe0) === 0xc0) return 2;
  if ((leadingByte & 0xf0) === 0xe0) return 3;
  if ((leadingByte & 0xf8) === 0xf0) return 4;
  return 1;
}

export function decodeUtf8TailSafely(buffer: Buffer): string {
  let end = buffer.length;
  if (end > 0) {
    let continuationCount = 0;
    let candidateLead = end - 1;

    while (candidateLead >= 0 && isUtf8ContinuationByte(buffer[candidateLead])) {
      continuationCount++;
      candidateLead--;
    }

    if (candidateLead < 0) {
      end = 0;
    } else {
      const sequenceLength = utf8SequenceLength(buffer[candidateLead]);
      const expectedContinuationCount = sequenceLength - 1;

      if (sequenceLength > 1 && continuationCount !== expectedContinuationCount) {
        end = candidateLead;
      }
    }
  }

  return buffer.subarray(0, end).toString('utf-8');
}

export function tailLogByLines(content: string, maxLines: number): string {
  if (maxLines <= 0) {
    return '';
  }

  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return content;
  }
  return lines.slice(-maxLines).join('\n');
}

export function readTailBytes(logFile: string, size: number, maxSize: number): Buffer {
  const truncated = Buffer.alloc(maxSize);
  const fd = fs.openSync(logFile, 'r');
  try {
    fs.readSync(fd, truncated, 0, maxSize, size - maxSize);
  } finally {
    fs.closeSync(fd);
  }

  return truncated;
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

function readFirstLine(filePath: string): string | undefined {
  try {
    const value = fs.readFileSync(filePath, 'utf-8').trim().split(/\r?\n/)[0];
    return value || undefined;
  } catch {
    return undefined;
  }
}

function commandOutput(command: string, args: string[], cwd?: string): string | undefined {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    timeout: 5000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
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

export function classifyDockerFailure(stderr: string): { detail: string; remediation: string } {
  const normalized = stderr.toLowerCase();
  if (normalized.includes('permission denied') || normalized.includes('connect: permission denied')) {
    return {
      detail: 'Docker daemon socket is not accessible from the API process.',
      remediation:
        'Add the API container user to the host Docker socket group, for example group_add: ["${DOCKER_GID:-985}"].',
    };
  }
  if (normalized.includes('cannot connect') || normalized.includes('is the docker daemon running')) {
    return {
      detail: 'Docker daemon is unreachable from the API process.',
      remediation: 'Mount /var/run/docker.sock and verify the host Docker daemon is running.',
    };
  }
  return {
    detail: stderr.trim() || 'Docker command failed.',
    remediation: 'Verify Docker CLI, daemon access, and the mounted Docker socket.',
  };
}

function checkOpenRouterKey(): PreflightCheck {
  if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.length > 0) {
    return { name: 'openrouter-key', ok: true, detail: 'OPENROUTER_API_KEY is present in the API environment.' };
  }

  const keyFile = process.env.OPENROUTER_API_KEY_FILE || '/run/secrets/openrouter_api_key';
  try {
    const stat = fs.statSync(keyFile);
    if (stat.isFile() && stat.size > 0) {
      return { name: 'openrouter-key', ok: true, detail: `Readable key file: ${keyFile}` };
    }
  } catch {
    // Handled below.
  }

  return {
    name: 'openrouter-key',
    ok: false,
    detail: 'No OpenRouter API key was found in env or the configured key file.',
    remediation: 'Set OPENROUTER_API_KEY for API-triggered runs or mount OPENROUTER_API_KEY_FILE.',
  };
}

function buildPreflightResponse(config: KasekiApiConfig): PreflightResponse {
  const templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template';
  const image = readKasekiImage(templateDir);
  const templateImageDigest = readFirstLine(path.join(templateDir, '.kaseki-image-digest')) || inspectImageDigest(image);
  const checkoutDir = process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent';
  const templateRef = fs.existsSync(path.join(checkoutDir, '.git'))
    ? commandOutput('git', ['rev-parse', '--short', 'HEAD'], checkoutDir)
    : undefined;
  const checks: PreflightCheck[] = [];

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

  const dockerVersion = spawnSync('docker', ['version', '--format', '{{.Client.Version}} -> {{.Server.Version}}'], {
    encoding: 'utf-8',
    timeout: 5000,
  });
  const dockerVersionText = dockerVersion.status === 0 ? dockerVersion.stdout.trim() : undefined;
  if (dockerVersion.status === 0) {
    checks.push({ name: 'docker-daemon', ok: true, detail: dockerVersionText });
  } else {
    const classified = classifyDockerFailure(dockerVersion.stderr || dockerVersion.stdout || dockerVersion.error?.message || '');
    checks.push({ name: 'docker-daemon', ok: false, ...classified });
  }

  const imageInspect = spawnSync('docker', ['image', 'inspect', image], {
    encoding: 'utf-8',
    timeout: 5000,
  });
  if (imageInspect.status === 0) {
    checks.push({ name: 'docker-image', ok: true, detail: `Image is present: ${image}` });
  } else {
    const classified = classifyDockerFailure(imageInspect.stderr || imageInspect.stdout || imageInspect.error?.message || '');
    const daemonFailed = checks.some((check) => check.name === 'docker-daemon' && !check.ok);
    checks.push({
      name: 'docker-image',
      ok: false,
      detail: daemonFailed ? classified.detail : `Docker image is not present locally: ${image}`,
      remediation: daemonFailed ? classified.remediation : `Pull ${image} or set KASEKI_IMAGE to an available image.`,
    });
  }

  const runScript = path.join(templateDir, 'run-kaseki.sh');
  checks.push({
    name: 'template',
    ok: fs.existsSync(runScript),
    detail: fs.existsSync(runScript) ? `Template runner exists: ${runScript}` : `Missing template runner: ${runScript}`,
    remediation: fs.existsSync(runScript) ? undefined : 'Run scripts/kaseki-activate.sh --controller bootstrap.',
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
      version: dockerVersionText,
      clientVersion: dockerVersionText?.split(' -> ')[0],
      serverVersion: dockerVersionText?.split(' -> ')[1],
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
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(metricsRegistry.renderPrometheus());
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

      // Auto-generate idempotency key if not provided
      const idempotencyKey = runRequest.idempotencyKey || randomUUID();
      const requestFingerprint = buildRequestFingerprint(runRequest as Record<string, unknown>);

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
        startupCheck: runRequest.startupCheck,
        idempotencyKey,
      });

      // Submit to scheduler
      const job = await scheduler.submitJob(runRequest);

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
  router.use(createArtifactRoutes(scheduler, config));
  router.use(createWebhookRoutes());

  return router;
}
