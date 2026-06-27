import { Router, Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { randomUUID } from 'node:crypto';
import { JobScheduler } from './job-scheduler';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
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
import { createHealthRoutes } from './routes/health-routes';
import { createImprovementRoutes } from './routes/improvement-routes';
import { createGitHubIssuesRoutes } from './routes/github-issues-routes';
import { ResultCache } from './result-cache';
import { metricsRegistry } from './metrics';
import { getCachedStartupHealthReport } from './kaseki-api/startup-summary-artifact';
import { healthReportToMarkdown } from './kaseki-api/startup-health-reporter';
import { testGatewayConnectivity_Stage1, testGatewayResponseSmoke_Stage2, resolveGatewayApiKey, shouldRunGatewayResponseSmoke, testPiGatewayProviderSmoke } from './kaseki-api-gateway-test';
import {
  checkGitHubAppCredentials,
  resolveCheckoutFreshness,
  getSubmissionTemplateHealthStatus,
  checkTemplatePublishModeCompatibility,
  TEMPLATE_REMEDIATION,
  shouldBlockForFreshness,
  isTemplateDoctorTimeout,
} from './kaseki-api-health-checks';
import { buildPreflightResponse as buildPreflightResponseImpl } from './kaseki-api-routes-preflight';

/**
 * BACKWARD COMPATIBILITY RE-EXPORTS
 *
 * The following are re-exported for backward compatibility with existing tests
 * and consumers that import from this module. New code should import directly
 * from the source modules instead.
 */

/**
 * @deprecated Use `import { decodeUtf8TailSafely } from './utils/utf8-helpers'` instead
 * Re-exported from utf8-helpers for backward compatibility
 */
export { decodeUtf8TailSafely, tailLogByLines } from './utils/utf8-helpers';

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

/**
 * @deprecated Use `import { checkDeletedBindMounts } from './kaseki-api-health-checks'` instead
 * Re-exported for backward compatibility with tests and callers
 */
export {
  checkDeletedBindMounts,
  checkWritableDirectory,
  checkLLMGatewayKey,
  checkGatewayTestSecretConsistency,
  checkWorkerGatewayConfig,
  checkGitHubAppCredentials,
  checkWorkerSmokeTest,
  buildTemplateHealthStatus,
  resolveCheckoutFreshness,
  checkTemplateActivatorParity,
  getSubmissionTemplateHealthStatus,
  checkTemplatePublishModeCompatibility,
  TEMPLATE_REMEDIATION,
  shouldBlockForFreshness,
  isTemplateDoctorTimeout,
} from './kaseki-api-health-checks';

/**
 * @deprecated Use `import { classifyDockerFailure } from './lib/subprocess-helpers'` instead
 * Re-exported for backward compatibility with tests
 */
export { classifyDockerFailure } from './lib/subprocess-helpers';

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
    // Skip auth for health check endpoints only
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

    next();
  });

  /**
   * Mount health-check routes (/health, /ready, /metrics)
   */
  router.use(createHealthRoutes(scheduler, config, artifactCache));

  /**
   * GET /api/preflight - Controller-oriented readiness diagnostics.
   */
  router.get('/preflight', (_req: Request, res: Response) => {
    const response = buildPreflightResponse(config);

    // Include cached container startup diagnostics as boot history only.
    // These observations are not rerun for this request and are excluded from
    // the top-level current readiness status/checks.
    const containerPreflightResults = getContainerPreflightResults();
    if (containerPreflightResults) {
      response.containerStartup = {
        scope: 'startup',
        readinessImpact: 'excluded-from-current-readiness',
        current: false,
        recommendedCurrentEndpoint: '/api/preflight',
        timestamp: containerPreflightResults.timestamp,
        cachedAt: containerPreflightResults.timestamp,
        checks: containerPreflightResults.checks,
      };
    }

    res.status(response.status === 'error' ? 503 : 200).json(response);
  });

  /**
   * GET /api/gateway-test - Orchestrated full test (Stage 1 + Stage 2)
   * Runs both connectivity and response validation tests
   * Stage 2 runs by default in production, skipped in dev/test (no token consumption in dev)
   * Query params:
   *   ?stage=1          - Run Stage 1 only (connectivity check)
   *   ?stage=2          - Run Stage 2 only (inference test)
   *   ?responseSmoke=true/false - Override stage 2 decision
   */
  router.get('/gateway-test', async (_req: Request, res: Response) => {
    try {
      const stageParam = typeof _req.query.stage === 'string'
        ? _req.query.stage.trim().toLowerCase()
        : '';
      const requestedStage = stageParam === '1' ? 1 : stageParam === '2' ? 2 : 0; // 0 = both

      const smokeParam = typeof _req.query.responseSmoke === 'string'
        ? _req.query.responseSmoke.trim().toLowerCase()
        : '';
      const responseSmoke = ['1', 'true', 'on', 'yes'].includes(smokeParam)
        ? true
        : ['0', 'false', 'off', 'no'].includes(smokeParam)
          ? false
          : undefined;
      const options = typeof responseSmoke === 'boolean' ? { responseSmoke } : undefined;
      const piProviderParam = typeof _req.query.piProvider === 'string'
        ? _req.query.piProvider.trim().toLowerCase()
        : '';
      const piProviderRequested = ['1', 'true', 'on', 'yes'].includes(piProviderParam);

      let stage1Result: any = null;
      let stage2Result: any = null;
      let piProviderResult: any = null;

      // Run Stage 1 if requested (or if running both)
      if (requestedStage === 0 || requestedStage === 1) {
        stage1Result = await testGatewayConnectivity_Stage1();
      }

      // Run Stage 2 if requested (or if running both and Stage 1 passed)
      if (requestedStage === 2 || (requestedStage === 0 && stage1Result && stage1Result.status === 'ok')) {
        // Determine if we should run stage 2
        const runStage2 = shouldRunGatewayResponseSmoke(options);

        if (runStage2 || requestedStage === 2) {
          // Run stage 2
          const gatewayUrl = process.env.LLM_GATEWAY_URL || '';
          const apiKey = resolveGatewayApiKey().value || '';
          const timestamp = new Date().toISOString();
          const startTime = performance.now();
          stage2Result = await testGatewayResponseSmoke_Stage2(gatewayUrl, apiKey, timestamp, startTime);
        }
      }

      if ((requestedStage === 0 || requestedStage === 2) && piProviderRequested) {
        piProviderResult = testPiGatewayProviderSmoke(true);
      } else if (requestedStage === 2) {
        piProviderResult = testPiGatewayProviderSmoke(false);
      }

      // Build response - handle both single-stage and dual-stage responses
      if (requestedStage === 1) {
        // Stage 1 only response
        const result = {
          ...stage1Result,
          responseSmokeValidated: false, // Stage 2 was not run
        };
        const httpStatus = stage1Result.status === 'ok' ? 200 : 503;
        res.status(httpStatus).json(result);
      } else if (requestedStage === 2) {
        // Stage 2 only response
        const result: any = {
          status: stage2Result?.status === 'ok' ? 'ok' : 'error',
          detail: stage2Result?.detail || 'LLM inference test failed',
          responseTime: stage2Result?.responseTime || 0,
          timestamp: new Date().toISOString(),
          responseSmokeValidated: stage2Result?.status === 'ok',
        };

        if (stage2Result?.responseId) {
          result.responseId = stage2Result.responseId;
        }
        if (stage2Result?.outputTokens) {
          result.outputTokens = stage2Result.outputTokens;
        }
        if (stage2Result?.modelUsed) {
          result.modelUsed = stage2Result.modelUsed;
        }
        if (typeof stage2Result?.streamSmokeValidated === 'boolean') {
          result.streamSmokeValidated = stage2Result.streamSmokeValidated;
        }
        if (typeof stage2Result?.largePromptSmokeValidated === 'boolean') {
          result.largePromptSmokeValidated = stage2Result.largePromptSmokeValidated;
        }
        if (stage2Result?.checks) {
          result.checks = stage2Result.checks;
        }
        if (piProviderResult) {
          result.piProviderSmoke = piProviderResult;
        }

        const httpStatus = stage2Result?.status === 'ok' && (!piProviderResult || piProviderResult.status !== 'error') ? 200 : 503;
        res.status(httpStatus).json(result);
      } else {
        // Both stages response (backward compatible format)
        const result: any = {
          status: stage1Result.status,
          detail: stage1Result.detail,
          responseTime: stage1Result.responseTime,
          timestamp: new Date().toISOString(),
          authenticationValidated: stage1Result.authenticationValidated,
          responseSmokeValidated: stage2Result?.status === 'ok',
        };

        if (stage2Result) {
          result.responseId = stage2Result.responseId;
          result.outputTokens = stage2Result.outputTokens;
          result.modelUsed = stage2Result.modelUsed;
          result.streamSmokeValidated = stage2Result.streamSmokeValidated;
          result.largePromptSmokeValidated = stage2Result.largePromptSmokeValidated;
          result.checks = stage2Result.checks;
        }
        if (piProviderResult) {
          result.piProviderSmoke = piProviderResult;
        }

        const httpStatus = (
          stage1Result.status === 'ok' &&
          (!stage2Result || stage2Result.status === 'ok') &&
          (!piProviderResult || piProviderResult.status !== 'error')
        ) ? 200 : 503;
        res.status(httpStatus).json(result);
      }
    } catch (error) {
      logger.error('Gateway test error', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        status: 'error',
        detail: 'Unexpected error during gateway test',
        responseTime: 0,
        timestamp: new Date().toISOString(),
        authenticationValidated: false,
      });
    }
  });

  /**
   * GET /api/gateway-test/stage1 - Stage 1 only: Lightweight LLM gateway connectivity test
   * Tests reachability and authentication via /models endpoint
   * Does NOT consume inference tokens - fast (<2s), runs by default
   */
  router.get('/gateway-test/stage1', async (_req: Request, res: Response) => {
    try {
      const result = await testGatewayConnectivity_Stage1();
      const status = result.status === 'ok' ? 200 : 503;
      res.status(status).json(result);
    } catch (error) {
      logger.error('Gateway test (stage 1) error', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        status: 'error',
        detail: 'Unexpected error during gateway connectivity test',
        gatewayUrl: '',
        responseTime: 0,
        timestamp: new Date().toISOString(),
        authenticationValidated: false,
      });
    }
  });

  /**
   * GET /api/startup-health — Unified startup health report (Phase 4)
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

        res.status(404).json({
          error: 'startup-health-not-available',
          detail: 'Startup health report not yet generated. Check back after service initialization.',
        });
        return;
      }

      if (wantsMarkdown) {
        const markdown = healthReportToMarkdown(report);
        res.type('text/markdown').status(200).send(markdown);
        return;
      }

      res.status(200).json({
        scope: 'startup',
        current: false,
        recommendedCurrentEndpoint: '/api/preflight',
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

      res.status(500).json({
        error: 'health-report-error',
        detail: 'Failed to retrieve startup health report',
      });
    }
  });

  /**
   * Extract: Validate publish mode has proper authentication.
   */
  async function validatePublishModeAndAuth(
    publishMode: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (
      (publishMode === 'branch' ||
        publishMode === 'pr' ||
        publishMode === 'draft_pr') &&
      !isGitHubAppReady()
    ) {
      return {
        ok: false,
        error: `publishMode=${publishMode} requires readable GitHub App credentials. Check /api/preflight before submitting publishable runs.`,
      };
    }
    return { ok: true };
  }

  /**
   * Extract: Validate checkout freshness for publishable runs.
   */
  async function validateCheckoutFreshness(
    publishMode: string,
  ): Promise<{ ok: boolean; response?: Record<string, unknown> }> {
    const templateDir =
      process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template';
    const checkoutDir =
      process.env.KASEKI_CHECKOUT_DIR || '/agents/kaseki-agent';
    const freshness = resolveCheckoutFreshness(
      checkoutDir,
      process.env.KASEKI_REF || 'main',
      templateDir,
    );

    if (shouldBlockForFreshness(publishMode) && freshness.stale) {
      return {
        ok: false,
        response: {
          type: 'https://api.kaseki.local/errors#checkout-stale',
          title: 'Conflict',
          status: 409,
          detail: freshness.detail,
          checkoutDir: freshness.checkoutDir,
          localRef: freshness.localRef,
          remoteRef: freshness.remoteRef,
          remoteUrl: freshness.remoteUrl,
          remediation: freshness.remediation || TEMPLATE_REMEDIATION,
        },
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
  ): Promise<
    | { state: 'fresh' }
    | { state: 'fulfilled'; response: RunResponse; jobId: string }
    | { state: 'pending' }
  > {
    const claimResult = await idempotencyStore.claimOrGet(
      idempotencyKey,
      requestFingerprint,
    );

    if (claimResult.kind === 'fulfilled') {
      const currentJob = scheduler.getJob(claimResult.response.id);
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

      // 2. Validate checkout freshness
      const freshnessValidation =
        await validateCheckoutFreshness(effectivePublishMode);
      if (!freshnessValidation.ok) {
        return res.status(409).json(freshnessValidation.response);
      }

      // 3. Validate template readiness
      const templateValidation =
        await validateTemplateReadiness(effectivePublishMode);
      if (!templateValidation.ok) {
        return res
          .status(templateValidation.statusCode || 400)
          .json(templateValidation.response);
      }

      // 4. Normalize task mode
      normalizeTaskMode(runRequest);

      // 5. Handle idempotency
      const idempotencyKey = runRequest.idempotencyKey || randomUUID();
      const requestFingerprint = buildRequestFingerprint(
        runRequest as Record<string, unknown>,
      );

      const idempotencyResult = await handleIdempotency(
        idempotencyKey,
        requestFingerprint,
      );
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
      const job = await scheduler.submitJob(runRequest);

      // Store idempotency key on job
      job.idempotencyKey = idempotencyKey;

      const response = buildRunResponse(job);

      // Store in idempotency cache
      await idempotencyStore.storeResponse(
        idempotencyKey,
        response,
        requestFingerprint,
      );

      res.status(202).json(response); // 202 Accepted
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

  /**
   * POST /api/webhooks/test - Test webhook configuration.
   */
  router.post('/webhooks/test', async (req: Request, res: Response) => {
    try {
      const { url, secret } = req.body;

      if (!url || typeof url !== 'string') {
        return sendErrorResponse(
          res,
          400,
          'Bad Request',
          'Webhook URL is required',
        );
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return sendErrorResponse(
          res,
          400,
          'Bad Request',
          'Invalid webhook URL format',
        );
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
          signature = crypto
            .createHmac('sha256', secret)
            .update(body)
            .digest('hex');
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

  // Register domain-focused route modules
  router.use(createStatusRoutes(scheduler, config, artifactCache));
  router.use(createLogRoutes(scheduler, config));
  router.use(createArtifactRoutes(scheduler, config, artifactCache));
  router.use(createImprovementRoutes(scheduler, config));
  router.use(createWebhookRoutes());
  router.use(createGitHubIssuesRoutes());

  return router;
}
