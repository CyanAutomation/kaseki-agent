import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as crypto from 'crypto';
import { JobScheduler, RunAlreadyActiveError } from './job-scheduler';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import { classifyDockerFailure } from './lib/subprocess-helpers';
import { getContainerPreflightResults } from './startup/container-preflight';
import {
  RunRequestSchema,
  RunResponse,
  ValidationResponse,
  PreflightResponse,
  Job,
  RunRequest,
} from './kaseki-api-types';
import { KasekiApiConfig, validateApiKey } from './kaseki-api-config';
import { createEventLogger } from './logger';
import { sendErrorResponse } from './utils/response-helpers';
import { createStatusRoutes } from './routes/status-routes';
import { createLogRoutes } from './routes/log-routes';
import { createArtifactRoutes } from './routes/artifact-routes';
import { createWebhookRoutes } from './routes/webhook-routes';
import { createWebhookDeliveryRoutes } from './routes/webhook-delivery-routes';
import { createSoyuzCallbackRoutes } from './routes/soyuz-callback-routes';
import { createHealthRoutes } from './routes/health-routes';
import { createImprovementRoutes } from './routes/improvement-routes';
import { ResultCache } from './result-cache';
import { metricsRegistry } from './metrics';
import { getCachedStartupHealthReport } from './kaseki-api/startup-summary-artifact';
import { healthReportToMarkdown } from './kaseki-api/startup-health-reporter';
import {
  checkGitHubAppCredentials,
  getSubmissionTemplateHealthStatus,
  checkTemplatePublishModeCompatibility,
  TEMPLATE_REMEDIATION,
  isTemplateDoctorTimeout,
} from './kaseki-api-health-checks';
import { buildPreflightResponse as buildPreflightResponseImpl } from './kaseki-api-routes-preflight';
import { createGatewayTestRoutes } from './routes/gateway-test-routes';
import { createScorecardRoutes } from './routes/scorecard-routes';
import { testPiGatewayProviderSmoke } from './kaseki-api-gateway-smoke';
import { getPackageVersion } from './openapi-spec-generators/components';
import { evaluateTaskAdmission, TASK_ADMISSION_EXIT_CODE, type TaskAdmissionEvaluator } from './task-admission';
import { ApiAccessController } from './api-access-control';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { getStorageCapacityError, storageErrorFields } from './storage-capacity';
import { SoyuzApiError } from './integrations/soyuz/SoyuzApiClient';
import { SoyuzSubmissionClient, normalizeSoyuzRunStatus, type SoyuzSubmittedRun } from './integrations/soyuz/SoyuzSubmissionClient';
import { parseSoyuzRunRequest } from './integrations/soyuz/contracts';

function formatZodValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return false;
  }

  return (
    remoteAddress === '::1' ||
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::ffff:127.0.0.1' ||
    remoteAddress.startsWith('127.')
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildRequestFingerprint(runRequest: Record<string, unknown>): string {
  const requestForFingerprint = { ...runRequest };
  delete requestForFingerprint.idempotencyKey;
  return crypto
    .createHash('sha256')
    .update(stableStringify(requestForFingerprint))
    .digest('hex');
}

function isGitHubAppReady(): boolean {
  const check = checkGitHubAppCredentials();
  return check.ok && check.name === 'github-app';
}

// Delegate to extracted preflight response builder for reduced cognitive complexity
function buildPreflightResponse(config: KasekiApiConfig): PreflightResponse {
  return buildPreflightResponseImpl(config);
}

function buildRunResponse(job: Job, cached = false): RunResponse {
  return {
    id: job.soyuz?.externalRunId ?? job.id,
    ...(job.soyuz ? { localRunId: job.id } : {}),
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    correlationId: job.correlationId,
    requestId: job.requestId,
    projectName: job.request?.projectName,
    origin: job.soyuz?.origin,
    retryOf: job.soyuz?.retryOf ?? undefined,
    cached: cached || undefined,
    completedAt: job.completedAt?.toISOString(),
    exitCode: job.exitCode,
    failureClass: job.failureClass,
    error: job.error,
  };
}

function buildSoyuzRunResponse(run: SoyuzSubmittedRun, request?: RunRequest, retryOf?: string): RunResponse {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(run.id)) {
    throw new Error('Soyuz returned an invalid canonical run ID');
  }
  return {
    id: run.id,
    status: normalizeSoyuzRunStatus(run.status),
    createdAt: run.createdAt,
    correlationId: run.correlationId,
    requestId: run.requestId,
    projectName: request?.projectName,
    origin: run.origin,
    ...((retryOf ?? run.retryOf) ? { retryOf: retryOf ?? run.retryOf ?? undefined } : {}),
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
  taskAdmissionEvaluator: TaskAdmissionEvaluator = evaluateTaskAdmission,
  submissionClient?: SoyuzSubmissionClient,
): Router {
  const router = Router();
  const logger = createEventLogger('api');
  const apiAccess = new ApiAccessController({
    requestsPerMinute: config.apiRequestsPerMinute,
    diagnosticsPerHour: config.apiDiagnosticsPerHour,
    webhookTestsPerHour: config.apiWebhookTestsPerHour,
    soyuzCallbackRetriesPerHour: config.apiSoyuzCallbackRetriesPerHour,
  });
  registerApiMiddleware(router, config, logger, apiAccess);

  /**
   * Mount health-check routes (/health, /ready, /metrics)
   */
  router.use(createHealthRoutes(scheduler, config, artifactCache));

  /**
   * Mount gateway test routes (/gateway-test)
   */
  router.use(createGatewayTestRoutes());
  registerApiInfoRoutes(router, config, logger, apiAccess);
  registerRunRoutes(router, scheduler, idempotencyStore, taskAdmissionEvaluator, logger, submissionClient);
  registerValidationRoute(router, preFlightValidator, taskAdmissionEvaluator, logger);

  // Register domain-focused route modules
  router.use(createStatusRoutes(scheduler, config, artifactCache, submissionClient));
  router.use(createLogRoutes(scheduler, config, artifactCache));
  router.use(createArtifactRoutes(scheduler, config, artifactCache));
  router.use(createScorecardRoutes(scheduler, artifactCache));
  router.use(createImprovementRoutes(scheduler, config));
  router.use(createWebhookRoutes());
  router.use(createWebhookDeliveryRoutes(scheduler));
  router.use(createSoyuzCallbackRoutes(scheduler));

  router.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    logger.error('Unhandled API route error', { path: req.path, error: error instanceof Error ? error.message : String(error) });
    const storageError = getStorageCapacityError(error);
    if (storageError) {
      return sendErrorResponse(
        res,
        storageError.statusCode,
        storageError.statusCode === 507 ? 'Insufficient Storage' : 'Service Unavailable',
        storageError.message,
        storageErrorFields(storageError),
      );
    }
    return sendErrorResponse(res, 500, 'Internal Server Error', 'An unexpected error occurred');
  });

  return router;
}

