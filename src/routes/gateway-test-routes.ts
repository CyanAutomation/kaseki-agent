/**
 * Gateway connectivity test routes
 *
 * Provides comprehensive LLM gateway diagnostics:
 * - GET /api/v1/gateway-test - Connectivity check; token-consuming checks require inference=true
 *
 * Stage 1: Authentication and connectivity check (no token consumption)
 * Stage 2: LLM inference test (with token consumption in production)
 * Evaluation: structured decision endpoint check (opt-in via ?evaluation=true)
 */

import { Router, Request, Response } from 'express';
import { createEventLogger } from '../logger';
import { sendErrorResponse } from '../utils/response-helpers';
import {
  testGatewayConnectivity_Stage1,
  testGatewayResponseSmoke_Stage2,
  resolveGatewayApiKey,
  shouldRunGatewayResponseSmoke,
  testPiGatewayProviderSmoke,
  testClassificationSmoke,
  shouldRunClassificationSmoke,
} from '../kaseki-api-gateway-smoke';

const logger = createEventLogger('gateway-test-routes');

type GatewayRequestedStage = 0 | 1 | 2;

type GatewayTestRequest = {
  requestedStage: GatewayRequestedStage;
  inferenceOptIn: boolean;
  inferenceOptInRequired: boolean;
  responseSmoke?: boolean;
  piProviderRequested: boolean;
  classificationRequested: boolean;
  debugMode: boolean;
};

type GatewayStageResults = {
  stage1Result: any;
  stage2Result: any;
  piProviderResult: any;
  classificationResult: any;
};

type GatewayHttpResponse = {
  status: number;
  body: any;
};

type DualStageState = {
  piAdapterFailed: boolean;
  primaryPathHealthy: boolean;
  partialSuccess: boolean;
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
  const inferenceOptIn = parseQueryBoolean(req.query.inference) === true;
  const explicitlyCostly = parseQueryStage(req.query.stage) === 2 ||
    parseQueryBoolean(req.query.responseSmoke) === true ||
    parseQueryBoolean(req.query.piProvider) === true ||
    parseQueryBoolean(req.query.evaluation) === true ||
    parseQueryBoolean(req.query.classification) === true;
  return {
    requestedStage: inferenceOptIn ? parseQueryStage(req.query.stage) : 1,
    inferenceOptIn,
    inferenceOptInRequired: explicitlyCostly && !inferenceOptIn,
    responseSmoke: parseQueryBoolean(req.query.responseSmoke),
    piProviderRequested: parseQueryBoolean(req.query.piProvider) ?? false,
    classificationRequested: parseQueryBoolean(req.query.evaluation)
      ?? parseQueryBoolean(req.query.classification)
      ?? false,
    debugMode: parseQueryBoolean(req.query.debug) ?? false,
  };
}

function resolveDualStageState(stage1Result: any, stage2Result: any, piProviderResult: any, classificationResult: any): DualStageState {
  const piAdapterFailed = piProviderResult?.status === 'error';
  const classifierFailed = classificationResult?.status === 'error';
  const primaryPathHealthy = stage1Result.status === 'ok'
    && (!stage2Result || stage2Result.status === 'ok' || piProviderResult?.status === 'ok')
    && !piAdapterFailed;
  const partialSuccess = (stage2Result?.status === 'error' && piProviderResult?.status === 'ok')
    || (stage2Result?.status === 'ok' && piAdapterFailed)
    || (primaryPathHealthy && classifierFailed);
  return { piAdapterFailed, primaryPathHealthy, partialSuccess };
}

function addStageTwoFields(response: any, stage2Result: any): void {
  if (!stage2Result) return;
  Object.assign(response, {
    responseId: stage2Result.responseId,
    outputTokens: stage2Result.outputTokens,
    modelUsed: stage2Result.modelUsed,
    streamSmokeValidated: stage2Result.streamSmokeValidated,
    largePromptSmokeValidated: stage2Result.largePromptSmokeValidated,
    checks: stage2Result.checks,
  });
}

function addPiProviderFields(response: any, stage2Result: any, piProviderResult: any, state: DualStageState): void {
  if (!piProviderResult) return;
  Object.assign(response, {
    piProviderSmoke: piProviderResult,
    gatewayInferenceValidated: stage2Result?.status === 'ok',
    piAdapterValidated: piProviderResult.status === 'ok',
    partialSuccess: state.partialSuccess,
    codingShapeValidated: piProviderResult.codingShapeValidated === true,
    multiTurnValidated: piProviderResult.multiTurnValidated === true,
  });
}

