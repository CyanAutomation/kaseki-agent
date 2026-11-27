import { readFileSync } from 'node:fs';
import { TextDecoder, TextEncoder } from 'node:util';
import type { ClassificationAnswer } from '../types/openrouter-decisions';
import { profileAnswerContracts, SENKU_PROFILE_IDS, type ProfileAnswerContract, type SenkuProfileId } from './profile-contracts';

export const DEFAULT_SENKU_URL = 'https://service.example.invalid';
export const SENKU_PROFILE_PATH = '/v1/profiles';
export const SENKU_SCHEMA_VERSION = '1' as const;
export const MAX_SENKU_REQUEST_BYTES = 128 * 1024;
export const MAX_SENKU_RESPONSE_BYTES = 64 * 1024;
export { SENKU_PROFILE_IDS };
export type { SenkuProfileId };

export const RETIRED_DECISION_SETTINGS = [
  'KASEKI_JEV_WORKFLOW',
  'KASEKI_JEV_CONFIDENCE',
  'KASEKI_JEV_GOAL_CHECK_TIMEOUT_MS',
  'KASEKI_JEV_RUN_EVALUATION_TIMEOUT_MS',
  'KASEKI_JEV_WORKFLOW_EVALUATOR',
  'KASEKI_DECISION_API_KEY_FILE',
  'KASEKI_DECISION_MODEL',
  'KASEKI_CLASSIFICATION_MODEL',
  'KASEKI_JEV_API_KEY_FILE',
  'KASEKI_JEV_TASK_TYPE',
  'KASEKI_JEV_VALIDATION_FOCUS',
] as const;

export function hasRetiredDecisionSettings(env: NodeJS.ProcessEnv = process.env): boolean {
  return RETIRED_DECISION_SETTINGS.some((name) => env[name] !== undefined);
}

export type DecisionFailureCategory =
  | 'configuration'
  | 'credentials'
  | 'timeout'
  | 'rate_limited'
  | 'network'
  | 'service_unavailable'
  | 'invalid_request'
  | 'invalid_response'
  | 'provider_failure';

const SAFE_MESSAGES: Record<DecisionFailureCategory, string> = {
  configuration: 'Senku decision service configuration is invalid.',
  credentials: 'Senku decision service credentials are unavailable or rejected.',
  timeout: 'Senku decision service did not respond within the decision time budget.',
  rate_limited: 'Senku or its decision provider is rate limiting requests.',
  network: 'Senku decision service could not be reached.',
  service_unavailable: 'Senku decision service is unavailable.',
  invalid_request: 'The decision request is invalid for Senku.',
  invalid_response: 'Senku returned an invalid decision response.',
  provider_failure: 'Senku could not complete the decision.',
};

export class DecisionServiceError extends Error {
  readonly category: DecisionFailureCategory;
  readonly httpStatus?: number;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly retryAfterSeconds?: number;
  readonly senkuCode?: string;
  readonly attemptCount?: number;
  readonly credentialSource?: SenkuTokenResolution['source'];

  constructor(
    category: DecisionFailureCategory,
    metadata: {
      httpStatus?: number;
      requestId?: string;
      correlationId?: string;
      retryAfterSeconds?: number;
      senkuCode?: string;
      attemptCount?: number;
      credentialSource?: SenkuTokenResolution['source'];
    } = {},
  ) {
    super(SAFE_MESSAGES[category]);
    this.name = 'DecisionServiceError';
    this.category = category;
    this.httpStatus = metadata.httpStatus;
    this.requestId = safeRequestId(metadata.requestId);
    this.correlationId = safeCorrelationId(metadata.correlationId);
    this.retryAfterSeconds = Number.isSafeInteger(metadata.retryAfterSeconds)
      && (metadata.retryAfterSeconds ?? -1) >= 0 && (metadata.retryAfterSeconds ?? 86_401) <= 86_400
      ? metadata.retryAfterSeconds
      : undefined;
    this.senkuCode = /^[A-Z_]{1,64}$/.test(metadata.senkuCode ?? '') ? metadata.senkuCode : undefined;
    this.attemptCount = Number.isSafeInteger(metadata.attemptCount) && (metadata.attemptCount ?? 0) >= 1
      ? metadata.attemptCount
      : undefined;
    this.credentialSource = metadata.credentialSource;
  }
}

export interface SenkuProfileRequest {
  schemaVersion: typeof SENKU_SCHEMA_VERSION;
  input: Record<string, unknown>;
}