async function admitTaskWithLogging(
  taskAdmissionEvaluator: TaskAdmissionEvaluator,
  logger: ReturnType<typeof createEventLogger>,
  runRequest: RunRequest,
): Promise<Awaited<ReturnType<TaskAdmissionEvaluator>>> {
  const result = await taskAdmissionEvaluator(runRequest as unknown as Record<string, unknown>);
  if (result.status === 'rejected') {
    metricsRegistry.incAdmissionRejection('task-safety');
    logger.event('task_admission_rejected', { reason: result.reason, riskScore: result.riskScore, responseTime: result.responseTime });
  } else if (result.degraded) {
    logger.event('task_admission_degraded', { reason: result.reason, warnings: result.warnings });
  }
  return result;
}

function registerApiMiddleware(
  router: Router,
  config: KasekiApiConfig,
  logger: ReturnType<typeof createEventLogger>,
  apiAccess: ApiAccessController,
): void {
  router.use((req: Request, res: Response, next: NextFunction) => {
    const suppliedId = req.get('X-Request-ID');
    const requestId = suppliedId && /^[\w.-]{1,128}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  });

  /**
   * Middleware: Request/Response logging.
   */
  router.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    res.on('finish', () => {
      const routeTemplate = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      metricsRegistry.observeHttpRequest(req.method, routeTemplate, res.statusCode, (Date.now() - startTime) / 1000);
    });
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

  // Apply a framework-recognized limit before authorization so invalid
  // credentials are throttled too. Authorized requests use ApiAccessController's
  // fixed-window quota below, avoiding two independently resetting buckets.
  router.use(rateLimit({
    windowMs: 60_000,
    limit: config.apiRequestsPerMinute ?? 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => {
      if (req.path === '/health' || req.path === '/ready') return true;
      if (config.apiKeys.length === 0) return isLoopbackRemoteAddress(req.socket.remoteAddress);
      const authorization = req.get('Authorization');
      return authorization?.startsWith('Bearer ') === true && validateApiKey(config, authorization.slice(7));
    },
    keyGenerator: (req) => {
      const clientAddress = req.ip ?? req.socket.remoteAddress;
      return clientAddress ? `ip:${ipKeyGenerator(clientAddress)}` : 'ip:unknown';
    },
    handler: (_req, res) => {
      sendErrorResponse(res, 429, 'Too Many Requests', 'API request limit exceeded; retry after the indicated delay');
    },
  }));

  /**
   * Middleware: API key validation.
   */
  router.use((req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health check endpoints only
    if (req.path === '/health' || req.path === '/ready') {
      return next();
    }

    if (config.apiKeys.length === 0) {
      if (isLoopbackRemoteAddress(req.socket.remoteAddress)) {
        return authorizeAndLimit('__loopback__');
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
        'Unauthenticated local mode only accepts loopback requests',
      );
    }

    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.event('api_auth_failed', {
        path: req.path,
        reason: 'missing_or_invalid_header',
      });
      return sendErrorResponse(
        res,
        401,
        'Unauthorized',
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.slice(7);
    if (!validateApiKey(config, token)) {
      logger.event('api_auth_failed', {
        path: req.path,
        reason: 'invalid_api_key',
      });
      return sendErrorResponse(res, 401, 'Unauthorized', 'Invalid API key');
    }

    return authorizeAndLimit(token);

    function authorizeAndLimit(apiKey: string) {
      res.locals.apiKey = apiKey;
      const retryAfter = apiAccess.checkAndRecord(apiKey, req.method, req.path, req.query);
      if (retryAfter !== undefined) {
        res.setHeader('Retry-After', String(retryAfter));
        return sendErrorResponse(res, 429, 'Too Many Requests', 'API request limit exceeded; retry after the indicated delay');
      }
      return next();
    }
  });
}

function registerApiInfoRoutes(
  router: Router,
  config: KasekiApiConfig,
  logger: ReturnType<typeof createEventLogger>,
  apiAccess: ApiAccessController,
): void {
  router.get('/usage', (_req: Request, res: Response) => {
    const apiKey = typeof res.locals.apiKey === 'string' ? res.locals.apiKey : '__loopback__';
    res.json({ ...apiAccess.getUsage(apiKey), limits: {
      requestsPerMinute: config.apiRequestsPerMinute ?? 300,
      diagnosticsPerHour: config.apiDiagnosticsPerHour ?? 10,
      webhookTestsPerHour: config.apiWebhookTestsPerHour ?? 10,
      soyuzCallbackRetriesPerHour: config.apiSoyuzCallbackRetriesPerHour ?? 100,
    } });
  });

  router.get('/capabilities', (_req: Request, res: Response) => {
    res.json({
      apiVersion: getPackageVersion(),
      taskModes: ['patch', 'inspect'],
      publishModes: ['auto', 'none', 'branch', 'pr'],
      limits: {
        maxActiveRunsPerAgent: 1,
        maxDiffBytes: config.maxDiffBytes,
        timeoutSeconds: config.agentTimeoutSeconds,
        terminalRunIndexMaxEntries: config.jobIndexMaxEntries,
      },
      eventProtocol: {
        snapshot: '/api/v1/runs/{id}/events',
        stream: '/api/v1/runs/{id}/events/stream',
        cursorQueryParameter: 'cursor',
        reconnectHeader: 'Last-Event-ID',
        eventIds: true,
        heartbeatSeconds: 15,
      },
    });
  });

  /**
   * GET /api/v1/preflight - Controller-oriented readiness diagnostics.
   */
  router.get('/preflight', (_req: Request, res: Response) => {
    const response = buildPreflightResponse(config);

    // This opt-in probe uses the same Pi provider path as coding runs. It is
    // intentionally not part of the inexpensive default preflight because it
    // consumes inference tokens, but callers that request it must not receive
    // a green readiness report when the coding adapter is unusable.
    if (String(_req.query.agentCapability ?? '').toLowerCase() === 'true') {
      const piProviderResult = testPiGatewayProviderSmoke({ requested: true });
      const capabilityCheck = {
        name: 'pi-provider-adapter',
        ok: piProviderResult.status === 'ok',
        detail: piProviderResult.detail,
        remediation: piProviderResult.remediation,
      };
      response.checks.push(capabilityCheck);
      response.checkCount = response.checks.length;
      if (!capabilityCheck.ok) {
        response.failedChecks.push(capabilityCheck);
        response.status = 'error';
      }
    }

    // Include cached container startup diagnostics as boot history only.
    // These observations are not rerun for this request and are excluded from
    // the top-level current readiness status/checks.
    const containerPreflightResults = getContainerPreflightResults();
    if (containerPreflightResults) {
      response.containerStartup = {
        scope: 'startup',
        readinessImpact: 'excluded-from-current-readiness',
        current: false,
        recommendedCurrentEndpoint: '/api/v1/preflight',
        timestamp: containerPreflightResults.timestamp,
        cachedAt: containerPreflightResults.timestamp,
        checks: containerPreflightResults.checks,
      };
    }

    res.status(response.status === 'error' ? 503 : 200).json(response);
  });

  /**
   * GET /api/v1/startup-health — Unified startup health report (Phase 4)
   * Returns consolidated health status with bootstrap timing, preflight checks, and component status
   */
  router.get('/startup-health', (req: Request, res: Response): void => {
    const wantsMarkdown =
      String(req.query.format || '').toLowerCase() === 'markdown' ||
      String(req.headers.accept || '').toLowerCase().includes('text/markdown');

    try {
      const report = getCachedStartupHealthReport();

      if (!report) {
        if (wantsMarkdown) {
          res.status(404).type('text/markdown').send('# Startup Health Report\n\nReport not yet available.\n');
          return;
        }

        return sendErrorResponse(res, 404, 'Not Found', 'Startup health report not yet generated. Check back after service initialization.');
      }

      if (wantsMarkdown) {
        const markdown = healthReportToMarkdown(report);
        res.type('text/markdown').status(200).send(markdown);
        return;
      }

      res.status(200).json({
        scope: 'startup',
        current: false,
        recommendedCurrentEndpoint: '/api/v1/preflight',
        ...report,
      });
    } catch (err) {
      logger.error('Failed to retrieve startup health report', {
        error: err instanceof Error ? err.message : String(err),
      });

      if (wantsMarkdown) {
        res.status(500).type('text/markdown').send('# Error\n\nFailed to generate health report.\n');
        return;
      }

      return sendErrorResponse(res, 500, 'Internal Server Error', 'Failed to retrieve startup health report');
    }
  });
}

function registerRunRoutes(
  router: Router,
  scheduler: JobScheduler,
  idempotencyStore: IdempotencyStore,
  taskAdmissionEvaluator: TaskAdmissionEvaluator,
  logger: ReturnType<typeof createEventLogger>,
  submissionClient?: SoyuzSubmissionClient,
): void {
  /**
   * Extract: Validate publish mode has proper authentication.
   */
  async function validatePublishModeAndAuth(
    publishMode: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (
      (publishMode === 'branch' || publishMode === 'pr') &&
      !isGitHubAppReady()
    ) {
      return {
        ok: false,
        error: `publishMode=${publishMode} requires readable GitHub App credentials. Check /api/v1/preflight before submitting publishable runs.`,
      };
    }
    return { ok: true };
  }

  /**
   * Extract: Validate template readiness and compatibility.
   */
  async function validateTemplateReadiness(publishMode: string): Promise<{
    ok: boolean;
    statusCode?: number;
    response?: Record<string, unknown>;
  }> {
    const templateDir =
      process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template';

    // Check publish mode compatibility
    const templateCompatibility =
      checkTemplatePublishModeCompatibility(publishMode);
    if (!templateCompatibility.ok) {
      return {
        ok: false,
        statusCode: 400,
        response: {
          type: 'https://api.kaseki.local/errors#template-incompatible',
          title: 'Bad Request',
          status: 400,
          detail: templateCompatibility.detail,
          templateMetadataPath: templateCompatibility.metadataPath,
          supportedPublishModes: templateCompatibility.supportedPublishModes,
          remediation: templateCompatibility.remediation,
        },
      };
    }

    // Check bootstrap status (unless skipped)
    if (process.env.KASEKI_SKIP_BOOTSTRAP_CHECK !== '1') {
      const { status: templateHealth, fromCache: templateHealthFromCache } =
        getSubmissionTemplateHealthStatus(templateDir);
      if (!templateHealth.ok) {
        if (isTemplateDoctorTimeout(templateHealth)) {
          metricsRegistry.incAdmissionRejection('template-doctor-timeout');
          logger.event('api_template_doctor_timeout_admitted', {
            fromCache: templateHealthFromCache,
            detail: templateHealth.detail,
          });
        } else {
          metricsRegistry.incAdmissionRejection('template-not-ready');
          return {
            ok: false,
            statusCode: 400,
            response: {
              type: 'https://api.kaseki.local/errors#template-not-ready',
              title: 'Bad Request',
              status: 400,
              detail: `Kaseki template is not ready. ${templateHealth.detail}. ${TEMPLATE_REMEDIATION}`,
              templatePath: templateHealth.templateDir,
              checkoutRef: templateHealth.checkoutRef ?? 'unknown',
              doctorCommand: templateHealth.doctorCommand,
              doctorStderrTail: templateHealth.doctorStderrTail,
              doctorStdoutTail: templateHealth.doctorStdoutTail,
              remediation: TEMPLATE_REMEDIATION,
            },
          };
        }
      }
    }

    return { ok: true };
  }

  /**
   * Extract: Handle idempotency key claim and check.
   */
  async function handleIdempotency(
    idempotencyKey: string,
    requestFingerprint: string,
  ): Promise<RunIdempotencyResult> {
    const claimResult = await idempotencyStore.claimOrGet(
      idempotencyKey,
      requestFingerprint,
    );

    if (claimResult.kind === 'fulfilled') {
      const currentJob = scheduler.getJob(claimResult.response.id) ?? (
        typeof scheduler.getJobIncludingHistory === 'function'
          ? await scheduler.getJobIncludingHistory(claimResult.response.id)
          : undefined
      );
      const response = currentJob
        ? buildRunResponse(currentJob, true)
        : (claimResult.response as RunResponse);
      return {
        state: 'fulfilled',
        response,
        jobId: claimResult.response.id,
      };
    }

    if (claimResult.kind === 'pending') {
      return { state: 'pending' };
    }

    return { state: 'fresh' };
  }

  /**
   * Extract: Normalize task mode settings.
   */
  function normalizeTaskMode(runRequest: RunRequest): void {
    if (runRequest.taskMode === 'inspect') {
      runRequest.goalCheck = {
        ...runRequest.goalCheck,
        enabled: runRequest.goalCheck?.enabled ?? false,
      };
    }
  }

  registerRunSubmissionRoute(router, {
    scheduler,
    idempotencyStore,
    taskAdmissionEvaluator,
    logger,
    validatePublishModeAndAuth,
    validateTemplateReadiness,
    normalizeTaskMode,
    handleIdempotency,
    submissionClient,
  });
  registerRunRetryRoute(router, {
    scheduler,
    idempotencyStore,
    taskAdmissionEvaluator,
    logger,
    validatePublishModeAndAuth,
    validateTemplateReadiness,
    normalizeTaskMode,
    handleIdempotency,
    submissionClient,
  });
}

type RunIdempotencyResult =
  | { state: 'fresh' }
  | { state: 'fulfilled'; response: RunResponse; jobId: string }
  | { state: 'pending' };

interface RunRouteSharedDependencies {
  scheduler: JobScheduler;
  idempotencyStore: IdempotencyStore;
  taskAdmissionEvaluator: TaskAdmissionEvaluator;
  logger: ReturnType<typeof createEventLogger>;
  submissionClient?: SoyuzSubmissionClient;
}

interface RunRouteHelpers {
  validatePublishModeAndAuth(publishMode: string): Promise<{ ok: boolean; error?: string }>;
  validateTemplateReadiness(publishMode: string): Promise<{
    ok: boolean;
    statusCode?: number;
    response?: Record<string, unknown>;
  }>;
  normalizeTaskMode(runRequest: RunRequest): void;
  handleIdempotency(idempotencyKey: string, requestFingerprint: string): Promise<RunIdempotencyResult>;
}

function registerRunSubmissionRoute(
  router: Router,
  dependencies: RunRouteSharedDependencies & RunRouteHelpers,
): void {
  const {
    taskAdmissionEvaluator,
    logger,
    validatePublishModeAndAuth,
    validateTemplateReadiness,
    normalizeTaskMode,
    handleIdempotency,
    submissionClient,
  } = dependencies;
  const submitRun = async (req: Request, res: Response, forceLocal: boolean) => {
    const routePath = forceLocal ? '/runs/local' : '/runs';
    const routeSubmissionClient = forceLocal ? undefined : submissionClient;
    let idempotencyKeyForError: string | undefined;
    try {
      const runRequest = parseRunSubmissionRequest(req, routeSubmissionClient, res);
      if (!runRequest) return;
      const keys = resolveRunSubmissionIdempotencyKeys(req, runRequest, forceLocal, res);
      if (!keys) return;
      const { idempotencyKey, storeIdempotencyKey } = keys;
      idempotencyKeyForError = idempotencyKey;

      const effectivePublishMode = runRequest.publishMode || 'pr';
      runRequest.publishMode = effectivePublishMode;

      // 1. Validate publish mode and authentication
      const authValidation =
        await validatePublishModeAndAuth(effectivePublishMode);
      if (!authValidation.ok) {
        return sendErrorResponse(
          res,
          400,
          'Bad Request',
          authValidation.error!,
        );
      }

      // 2. Validate template readiness. Checkout freshness remains advisory in
      // /api/v1/preflight so development checkouts cannot interrupt active runs.
      const templateValidation =
        await validateTemplateReadiness(effectivePublishMode);
      if (!templateValidation.ok) {
        return res
          .status(templateValidation.statusCode || 400)
          .json(templateValidation.response);
      }

      // 3. Normalize task mode
      normalizeTaskMode(runRequest);

      // 4. Safety admission must happen before idempotency claim and scheduler submission.
      const admission = await admitTaskWithLogging(taskAdmissionEvaluator, logger, runRequest);
      if (!admission.allowed) {
        return sendErrorResponse(res, 422, 'Task rejected by safety admission gate', admission.reason, {
          exitCode: TASK_ADMISSION_EXIT_CODE,
          admission,
        });
      }

      // 5. Handle idempotency
      const requestFingerprint = buildRequestFingerprint(
        runRequest as Record<string, unknown>,
      );

      const submissionResult = await submitRunWithIdempotencyLock(dependencies, {
        admission,
        effectivePublishMode,
        handleIdempotency,
        idempotencyKey,
        requestFingerprint,
        routeSubmissionClient,
        runRequest,
        storeIdempotencyKey,
      });
      return respondToRunSubmissionResult(submissionResult, res, logger, idempotencyKey);
    } catch (err: unknown) {
      return respondToRunSubmissionError(err, res, {
        idempotencyKey: idempotencyKeyForError,
        logger,
        routePath,
        routeSubmissionClient,
      });
    }
  };

  router.post('/runs', (req: Request, res: Response) => submitRun(req, res, false));
  router.post('/runs/local', (req: Request, res: Response) => submitRun(req, res, true));
}

function parseRunSubmissionRequest(
  req: Request,
  submissionClient: SoyuzSubmissionClient | undefined,
  res: Response,
): RunRequest | undefined {
  // Validate the raw request before Zod strips unknown fields. Soyuz's
  // contract must reject webhook secrets instead of silently dropping them.
  const requestInput = {
    ...req.body,
    startupCheck:
      req.query.dryRun === 'true' || req.query.startupCheck === 'true'
        ? true
        : req.body?.startupCheck,
  };
  if (!submissionClient) return RunRequestSchema.parse(requestInput);
  try {
    return parseSoyuzRunRequest(requestInput);
  } catch (error) {
    if (error instanceof Error && !('errors' in error)) {
      sendErrorResponse(res, 400, 'Bad Request', error.message);
      return undefined;
    }
    throw error;
  }
}

interface SubmitRunIdempotencyInput {
  admission: Awaited<ReturnType<TaskAdmissionEvaluator>>;
  effectivePublishMode: string;
  handleIdempotency: RunRouteHelpers['handleIdempotency'];
  idempotencyKey: string;
  requestFingerprint: string;
  routeSubmissionClient?: SoyuzSubmissionClient;
  runRequest: RunRequest;
  storeIdempotencyKey: string;
}

type RunSubmissionResult = RunIdempotencyResult | { state: 'submitted'; response: RunResponse };

async function submitRunWithIdempotencyLock(
  dependencies: RunRouteSharedDependencies & RunRouteHelpers,
  input: SubmitRunIdempotencyInput,
): Promise<RunSubmissionResult> {
  const { idempotencyStore, logger, scheduler } = dependencies;
  const {
    admission,
    effectivePublishMode,
    handleIdempotency,
    idempotencyKey,
    requestFingerprint,
    routeSubmissionClient,
    runRequest,
    storeIdempotencyKey,
  } = input;
  return idempotencyStore.runWithIdempotencyLock(async () => {
    const idempotencyResult = await handleIdempotency(storeIdempotencyKey, requestFingerprint);
    if (idempotencyResult.state !== 'fresh') return idempotencyResult;

    logger.event('api_run_request', {
      repoUrl: runRequest.repoUrl,
      ref: runRequest.ref,
      taskMode: runRequest.taskMode,
      publishMode: effectivePublishMode,
      startupCheck: runRequest.startupCheck,
      idempotencyKey,
    });

    try {
      const response = await createSubmittedRunResponse(
        scheduler,
        routeSubmissionClient,
        runRequest,
        admission,
        idempotencyKey,
      );
      await idempotencyStore.storeResponse(storeIdempotencyKey, response, requestFingerprint);
      return { state: 'submitted' as const, response };
    } catch (error) {
      // Keep uncertain remote intents so a retry reuses the same key.
      if (!routeSubmissionClient || (error instanceof SoyuzApiError && error.status < 500)) {
        await idempotencyStore.releasePendingClaim(storeIdempotencyKey, requestFingerprint);
      }
      throw error;
    }
  });
}

async function createSubmittedRunResponse(
  scheduler: JobScheduler,
  submissionClient: SoyuzSubmissionClient | undefined,
  runRequest: RunRequest,
  admission: Awaited<ReturnType<TaskAdmissionEvaluator>>,
  idempotencyKey: string,
): Promise<RunResponse> {
  if (submissionClient) {
    const remoteRun = await submissionClient.createRun(
      runRequest as unknown as Record<string, unknown>,
      idempotencyKey,
    );
    return buildSoyuzRunResponse(remoteRun, runRequest);
  }
  const job = admission.routingHints
    ? await scheduler.submitJob(runRequest, admission.routingHints)
    : await scheduler.submitJob(runRequest);
  job.idempotencyKey = idempotencyKey;
  return buildRunResponse(job);
}

function respondToRunSubmissionResult(
  result: RunSubmissionResult,
  res: Response,
  logger: ReturnType<typeof createEventLogger>,
  idempotencyKey: string,
): Response | void {
  if (result.state === 'fulfilled') {
    logger.event('api_idempotent_resubmission', { jobId: result.jobId, idempotencyKey });
    return res.status(200).json(result.response); // 200 OK, not 202
  }
  if (result.state === 'pending') {
    return sendErrorResponse(res, 409, 'Conflict', 'Request with this idempotency key is already being processed');
  }
  if (result.state !== 'submitted') throw new Error('Unexpected idempotency submission state');
  return res.status(202).json(result.response); // 202 Accepted
}

function respondToRunSubmissionError(
  error: unknown,
  res: Response,
  context: {
    idempotencyKey?: string;
    logger: ReturnType<typeof createEventLogger>;
    routePath: string;
    routeSubmissionClient?: SoyuzSubmissionClient;
  },
): Response | void {
  const { idempotencyKey, logger, routePath, routeSubmissionClient } = context;
  if (error instanceof RunAlreadyActiveError) {
    return sendErrorResponse(res, 409, 'Conflict', error.message, { code: error.code });
  }
  const storageError = getStorageCapacityError(error);
  if (storageError) {
    metricsRegistry.incAdmissionRejection('storage-capacity');
    logger.event('api_storage_admission_rejected', {
      path: routePath,
      code: storageError.code,
      availableBytes: storageError.availableBytes,
      minimumBytes: storageError.minimumBytes,
      cleanupAttempted: storageError.cleanupAttempted,
      cleanupFreedBytes: storageError.cleanupFreedBytes,
    });
    return sendErrorResponse(
      res,
      storageError.statusCode,
      storageError.statusCode === 507 ? 'Insufficient Storage' : 'Service Unavailable',
      storageError.message,
      storageErrorFields(storageError),
    );
  }
  if (error instanceof z.ZodError) {
    const details = formatZodValidationError(error);
    logger.event('api_validation_error', { path: routePath, details });
    return sendErrorResponse(res, 400, 'Bad Request', details);
  }
  if (error instanceof SoyuzApiError) {
    return sendErrorResponse(res, error.status < 500 ? error.status : 503, 'Soyuz Submission Failed', error.message, {
      code: error.code,
      idempotencyKey,
      retryWithSameIdempotencyKey: error.status >= 500,
    });
  }
  if (routeSubmissionClient) {
    return sendErrorResponse(res, 503, 'Soyuz Submission Uncertain', 'Soyuz may have accepted this run. Retry the same request with the same Idempotency-Key.', {
      idempotencyKey,
      retryWithSameIdempotencyKey: true,
    });
  }
  logger.event('api_error', { path: routePath, error: (error as Error).message });
  return sendErrorResponse(res, 400, 'Bad Request', (error as Error).message);
}

function resolveRunSubmissionIdempotencyKeys(
  req: Request,
  runRequest: RunRequest,
  forceLocal: boolean,
  res: Response,
): { idempotencyKey: string; storeIdempotencyKey: string } | undefined {
  const headerIdempotencyKey = req.get('Idempotency-Key');
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (headerIdempotencyKey && !uuidV4.test(headerIdempotencyKey)) {
    sendErrorResponse(res, 400, 'Bad Request', 'Idempotency-Key must be a UUID v4');
    return undefined;
  }
  if (headerIdempotencyKey && runRequest.idempotencyKey && headerIdempotencyKey !== runRequest.idempotencyKey) {
    sendErrorResponse(res, 400, 'Bad Request', 'Idempotency-Key header must match the idempotencyKey body field when both are provided');
    return undefined;
  }
  const idempotencyKey = headerIdempotencyKey || runRequest.idempotencyKey;
  if (!idempotencyKey) {
    sendErrorResponse(res, 400, 'Bad Request', 'A caller-provided Idempotency-Key header or idempotencyKey body field is required');
    return undefined;
  }
  // Local submissions use a separate namespace so they cannot replay remote requests.
  return { idempotencyKey, storeIdempotencyKey: forceLocal ? `local:${idempotencyKey}` : idempotencyKey };
}

function registerRunRetryRoute(
  router: Router,
  dependencies: RunRouteSharedDependencies & RunRouteHelpers,
): void {
  router.post('/runs/:id/retry', (req: Request<{ id: string }>, res: Response) => handleRunRetry(req, res, dependencies));
}

type RunRetryResult =
  | RunIdempotencyResult
  | { state: 'submitted'; response: RunResponse }
  | { state: 'not_retryable' }
  | { state: 'run_busy' };

async function handleRunRetry(
  req: Request<{ id: string }>,
  res: Response,
  dependencies: RunRouteSharedDependencies & RunRouteHelpers,
): Promise<Response | void> {
  const source = await findRetrySource(dependencies.scheduler, req.params.id);
  const idempotencyKey = req.body?.idempotencyKey;
  if (!isUuidV4(idempotencyKey)) {
    return sendErrorResponse(res, 400, 'Bad Request', 'A UUID idempotencyKey is required for retries');
  }
  if (shouldRetryThroughSoyuz(source, req.params.id, dependencies.submissionClient)) {
    return retrySoyuzRun(req, res, source, idempotencyKey, dependencies);
  }
  return retryLocalRun(res, source, req.params.id, idempotencyKey, dependencies);
}

async function findRetrySource(scheduler: JobScheduler, runId: string): Promise<Job | undefined> {
  return scheduler.getJob(runId) ?? (
    typeof scheduler.getJobIncludingHistory === 'function'
      ? await scheduler.getJobIncludingHistory(runId)
      : undefined
  );
}

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function shouldRetryThroughSoyuz(
  source: Job | undefined,
  requestedId: string,
  submissionClient?: SoyuzSubmissionClient,
): boolean {
  const canonicalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedId);
  return Boolean(submissionClient && (source?.soyuz || (!source && canonicalId)));
}