function addClassificationFields(response: any, classificationResult: any, state: DualStageState): void {
  if (!classificationResult) return;
  response.evaluationSmoke = classificationResult;
  response.evaluationValidated = classificationResult.status === 'ok';
  if (classificationResult.status === 'error') response.partialSuccess = state.primaryPathHealthy;
}

/**
 * Build dual-stage response (Stage 1 + Stage 2 + Classification)
 */
function buildDualStageResponse(
  stage1Result: any,
  stage2Result: any,
  piProviderResult: any,
  classificationResult: any,
): any {
  const state = resolveDualStageState(stage1Result, stage2Result, piProviderResult, classificationResult);
  const result: any = {
    status: !state.primaryPathHealthy || state.piAdapterFailed ? 'error' : (state.partialSuccess ? 'partial' : 'ok'),
    detail: stage1Result.detail,
    responseTime: stage1Result.responseTime,
    timestamp: new Date().toISOString(),
    authenticationValidated: stage1Result.authenticationValidated,
    responseSmokeValidated: stage2Result?.status === 'ok',
  };
  addStageTwoFields(result, stage2Result);
  addPiProviderFields(result, stage2Result, piProviderResult, state);
  addClassificationFields(result, classificationResult, state);
  return result;
}

/**
 * Build Stage 2-only response (with optional classification)
 */
function resolveStage2ResponseStatus(input: {
  stage2Healthy: boolean;
  piAdapterFailed: boolean;
  piProviderHealthy: boolean;
  piProviderRequested: boolean;
  primaryPathHealthy: boolean;
  classifierFailed: boolean;
}): { status: string; partialSuccess: boolean } {
  let status = 'error';
  let partialSuccess = false;

  if (input.stage2Healthy && !input.piAdapterFailed) {
    // Stage2 is healthy, Pi is either not tested or is healthy, classifier is not failed
    status = 'ok';
    partialSuccess = false;
  } else if (input.stage2Healthy && input.piAdapterFailed && input.piProviderRequested) {
    // Stage2 works but Pi provider fails (and was requested) - we have partial capability
    status = 'error';
    partialSuccess = true;
  } else if (!input.stage2Healthy && input.piProviderHealthy && input.piProviderRequested) {
    // Stage2 fails but Pi provider works (and was requested) - we have partial capability
    status = 'partial';
    partialSuccess = true;
  }

  if (input.primaryPathHealthy && input.classifierFailed) {
    status = 'partial';
    partialSuccess = true;
  }

  return { status, partialSuccess };
}

function addStage2ResponseFields(result: any, stage2Result: any): void {
  if (stage2Result?.responseId) result.responseId = stage2Result.responseId;
  if (stage2Result?.outputTokens) result.outputTokens = stage2Result.outputTokens;
  if (stage2Result?.modelUsed) result.modelUsed = stage2Result.modelUsed;
  if (typeof stage2Result?.streamSmokeValidated === 'boolean') {
    result.streamSmokeValidated = stage2Result.streamSmokeValidated;
  }
  if (typeof stage2Result?.largePromptSmokeValidated === 'boolean') {
    result.largePromptSmokeValidated = stage2Result.largePromptSmokeValidated;
  }
  if (stage2Result?.checks) result.checks = stage2Result.checks;
}

function addStage2ProviderFields(
  result: any,
  stage2Result: any,
  piProviderResult: any,
  classificationResult: any,
  partialSuccess: boolean,
): void {
  if (piProviderResult) {
    result.piProviderSmoke = piProviderResult;
    result.gatewayInferenceValidated = stage2Result?.status === 'ok';
    result.piAdapterValidated = piProviderResult.status === 'ok';
    result.partialSuccess = partialSuccess;
    result.codingShapeValidated = piProviderResult.codingShapeValidated === true;
    result.multiTurnValidated = piProviderResult.multiTurnValidated === true;
  }
  if (classificationResult) {
    result.evaluationSmoke = classificationResult;
    result.evaluationValidated = classificationResult.status === 'ok';
  }
}

function stage2ModelTest(stage2Result: any, piProviderResult: any, classificationResult: any): Record<string, unknown> {
  const gatewayInferenceMs = Number(stage2Result?.responseTime) || 0;
  const piAdapterMs = Number(piProviderResult?.responseTime) || 0;
  const evaluationMs = Number(classificationResult?.responseTime) || 0;
  const includesEvaluation = Boolean(classificationResult && classificationResult.status !== 'skipped');
  return {
    gatewayInferenceMs,
    piAdapterMs: piProviderResult ? piAdapterMs : null,
    evaluationMs: includesEvaluation ? evaluationMs : null,
    endToEndMs: gatewayInferenceMs + (piProviderResult ? piAdapterMs : 0) + (includesEvaluation ? evaluationMs : 0),
    tokens: {
      output: typeof stage2Result?.outputTokens === 'number' ? stage2Result.outputTokens : null,
      estimatedCostUsd: null,
      availability: typeof stage2Result?.outputTokens === 'number' ? 'gateway-reported' : 'unavailable',
    },
  };
}

