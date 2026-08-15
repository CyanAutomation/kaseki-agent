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
} from '../kaseki-api-gateway-smoke';

const logger = createEventLogger('gateway-test-routes');

type GatewayRequestedStage = 0 | 1 | 2;

type GatewayTestRequest = {
  requestedStage: GatewayRequestedStage;
  responseSmoke?: boolean;
  piProviderRequested: boolean;
  debugMode: boolean;
};

type GatewayStageResults = {
  stage1Result: any;
  stage2Result: any;
  piProviderResult: any;
};

type GatewayHttpResponse = {
  status: number;
  body: any;
};

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

function parseGatewayTestRequest(req: Request): GatewayTestRequest {
  return {
    requestedStage: parseQueryStage(req.query.stage),
    responseSmoke: parseQueryBoolean(req.query.responseSmoke),
    piProviderRequested: parseQueryBoolean(req.query.piProvider) ?? false,
    debugMode: parseQueryBoolean(req.query.debug) ?? false,
  };
}

/**
 * Build dual-stage response (Stage 1 + Stage 2)
 */
function buildDualStageResponse(
  stage1Result: any,
  stage2Result: any,
  piProviderResult: any
): any {
  const piAdapterFailed = piProviderResult?.status === 'error';
  const partialSuccess = stage2Result?.status === 'error' && piProviderResult?.status === 'ok';
  const result: any = {
    status: stage1Result.status === 'ok' && !piAdapterFailed ? (partialSuccess ? 'partial' : 'ok') : 'error',
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
    result.gatewayInferenceValidated = stage2Result?.status === 'ok';
    result.piAdapterValidated = piProviderResult.status === 'ok';
    result.partialSuccess = partialSuccess || (stage2Result?.status === 'ok' && piProviderResult.status === 'error');
    result.codingShapeValidated = piProviderResult.codingShapeValidated === true;
    result.multiTurnValidated = piProviderResult.multiTurnValidated === true;
  }

  return result;
}

/**
 * Build Stage 2-only response
 */
function buildStage2Response(stage2Result: any, piProviderResult: any): any {
  const piAdapterFailed = piProviderResult?.status === 'error';
  const partialSuccess = stage2Result?.status === 'error' && piProviderResult?.status === 'ok';
  const result: any = {
    status: stage2Result?.status === 'ok' && !piAdapterFailed ? 'ok' : partialSuccess ? 'partial' : 'error',
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
    result.gatewayInferenceValidated = stage2Result?.status === 'ok';
    result.piAdapterValidated = piProviderResult.status === 'ok';
    result.partialSuccess = partialSuccess || (stage2Result?.status === 'ok' && piProviderResult.status === 'error');
    result.codingShapeValidated = piProviderResult.codingShapeValidated === true;
    result.multiTurnValidated = piProviderResult.multiTurnValidated === true;
  }
  const gatewayInferenceMs = Number(stage2Result?.responseTime) || 0;
  const piAdapterMs = Number(piProviderResult?.responseTime) || 0;
  result.modelTest = {
    gatewayInferenceMs,
    piAdapterMs: piProviderResult ? piAdapterMs : null,
    endToEndMs: gatewayInferenceMs + (piProviderResult ? piAdapterMs : 0),
    tokens: {
      output: typeof stage2Result?.outputTokens === 'number' ? stage2Result.outputTokens : null,
      estimatedCostUsd: null,
      availability: typeof stage2Result?.outputTokens === 'number' ? 'gateway-reported' : 'unavailable',
    },
  };

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
  const piProvesCodingPath = piProviderResult?.status === 'ok' && stage2Result?.status === 'error';
  return (
    stage1Result.status === 'ok' &&
    (!stage2Result || stage2Result.status === 'ok' || piProvesCodingPath) &&
    (!piProviderResult || piProviderResult.status !== 'error')
  ) ? 200 : 503;
}

function shouldRunStage1(request: GatewayTestRequest): boolean {
  return request.requestedStage === 0 || request.requestedStage === 1;
}

function shouldRunStage2(
  request: GatewayTestRequest,
  stage1Result: any,
): boolean {
  if (request.requestedStage === 2) return true;
  return request.requestedStage === 0 && stage1Result?.status === 'ok';
}

function shouldRunPiProvider(request: GatewayTestRequest): boolean {
  return request.piProviderRequested && (request.requestedStage === 0 || request.requestedStage === 2);
}

async function runGatewayStage2(request: GatewayTestRequest): Promise<any> {
  const options = typeof request.responseSmoke === 'boolean'
    ? { responseSmoke: request.responseSmoke }
    : undefined;
  const runStage2 = shouldRunGatewayResponseSmoke(options);

  if (!runStage2 && request.requestedStage !== 2) {
    return null;
  }

  const gatewayUrl = process.env.LLM_GATEWAY_URL || '';
  const apiKeyResult = resolveGatewayApiKey();
  const apiKey = apiKeyResult?.value || '';
  const timestamp = new Date().toISOString();
  const startTime = performance.now();
  return testGatewayResponseSmoke_Stage2(gatewayUrl, apiKey, timestamp, startTime);
}

async function runGatewayStages(request: GatewayTestRequest): Promise<GatewayStageResults> {
  const stage1Result = shouldRunStage1(request)
    ? await testGatewayConnectivity_Stage1()
    : null;

  const stage2Result = shouldRunStage2(request, stage1Result)
    ? await runGatewayStage2(request)
    : null;

  const piProviderResult = shouldRunPiProvider(request)
    ? await testPiGatewayProviderSmoke({ requested: true, debug: request.debugMode })
    : null;

  return { stage1Result, stage2Result, piProviderResult };
}

function getStage2OnlyStatus(stage2Result: any, piProviderResult: any): number {
  return (
    (stage2Result?.status === 'ok' || (stage2Result?.status === 'error' && piProviderResult?.status === 'ok')) &&
    (!piProviderResult || piProviderResult.status !== 'error')
  ) ? 200 : 503;
}

function shapeGatewayTestResponse(
  request: GatewayTestRequest,
  results: GatewayStageResults,
): GatewayHttpResponse {
  const { stage1Result, stage2Result, piProviderResult } = results;

  if (request.requestedStage === 1) {
    return {
      body: {
        ...stage1Result,
        responseSmokeValidated: false,
      },
      status: stage1Result.status === 'ok' ? 200 : 503,
    };
  }

  if (request.requestedStage === 2) {
    return {
      body: buildStage2Response(stage2Result, piProviderResult),
      status: getStage2OnlyStatus(stage2Result, piProviderResult),
    };
  }

  return {
    body: buildDualStageResponse(stage1Result, stage2Result, piProviderResult),
    status: getResponseStatus(stage1Result, stage2Result, piProviderResult),
  };
}

/**
 * Create gateway test routes
 */
export function createGatewayTestRoutes(): Router {
  const router = Router();

  /**
   * GET /api/gateway-test - Orchestrated full test (Stage 1 + Stage 2)
   * Runs connectivity by default and response validation only when explicitly requested
   * Stage 2 consumes tokens and requires ?stage=2 or ?responseSmoke=true
   * Query params:
   *   ?stage=1          - Run Stage 1 only (connectivity check)
   *   ?stage=2          - Run Stage 2 only (inference test)
   *   ?responseSmoke=true/false - Override stage 2 decision
   */
  router.get('/gateway-test', async (req: Request, res: Response) => {
    try {
      const request = parseGatewayTestRequest(req);
      const results = await runGatewayStages(request);
      const response = shapeGatewayTestResponse(request, results);

      res.status(response.status).json(response.body);
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