async function retrySoyuzRun(
  req: Request<{ id: string }>,
  res: Response,
  source: Job | undefined,
  idempotencyKey: string,
  dependencies: RunRouteSharedDependencies & RunRouteHelpers,
): Promise<Response | void> {
  const canonicalSourceId = source?.soyuz?.externalRunId ?? req.params.id;
  try {
    const fingerprint = buildRequestFingerprint({ retryOf: canonicalSourceId, idempotencyKey });
    const result = await submitSoyuzRetryUnderLock(dependencies, canonicalSourceId, idempotencyKey, fingerprint);
    if (result.state === 'pending') {
      return sendErrorResponse(res, 409, 'Conflict', 'Retry with this idempotency key is already being processed');
    }
    if (result.state === 'not_retryable') {
      return sendErrorResponse(res, 409, 'Conflict', 'Only terminal Soyuz runs can be retried');
    }
    if (result.state === 'fulfilled') return res.status(200).json(result.response);
    if (result.state !== 'submitted') throw new Error('Unexpected Soyuz retry state');
    return res.status(202).json({
      ...result.response,
      retryPolicy: 'Terminal runs only; reuse this idempotencyKey to replay safely.',
    });
  } catch (error) {
    if (error instanceof SoyuzApiError) {
      return sendErrorResponse(res, error.status < 500 ? error.status : 503, 'Soyuz Retry Failed', error.message, {
        code: error.code,
        idempotencyKey,
        retryWithSameIdempotencyKey: error.status >= 500,
      });
    }
    return sendErrorResponse(res, 503, 'Soyuz Retry Uncertain', 'Soyuz may have accepted this retry. Retry with the same idempotencyKey.', {
      idempotencyKey,
      retryWithSameIdempotencyKey: true,
    });
  }
}