export interface SenkuProfileResponse {
  schemaVersion: typeof SENKU_SCHEMA_VERSION;
  requestId: string;
  status: 'completed';
  profileId: SenkuProfileId;
  profileVersion: '1';
  provider: 'jev';
  model: string;
  answers: Record<string, ClassificationAnswer>;
  result: Record<string, ClassificationAnswer>;
  usage?: Record<string, number>;
  durationMs: number;
  attemptCount: number;
}

export interface SenkuProfileResult extends SenkuProfileResponse {
  responseTime: number;
  correlationId: string;
}

export interface SenkuClientOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  readFile?: (path: string, encoding: 'utf8') => string;
}

export interface SenkuRequestOptions extends SenkuClientOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  correlationId?: string;
}

function fail(category: DecisionFailureCategory, metadata?: ConstructorParameters<typeof DecisionServiceError>[1]): never {
  throw new DecisionServiceError(category, metadata);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function validJsonTree(value: unknown, depth = 0, budget = { nodes: 0 }): boolean {
  budget.nodes += 1;
  if (budget.nodes > 8192 || depth > 24) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((child) => validJsonTree(child, depth + 1, budget));
  if (!isRecord(value)) return false;
  return Object.values(value).every((child) => validJsonTree(child, depth + 1, budget));
}

export function buildSenkuProfileRequest(
  profileId: SenkuProfileId,
  input: Record<string, unknown>,
): { envelope: SenkuProfileRequest; body: string } {
  if (!SENKU_PROFILE_IDS.includes(profileId) || !isRecord(input) || !validJsonTree(input)) {
    fail('invalid_request');
  }
  const envelope: SenkuProfileRequest = { schemaVersion: SENKU_SCHEMA_VERSION, input };
  let body: string;
  try {
    body = JSON.stringify(envelope);
  } catch {
    fail('invalid_request');
  }
  if (utf8Size(body!) > MAX_SENKU_REQUEST_BYTES) fail('invalid_request');
  return { envelope, body: body! };
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function resolveSenkuOrigin(env: NodeJS.ProcessEnv): string {
  const configured = env.SENKU_URL?.trim();
  if (!configured && env.NODE_ENV === 'production') fail('configuration');
  const origin = configured || DEFAULT_SENKU_URL;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    fail('configuration');
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== '' && parsed.pathname !== '/')
    || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname) && env.NODE_ENV !== 'production'))) {
    fail('configuration');
  }
  return parsed.origin;
}

export function resolveSenkuProfileUrl(profileId: SenkuProfileId, env: NodeJS.ProcessEnv = process.env): string {
  if (!SENKU_PROFILE_IDS.includes(profileId)) fail('configuration');
  return new URL(`${SENKU_PROFILE_PATH}/${profileId}/evaluate`, resolveSenkuOrigin(env)).toString();
}

export interface SenkuTokenResolution {
  token?: string;
  source: 'file' | 'environment' | 'none';
}

function validToken(value: string): boolean {
  return /^[\x21-\x7e]{32,1024}$/.test(value);
}

function expandedPath(value: string, env: NodeJS.ProcessEnv): string {
  if (value === '~') return env.HOME || value;
  if (value.startsWith('~/')) return `${env.HOME || ''}${value.slice(1)}`;
  return value;
}

export function resolveSenkuKasekiToken(options: SenkuClientOptions = {}): SenkuTokenResolution {
  const env = options.env ?? process.env;
  const readFile = options.readFile ?? ((path: string, encoding: 'utf8') => readFileSync(path, encoding));
  const explicitPath = env.SENKU_KASEKI_API_TOKEN_FILE?.trim();
  const filePaths = explicitPath ? [expandedPath(explicitPath, env)] : [];

  for (const filePath of filePaths) {
    try {
      const token = readFile(filePath, 'utf8').trim();
      if (!validToken(token)) fail('credentials', { credentialSource: 'file' });
      return { token, source: 'file' };
    } catch (error) {
      if (error instanceof DecisionServiceError) throw error;
      if (explicitPath) fail('credentials', { credentialSource: 'file' });
    }
  }

  const inline = env.SENKU_KASEKI_API_TOKEN?.trim();
  if (!inline) return { source: 'none' };
  if (!validToken(inline)) fail('credentials', { credentialSource: 'environment' });
  return { token: inline, source: 'environment' };
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isDistribution(value: unknown, expectedKeys: string[]): value is Record<string, number> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => Object.hasOwn(value, key))
    || !Object.values(value).every(isProbability)) return false;
  const total = Object.values(value).reduce<number>((sum, probability) => sum + Number(probability), 0);
  return Math.abs(total - 1) <= 0.03;
}

