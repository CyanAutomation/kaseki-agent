import { Router, Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { JobScheduler } from './job-scheduler';
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
import { createHealthRoutes } from './routes/health-routes';
import { createImprovementRoutes } from './routes/improvement-routes';
import { createGitHubIssuesRoutes } from './routes/github-issues-routes';
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
    id: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    correlationId: job.correlationId,
    requestId: job.requestId,
    projectName: job.request?.projectName,
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
  taskAdmissionEvaluator: TaskAdmissionEvaluator = evaluateTaskAdmission,
): Router {
  const router = Router();
  const logger = createEventLogger('api');
  const apiAccess = new ApiAccessController({
    apiKeys: config.apiKeys,
    apiKeyScopes: config.apiKeyScopes,
    requestsPerMinute: config.apiRequestsPerMinute,
    diagnosticsPerHour: config.apiDiagnosticsPerHour,
    webhookTestsPerHour: config.apiWebhookTestsPerHour,
    githubIssuesPerMinute: config.apiGitHubIssuesPerMinute,
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
  registerRunRoutes(router, scheduler, idempotencyStore, taskAdmissionEvaluator, logger);
  registerValidationRoute(router, preFlightValidator, taskAdmissionEvaluator, logger);

  // Register domain-focused route modules
  router.use(createStatusRoutes(scheduler, config, artifactCache));
  router.use(createLogRoutes(scheduler, config, artifactCache));
  router.use(createArtifactRoutes(scheduler, config, artifactCache));
  router.use(createScorecardRoutes(scheduler, artifactCache));
  router.use(createImprovementRoutes(scheduler, config));
  router.use(createWebhookRoutes());
  router.use(createWebhookDeliveryRoutes(scheduler));
  router.use(createGitHubIssuesRoutes());

  router.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    logger.error('Unhandled API route error', { path: req.path, error: error instanceof Error ? error.message : String(error) });
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
      const scope = apiAccess.requiredScope(req.method, req.path, req.query);
      if (!apiAccess.hasScope(apiKey, scope)) {
        return sendErrorResponse(res, 403, 'Forbidden', `API key is missing the ${scope} scope`);
      }
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
      githubIssuesPerMinute: config.apiGitHubIssuesPerMinute ?? 30,
    } });
  });

  router.get('/capabilities', (_req: Request, res: Response) => {
    res.json({
      apiVersion: getPackageVersion(),
      taskModes: ['patch', 'inspect'],
      publishModes: ['auto', 'none', 'branch', 'pr'],
      limits: {
        maxConcurrentRuns: config.maxConcurrentRuns,
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
    scheduler,
    idempotencyStore,
    taskAdmissionEvaluator,
    logger,
    validatePublishModeAndAuth,
    validateTemplateReadiness,
    normalizeTaskMode,
    handleIdempotency,
  } = dependencies;
  /**
   * POST /api/v1/runs - Trigger a new kaseki run.
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

      const headerIdempotencyKey = req.get('Idempotency-Key');
      if (headerIdempotencyKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(headerIdempotencyKey)) {
        return sendErrorResponse(res, 400, 'Bad Request', 'Idempotency-Key must be a UUID v4');
      }
      if (headerIdempotencyKey && runRequest.idempotencyKey && headerIdempotencyKey !== runRequest.idempotencyKey) {
        return sendErrorResponse(res, 400, 'Bad Request', 'Idempotency-Key header must match the idempotencyKey body field when both are provided');
      }
      const idempotencyKey = headerIdempotencyKey || runRequest.idempotencyKey;
      if (!idempotencyKey) {
        return sendErrorResponse(res, 400, 'Bad Request', 'A caller-provided Idempotency-Key header or idempotencyKey body field is required');
      }

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

      const submissionResult = await idempotencyStore.runWithIdempotencyLock(
        async () => {
          const idempotencyResult = await handleIdempotency(
            idempotencyKey,
            requestFingerprint,
          );
          if (idempotencyResult.state !== 'fresh') {
            return idempotencyResult;
          }

          logger.event('api_run_request', {
            repoUrl: runRequest.repoUrl,
            ref: runRequest.ref,
            taskMode: runRequest.taskMode,
            publishMode: effectivePublishMode,
            startupCheck: runRequest.startupCheck,
            idempotencyKey,
          });

          try {
            const job = admission.routingHints
              ? await scheduler.submitJob(runRequest, admission.routingHints)
              : await scheduler.submitJob(runRequest);
            job.idempotencyKey = idempotencyKey;
            const response = buildRunResponse(job);
            await idempotencyStore.storeResponse(
              idempotencyKey,
              response,
              requestFingerprint,
            );
            return { state: 'submitted' as const, response };
          } catch (error) {
            await idempotencyStore.releasePendingClaim(
              idempotencyKey,
              requestFingerprint,
            );
            throw error;
          }
        },
      );

      const idempotencyResult = submissionResult;
      if (idempotencyResult.state === 'fulfilled') {
        logger.event('api_idempotent_resubmission', {
          jobId: idempotencyResult.jobId,
          idempotencyKey,
        });
        return res.status(200).json(idempotencyResult.response); // 200 OK, not 202
      }
      if (idempotencyResult.state === 'pending') {
        return sendErrorResponse(
          res,
          409,
          'Conflict',
          'Request with this idempotency key is already being processed',
        );
      }

      if (submissionResult.state !== 'submitted') {
        throw new Error('Unexpected idempotency submission state');
      }
      res.status(202).json(submissionResult.response); // 202 Accepted
    } catch (err: unknown) {
      if (err instanceof Error && 'errors' in err) {
        // Zod validation error
        const details = (err as any).errors
          .map((e: any) => `${(e.path as string[]).join('.')}: ${e.message}`)
          .join('; ');
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
}

function registerRunRetryRoute(
  router: Router,
  dependencies: RunRouteSharedDependencies & RunRouteHelpers,
): void {
  const {
    scheduler,
    idempotencyStore,
    taskAdmissionEvaluator,
    logger,
    validatePublishModeAndAuth,
    validateTemplateReadiness,
    normalizeTaskMode,
    handleIdempotency,
  } = dependencies;
  /**
   * Retry only a terminal run. The caller must supply a fresh UUID key; a
   * replay of that key returns the same newly-created run without enqueueing twice.
   */
  router.post('/runs/:id/retry', async (req: Request, res: Response) => {
    const source = scheduler.getJob(req.params.id) ?? await scheduler.getJobIncludingHistory(req.params.id);
    if (!source) {
      return sendErrorResponse(res, 404, 'Not Found', `Run not found: ${req.params.id}`);
    }
    if (source.status !== 'completed' && source.status !== 'failed') {
      return sendErrorResponse(res, 409, 'Conflict', 'Only completed or failed runs can be retried');
    }
    const idempotencyKey = req.body?.idempotencyKey;
    if (
      typeof idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
    ) {
      return sendErrorResponse(res, 400, 'Bad Request', 'A UUID idempotencyKey is required for retries');
    }
    const retryRequest: RunRequest = { ...source.request, idempotencyKey };
    const publishMode = retryRequest.publishMode || 'pr';
    retryRequest.publishMode = publishMode;
    const authValidation = await validatePublishModeAndAuth(publishMode);
    if (!authValidation.ok) {
      return sendErrorResponse(res, 400, 'Bad Request', authValidation.error!);
    }
    const templateValidation = await validateTemplateReadiness(publishMode);
    if (!templateValidation.ok) {
      return res.status(templateValidation.statusCode || 400).json(templateValidation.response);
    }
    normalizeTaskMode(retryRequest);
    const admission = await admitTaskWithLogging(taskAdmissionEvaluator, logger, retryRequest);
    if (!admission.allowed) {
      return sendErrorResponse(res, 422, 'Task rejected by safety admission gate', admission.reason, {
        exitCode: TASK_ADMISSION_EXIT_CODE,
        admission,
      });
    }
    const fingerprint = buildRequestFingerprint({ retryOf: source.id, ...retryRequest } as Record<string, unknown>);
    const result = await idempotencyStore.runWithIdempotencyLock(async () => {
      const existing = await handleIdempotency(idempotencyKey, fingerprint);
      if (existing.state !== 'fresh') return existing;
      const job = admission.routingHints
        ? await scheduler.submitJob(retryRequest, admission.routingHints)
        : await scheduler.submitJob(retryRequest);
      job.idempotencyKey = idempotencyKey;
      const response = buildRunResponse(job);
      await idempotencyStore.storeResponse(idempotencyKey, response, fingerprint);
      return { state: 'submitted' as const, response };
    });
    if (result.state === 'pending') {
      return sendErrorResponse(res, 409, 'Conflict', 'Retry with this idempotency key is already being processed');
    }
    return res.status(result.state === 'fulfilled' ? 200 : 202).json({
      ...result.response,
      retryOf: source.id,
      retryPolicy: 'Terminal runs only; submit the same idempotencyKey to replay this retry safely.',
    });
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
      if (err instanceof Error && 'errors' in err) {
        // Zod validation error
        const details = (err as any).errors
          .map((e: any) => `${(e.path as string[]).join('.')}: ${e.message}`)
          .join('; ');
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