async function submitSoyuzRetryUnderLock(
  dependencies: RunRouteSharedDependencies & RunRouteHelpers,
  canonicalSourceId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<RunRetryResult> {
  const { idempotencyStore, handleIdempotency, submissionClient } = dependencies;
  return idempotencyStore.runWithIdempotencyLock(async () => {
    const existing = await handleIdempotency(idempotencyKey, fingerprint);
    if (existing.state !== 'fresh') return existing;
    let remoteSource: Awaited<ReturnType<SoyuzSubmissionClient['getWorkerRun']>>;
    try {
      remoteSource = await submissionClient!.getWorkerRun(canonicalSourceId);
    } catch (error) {
      // The source-state read is non-mutating, so no uncertain retry exists yet.
      await idempotencyStore.releasePendingClaim(idempotencyKey, fingerprint);
      throw error;
    }
    if (!isTerminalRetryStatus(remoteSource.status)) {
      await idempotencyStore.releasePendingClaim(idempotencyKey, fingerprint);
      return { state: 'not_retryable' as const };
    }
    try {
      const remoteRun = await submissionClient!.retryRun(canonicalSourceId, idempotencyKey);
      const response = buildSoyuzRunResponse(remoteRun, undefined, canonicalSourceId);
      await idempotencyStore.storeResponse(idempotencyKey, response, fingerprint);
      return { state: 'submitted' as const, response };
    } catch (error) {
      if (error instanceof SoyuzApiError && error.status < 500) {
        await idempotencyStore.releasePendingClaim(idempotencyKey, fingerprint);
      }
      throw error;
    }
  });
}

function isTerminalRetryStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'admission_failed'].includes(status);
}