function validConfidence(value: unknown): value is number | null {
  return value === null || isProbability(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validAnswer(contract: ProfileAnswerContract, answer: unknown): answer is ClassificationAnswer {
  if (!isRecord(answer)) return false;
  if (contract.type === 'noul') {
    return hasExactKeys(answer, ['type', 'noul', 'probabilities', 'confidence'])
      && answer.type === 'noul'
      && isProbability(answer.noul)
      && isDistribution(answer.probabilities, ['false', 'true'])
      && answer.confidence === null;
  }
  if (contract.type === 'choice') {
    const ids = [...contract.choices];
    return hasExactKeys(answer, ['type', 'choice', 'probabilities', 'confidence'])
      && answer.type === 'choice'
      && typeof answer.choice === 'string'
      && ids.includes(answer.choice)
      && isDistribution(answer.probabilities, ids)
      && validConfidence(answer.confidence);
  }
  const scoreIds = Array.from({ length: contract.levels }, (_value, index) => String(index));
  const legend = answer.legend;
  if (!hasExactKeys(answer, ['type', 'score', 'probabilities', 'confidence', 'legend'])
    || answer.type !== 'score' || typeof answer.score !== 'number'
    || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > contract.levels - 1
    || !isDistribution(answer.probabilities, scoreIds) || !validConfidence(answer.confidence)
    || !isRecord(legend)) return false;
  return Object.keys(legend).length === scoreIds.length
    && scoreIds.every((key) => typeof legend[key] === 'string');
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(value) ? value : undefined;
}

function safeCorrelationId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value) ? value : undefined;
}

function validUsage(value: unknown): value is Record<string, number> {
  return isRecord(value)
    && Object.keys(value).every((key) => ['input_tokens', 'output_tokens', 'total_tokens', 'cost'].includes(key))
    && Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0);
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => equalJson(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(left[key], right[key]));
}

function validateProfileResponse(
  value: unknown,
  expectedProfileId: SenkuProfileId,
  input: Record<string, unknown>,
): SenkuProfileResponse {
  if (!isRecord(value)
    || value.schemaVersion !== SENKU_SCHEMA_VERSION || value.status !== 'completed'
    || value.profileId !== expectedProfileId || value.profileVersion !== '1' || value.provider !== 'jev'
    || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 256 || hasControlCharacter(value.model)
    || !safeRequestId(value.requestId) || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs)
    || value.durationMs < 0 || !Number.isSafeInteger(value.attemptCount) || (value.attemptCount as number) < 1
    || !isRecord(value.answers) || !isRecord(value.result)) {
    fail('invalid_response', { attemptCount: 1 });
  }
  const contracts = profileAnswerContracts(expectedProfileId, input);
  const answers = value.answers as Record<string, unknown>;
  const result = value.result as Record<string, unknown>;
  if (value.usage !== undefined && !validUsage(value.usage)) fail('invalid_response', { attemptCount: 1 });
  const answerIds = Object.keys(answers);
  const expectedIds = Object.keys(contracts);
  if (expectedIds.length === 0 || answerIds.length !== expectedIds.length || answerIds.some((id) => !Object.hasOwn(contracts, id))
    || !expectedIds.every((id) => validAnswer(contracts[id]!, answers[id]))
    || !equalJson(answers, result)) {
    fail('invalid_response', { requestId: safeRequestId(value.requestId), attemptCount: 1 });
  }
  return value as unknown as SenkuProfileResponse;
}

async function readBoundedBody(response: Response, maxBytes: number, category: DecisionFailureCategory): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        fail(category, { attemptCount: 1 });
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof DecisionServiceError) throw error;
    throw new DecisionServiceError(category, { attemptCount: 1 });
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    fail('invalid_response', { attemptCount: 1 });
  }
}

async function responseError(response: Response, correlationId: string): Promise<DecisionServiceError> {
  const bytes = await readBoundedBody(response, MAX_SENKU_RESPONSE_BYTES, 'service_unavailable').catch((error: unknown) => {
    if (error instanceof DecisionServiceError) return new Uint8Array();
    return new Uint8Array();
  });
  let code: string | undefined;
  let requestId: string | undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (isRecord(value) && isRecord(value.error)) {
      code = typeof value.error.code === 'string' ? value.error.code : undefined;
      requestId = safeRequestId(value.error.requestId);
    }
  } catch {
    // Status mapping still yields a safe error when the public body is malformed.
  }

  let category: DecisionFailureCategory = 'service_unavailable';
  if (response.status === 401 || response.status === 403) category = 'credentials';
  else if (response.status === 400 || response.status === 413) category = 'invalid_request';
  else if (response.status === 504 || code === 'PROVIDER_TIMEOUT') category = 'timeout';
  else if (response.status === 502 && code === 'INVALID_PROVIDER_RESPONSE') category = 'invalid_response';
  else if (response.status === 429 || code === 'PROVIDER_RATE_LIMITED' || code === 'RATE_LIMITED') category = 'rate_limited';
  else if (response.status === 502 && code === 'PROVIDER_UNAVAILABLE') category = 'provider_failure';
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfterSeconds = retryAfterHeader && /^\d{1,5}$/.test(retryAfterHeader) && Number(retryAfterHeader) <= 86_400
    ? Number(retryAfterHeader)
    : undefined;
  return new DecisionServiceError(category, {
    httpStatus: response.status,
    requestId,
    senkuCode: code,
    correlationId,
    retryAfterSeconds,
    attemptCount: 1,
  });
}