function buildStage2Response(stage2Result: any, piProviderResult: any, classificationResult: any): any {
  const piAdapterFailed = piProviderResult?.status === 'error';
  const classifierFailed = classificationResult?.status === 'error';
  const stage2Healthy = stage2Result?.status === 'ok';
  const piProviderHealthy = piProviderResult?.status === 'ok';
  const piProviderRequested = !!piProviderResult;
  const primaryPathHealthy = (stage2Healthy || (!stage2Healthy && piProviderHealthy && piProviderRequested)) && !piAdapterFailed;
  const { status, partialSuccess } = resolveStage2ResponseStatus({
    stage2Healthy,
    piAdapterFailed,
    piProviderHealthy,
    piProviderRequested,
    primaryPathHealthy,
    classifierFailed,
  });
  const result: any = {
    status,
    detail: stage2Result?.detail || 'LLM inference test failed',
    responseTime: stage2Result?.responseTime || 0,
    timestamp: new Date().toISOString(),
    responseSmokeValidated: stage2Result?.status === 'ok',
  };
  addStage2ResponseFields(result, stage2Result);
  addStage2ProviderFields(result, stage2Result, piProviderResult, classificationResult, partialSuccess);
  result.modelTest = stage2ModelTest(stage2Result, piProviderResult, classificationResult);
  return result;
}

/**
 * Determine HTTP status for response
 */
function getResponseStatus(
  stage1Result: any,
  stage2Result: any,
  piProviderResult: any,
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

function shouldRunClassification(request: GatewayTestRequest): boolean {
  return request.classificationRequested && (request.requestedStage === 0 || request.requestedStage === 2);
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

async function runClassificationSmokeTest(request: GatewayTestRequest): Promise<any> {
  const runClassification = shouldRunClassificationSmoke(request.classificationRequested);

  if (!runClassification) {
    return null;
  }

  return await testClassificationSmoke(request.classificationRequested);
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

  const classificationResult = shouldRunClassification(request)
    ? await runClassificationSmokeTest(request)
    : null;

  return { stage1Result, stage2Result, piProviderResult, classificationResult };
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
  const { stage1Result, stage2Result, piProviderResult, classificationResult } = results;

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
      body: buildStage2Response(stage2Result, piProviderResult, classificationResult),
      status: getStage2OnlyStatus(stage2Result, piProviderResult),
    };
  }

  return {
    body: buildDualStageResponse(stage1Result, stage2Result, piProviderResult, classificationResult),
    status: getResponseStatus(stage1Result, stage2Result, piProviderResult),
  };
}

/**
 * Create gateway test routes
 */
export function createGatewayTestRoutes(): Router {
  const router = Router();

  /**
   * GET /api/v1/gateway-test - Orchestrated gateway diagnostics
   * Runs connectivity by default and response validation only when explicitly requested
   * Stage 2 consumes tokens and requires ?stage=2 or ?responseSmoke=true
   * Evaluation is opt-in via ?evaluation=true
   * Query params:
   *   ?stage=1              - Run Stage 1 only (connectivity check)
   *   ?stage=2              - Run Stage 2 only (inference test)
   *   ?responseSmoke=true/false - Override stage 2 decision
   *   ?evaluation=true     - Run the evaluation endpoint check (opt-in)
   *   ?piProvider=true      - Run Pi provider adapter smoke
   *   ?debug=true           - Enable debug logging
   */
  router.get('/gateway-test', async (req: Request, res: Response) => {
    try {
      const request = parseGatewayTestRequest(req);
      if (request.inferenceOptInRequired) {
        return sendErrorResponse(res, 400, 'Bad Request', 'Token-consuming gateway checks require the explicit inference=true opt-in');
      }
      const results = await runGatewayStages(request);
      const response = shapeGatewayTestResponse(request, results);

      res.status(response.status).json(response.body);
    } catch (error) {
      logger.error('Gateway test error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return sendErrorResponse(res, 500, 'Internal Server Error', 'Unexpected error during gateway test');
    }
  });

  return router;
}