async function retryLocalRun(
  res: Response,
  source: Job | undefined,
  requestedId: string,
  idempotencyKey: string,
  dependencies: RunRouteSharedDependencies & RunRouteHelpers,
): Promise<Response | void> {
  if (!source) return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${requestedId}`);
  if (!isTerminalRetryStatus(source.status)) {
    return sendErrorResponse(res, 409, 'Conflict', 'Only terminal runs can be retried');
  }
  const retryRequest: RunRequest = { ...source.request, idempotencyKey };
  const publishMode = retryRequest.publishMode || 'pr';
  retryRequest.publishMode = publishMode;
  const authValidation = await dependencies.validatePublishModeAndAuth(publishMode);
  if (!authValidation.ok) return sendErrorResponse(res, 400, 'Bad Request', authValidation.error!);
  const templateValidation = await dependencies.validateTemplateReadiness(publishMode);
  if (!templateValidation.ok) {
    return res.status(templateValidation.statusCode || 400).json(templateValidation.response);
  }
  dependencies.normalizeTaskMode(retryRequest);
  const admission = await admitTaskWithLogging(dependencies.taskAdmissionEvaluator, dependencies.logger, retryRequest);
  if (!admission.allowed) {
    return sendErrorResponse(res, 422, 'Task rejected by safety admission gate', admission.reason, {
      exitCode: TASK_ADMISSION_EXIT_CODE,
      admission,
    });
  }
  const fingerprint = buildRequestFingerprint({ retryOf: source.id, ...retryRequest } as Record<string, unknown>);
  const result = await submitLocalRetryUnderLock(dependencies, retryRequest, idempotencyKey, fingerprint, admission);
  if (result.state === 'run_busy') {
    return sendErrorResponse(res, 409, 'Conflict', 'This Kaseki agent already has an active run', { code: 'RUN_ALREADY_ACTIVE' });
  }
  if (result.state === 'pending') {
    return sendErrorResponse(res, 409, 'Conflict', 'Retry with this idempotency key is already being processed');
  }
  if (result.state === 'fulfilled') {
    return res.status(200).json({
      ...result.response,
      retryOf: source.id,
      retryPolicy: 'Terminal runs only; submit the same idempotencyKey to replay this retry safely.',
    });
  }
  if (result.state !== 'submitted') throw new Error('Unexpected local retry state');
  return res.status(202).json({
    ...result.response,
    retryOf: source.id,
    retryPolicy: 'Terminal runs only; submit the same idempotencyKey to replay this retry safely.',
  });
}

async function submitLocalRetryUnderLock(
  dependencies: RunRouteSharedDependencies & RunRouteHelpers,
  retryRequest: RunRequest,
  idempotencyKey: string,
  fingerprint: string,
  admission: Awaited<ReturnType<TaskAdmissionEvaluator>>,
): Promise<RunRetryResult> {
  const { idempotencyStore, handleIdempotency, scheduler } = dependencies;
  return idempotencyStore.runWithIdempotencyLock(async () => {
    const existing = await handleIdempotency(idempotencyKey, fingerprint);
    if (existing.state !== 'fresh') return existing;
    try {
      const job = admission.routingHints
        ? await scheduler.submitJob(retryRequest, admission.routingHints)
        : await scheduler.submitJob(retryRequest);
      job.idempotencyKey = idempotencyKey;
      const response = buildRunResponse(job);
      await idempotencyStore.storeResponse(idempotencyKey, response, fingerprint);
      return { state: 'submitted' as const, response };
    } catch (error) {
      await idempotencyStore.releasePendingClaim(idempotencyKey, fingerprint);
      if (error instanceof RunAlreadyActiveError) return { state: 'run_busy' as const };
      throw error;
    }
  });
}

function registerValidationRoute(
  router: Router,
  preFlightValidator: PreFlightValidator,
  taskAdmissionEvaluator: TaskAdmissionEvaluator,
  logger: ReturnType<typeof createEventLogger>,
): void {
  /**
   * POST /api/v1/validate - Pre-flight validation of job request (dry-run).
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

      const admission = await admitTaskWithLogging(taskAdmissionEvaluator, logger, runRequest);
      const response: ValidationResponse = { ...validationResult, admission };

      res.json(response);
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        // Zod validation error
        const details = formatZodValidationError(err);
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
}

// Re-export classifyDockerFailure for public API
export { classifyDockerFailure };