function timeoutMs(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : 15_000;
}

async function requestSenku<T extends object>(
  resolveUrl: () => string,
  buildBody: () => string,
  validate: (value: unknown) => T,
  options: SenkuRequestOptions,
): Promise<T & { responseTime: number; correlationId: string }> {
  if (hasRetiredDecisionSettings(options.env ?? process.env)) fail('configuration');
  const url = resolveUrl();
  const credentials = resolveSenkuKasekiToken(options);
  if (!credentials.token) fail('credentials', { credentialSource: 'none' });
  const body = buildBody();

  const controller = new AbortController();
  const fetchImpl = options.fetchImpl ?? fetch;
  const started = performance.now();
  const budget = timeoutMs(options.timeoutMs);
  const correlationId = safeCorrelationId(options.correlationId) ?? `kaseki-${crypto.randomUUID()}`;
  const marginMs = Math.min(1_000, Math.max(1, Math.floor(budget / 10)));
  const deadlineAtMs = Date.now() + Math.max(1, Math.min(30_000, budget - marginMs));
  let timer: NodeJS.Timeout | undefined;
  let removeExternalAbort = (): void => undefined;
  let rejectAbort: ((error: DecisionServiceError) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });

  if (options.signal?.aborted) throw new DecisionServiceError('timeout', { correlationId });
  if (options.signal) {
    const abort = (): void => {
      controller.abort();
      rejectAbort?.(new DecisionServiceError('timeout', { correlationId }));
    };
    options.signal.addEventListener('abort', abort, { once: true });
    removeExternalAbort = () => options.signal?.removeEventListener('abort', abort);
  }

  const operation = (async (): Promise<T & { responseTime: number; correlationId: string }> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credentials.token}`,
          'X-Correlation-Id': correlationId,
          'X-Senku-Deadline-Ms': String(deadlineAtMs),
        },
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) {
        throw new DecisionServiceError('timeout', { attemptCount: 1, correlationId });
      }
      throw new DecisionServiceError('network', { attemptCount: 1, correlationId });
    }

    if (response.status >= 300 && response.status < 400) {
      throw new DecisionServiceError('invalid_response', { httpStatus: response.status, attemptCount: 1, correlationId });
    }
    if (!response.ok) throw await responseError(response, correlationId);

    const bytes = await readBoundedBody(response, MAX_SENKU_RESPONSE_BYTES, 'invalid_response');
    const validated = validate(parseJson(bytes));
    return { ...validated, responseTime: Math.round(performance.now() - started), correlationId };
  })();

  try {
    timer = setTimeout(() => {
      controller.abort();
      rejectAbort?.(new DecisionServiceError('timeout', { attemptCount: 1, correlationId }));
    }, budget);
    return await Promise.race([operation, abortPromise]);
  } catch (error) {
    if (controller.signal.aborted) throw new DecisionServiceError('timeout', { attemptCount: 1, correlationId });
    if (error instanceof DecisionServiceError) {
      if (error.correlationId) throw error;
      throw new DecisionServiceError(error.category, {
        httpStatus: error.httpStatus,
        requestId: error.requestId,
        senkuCode: error.senkuCode,
        attemptCount: error.attemptCount,
        credentialSource: error.credentialSource,
        correlationId,
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    throw new DecisionServiceError('network', { attemptCount: 1, correlationId });
  } finally {
    if (timer) clearTimeout(timer);
    removeExternalAbort();
  }
}

export async function requestSenkuProfile(
  profileId: SenkuProfileId,
  input: Record<string, unknown>,
  options: SenkuRequestOptions = {},
): Promise<SenkuProfileResult> {
  return requestSenku(
    () => resolveSenkuProfileUrl(profileId, options.env ?? process.env),
    () => buildSenkuProfileRequest(profileId, input).body,
    (value) => validateProfileResponse(value, profileId, input),
    options,
  );
}
