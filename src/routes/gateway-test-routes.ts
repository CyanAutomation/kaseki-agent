/**
 * Gateway connectivity test routes
 *
 * Provides comprehensive LLM gateway diagnostics:
 * - GET /api/gateway-test - Full test (Stage 1 + Stage 2)
 * - GET /api/gateway-test/stage1 - Connectivity only (lightweight)
 *
 * Stage 1: Authentication and connectivity check (no token consumption)
 * Stage 2: LLM inference test (with token consumption in production)
 */

import { Router, Request, Response } from 'express';
import { createEventLogger } from '../logger';
import {
  testGatewayConnectivity_Stage1,
  testGatewayResponseSmoke_Stage2,
  resolveGatewayApiKey,
  shouldRunGatewayResponseSmoke,
  testPiGatewayProviderSmoke,
} from '../kaseki-api-gateway-test';

const logger = createEventLogger('gateway-test-routes');

/**
 * Parse query parameter as boolean
 * Handles: '1', 'true', 'on', 'yes' → true; '0', 'false', 'off', 'no' → false; undefined → undefined
 */
function parseQueryBoolean(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined;

  const lower = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(lower)) return true;
  if (['0', 'false', 'off', 'no'].includes(lower)) return false;
  return undefined;
}

/**
 * Parse query parameter as stage number (1, 2, or 0 for both)
 */
function parseQueryStage(value: unknown): 0 | 1 | 2 {
  if (typeof value !== 'string') return 0;

  const lower = value.trim().toLowerCase();
  if (lower === '1') return 1;
  if (lower === '2') return 2;
  return 0; // both stages
}

/**
 * Build dual-stage response (Stage 1 + Stage 2)
 */
function buildDualStageResponse(
  stage1Result: any,
  stage2Result: any,
  piProviderResult: any
): any {
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

  return result;
}

/**
 * Build Stage 2-only response
 */
function buildStage2Response(stage2Result: any, piProviderResult: any): any {
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

  return result;
}

/**
 * Determine HTTP status for response
 */
function getResponseStatus(
  stage1Result: any,
  stage2Result: any,
  piProviderResult: any
): number {
  return (
    stage1Result.status === 'ok' &&
    (!stage2Result || stage2Result.status === 'ok') &&
    (!piProviderResult || piProviderResult.status !== 'error')
  ) ? 200 : 503;
}

/**
 * Create gateway test routes
 */
export function createGatewayTestRoutes(): Router {
  const router = Router();

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
      const requestedStage = parseQueryStage(_req.query.stage);
      const responseSmoke = parseQueryBoolean(_req.query.responseSmoke);
      const piProviderRequested = parseQueryBoolean(_req.query.piProvider) ?? false;
      const debugMode = parseQueryBoolean(_req.query.debug) ?? false;

      const options = typeof responseSmoke === 'boolean' ? { responseSmoke } : undefined;

      let stage1Result: any = null;
      let stage2Result: any = null;
      let piProviderResult: any = null;

      // Run Stage 1 if requested (or if running both)
      if (requestedStage === 0 || requestedStage === 1) {
        stage1Result = await testGatewayConnectivity_Stage1();
      }

      // Run Stage 2 if requested (or if running both and Stage 1 passed)
      if (requestedStage === 2 || (requestedStage === 0 && stage1Result && stage1Result.status === 'ok')) {
        const runStage2 = shouldRunGatewayResponseSmoke(options);

        if (runStage2 || requestedStage === 2) {
          const gatewayUrl = process.env.LLM_GATEWAY_URL || '';
          const apiKeyResult = resolveGatewayApiKey();
          const apiKey = apiKeyResult?.value || '';
          const timestamp = new Date().toISOString();
          const startTime = performance.now();
          stage2Result = await testGatewayResponseSmoke_Stage2(gatewayUrl, apiKey, timestamp, startTime);
        }
      }

      // Run PI provider test only when explicitly requested. The UI's Stage 2 LLM
      // probe validates the Responses API and should not be made fatal by the
      // heavier Pi provider adapter smoke unless the caller opts in with
      // ?piProvider=true.
      if ((requestedStage === 0 || requestedStage === 2) && piProviderRequested) {
        piProviderResult = testPiGatewayProviderSmoke({ requested: true, debug: debugMode });
      }

      // Build response based on requested stage
      let response: any;
      let status: number;

      if (requestedStage === 1) {
        // Stage 1 only
        response = {
          ...stage1Result,
          responseSmokeValidated: false,
        };
        status = stage1Result.status === 'ok' ? 200 : 503;
      } else if (requestedStage === 2) {
        // Stage 2 only
        response = buildStage2Response(stage2Result, piProviderResult);
        status = stage2Result?.status === 'ok' && (!piProviderResult || piProviderResult.status !== 'error') ? 200 : 503;
      } else {
        // Both stages (default, backward compatible)
        response = buildDualStageResponse(stage1Result, stage2Result, piProviderResult);
        status = getResponseStatus(stage1Result, stage2Result, piProviderResult);
      }

      res.status(status).json(response);
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

  return router;
}
