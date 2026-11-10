import {
  MAX_SENKU_RESPONSE_BYTES,
  buildSenkuDecisionRequest,
  DecisionServiceError,
  requestSenkuDecision,
  resolveSenkuDecisionUrl,
  type SenkuDecisionOptions,
} from './senku-client';
import { SenkuDecisionService } from '../decision-service';
import { answerConfidence } from '../decision-answers';
import { classifyWithJev } from '../jev-classifier';

const TOKEN = 'synthetic-senku-kaseki-token-value-1234567890';
const noulQuestion = { safe: { type: 'noul' as const, instructions: 'Is the result safe?' } };

function noulAnswer(noul = 0.95) {
  return {
    type: 'noul',
    noul,
    probabilities: { false: 1 - noul, true: noul },
    confidence: null,
  };
}

function responseBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1',
    requestId: 'dec-test-123',
    status: 'completed',
    provider: 'jev',
    model: 'typesafe/jev-resolved-test',
    answers: { safe: noulAnswer() },
    usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24, cost: 0.0001 },
    durationMs: 17,
    attemptCount: 1,
    ...overrides,
  };
}

function makeOptions(fetchImpl: typeof fetch, envExtra: NodeJS.ProcessEnv = {}): SenkuDecisionOptions {
  return {
    fetchImpl,
    readFile: () => TOKEN,
    env: {
      NODE_ENV: 'test',
      SENKU_URL: 'https://senku.example.test',
      SENKU_KASEKI_API_TOKEN_FILE: '/synthetic/token',
      ...envExtra,
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('Senku decision transport', () => {
  it('posts the exact generic envelope with the Kaseki bearer token and no model override', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(responseBody()));
    const service = new SenkuDecisionService(makeOptions(fetchImpl));
    const result = await service.decide({
      state: { status: 'failed', evidence: 'private run evidence' },
      questions: noulQuestion,
      model: 'caller-selected-model-must-be-ignored',
      timeoutMs: 1000,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://senku.example.test/v1/decisions');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: '1',
      state: { status: 'failed', evidence: 'private run evidence' },
      questions: noulQuestion,
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('model');
    expect(result).toMatchObject({ provider: 'senku', model: 'typesafe/jev-resolved-test', attemptCount: 1 });
    expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 4, total_tokens: 24, cost: 0.0001 });
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('validates the response and accepts null confidence while preserving missing usage', async () => {
    const body = responseBody({ usage: undefined });
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
    const result = await requestSenkuDecision('state', noulQuestion, makeOptions(fetchImpl));

    expect(result.answers.safe).toEqual(noulAnswer());
    expect(result.usage).toBeUndefined();
    expect(answerConfidence({
      type: 'choice', choice: 'yes', probabilities: { yes: 1, no: 0 }, confidence: null,
    })).toBe(0);
    expect(answerConfidence({
      type: 'choice', choice: 'yes', probabilities: { yes: 1, no: 0 }, confidence: 0,
    })).toBe(0);
  });

  it('validates choice and score probability maps with nullable confidence', async () => {
    const questions = {
      route: { type: 'choice' as const, instructions: 'Choose a route', criteria: { preserve: null, discard: 'Drop it' } },
      quality: { type: 'score' as const, instructions: 'Score quality', criteria: ['Low', 'High'] },
    };
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(responseBody({
      answers: {
        route: { type: 'choice', choice: 'preserve', probabilities: { preserve: 0.8, discard: 0.2 }, confidence: null },
        quality: { type: 'score', score: 1, legend: { 0: 'Low', 1: 'High' }, probabilities: { 0: 0, 1: 1 }, confidence: 0 },
      },
    })));
    const result = await requestSenkuDecision('state', questions, makeOptions(fetchImpl));
    expect(result.answers.route).toMatchObject({ choice: 'preserve', confidence: null });
    expect(result.answers.quality).toMatchObject({ score: 1, confidence: 0 });
  });

  it.each([
    ['unsupported schema version', responseBody({ schemaVersion: '2' })],
    ['missing answer', responseBody({ answers: {} })],
    ['unexpected answer', responseBody({ answers: { unexpected: noulAnswer() } })],
    ['invalid probability distribution', responseBody({ answers: { safe: { ...noulAnswer(), probabilities: { false: 0.4, true: 0.4 } } } })],
    ['invalid answer type', responseBody({ answers: { safe: { type: 'choice', choice: 'yes' } } })],
    ['unexpected answer field', responseBody({ answers: { safe: { ...noulAnswer(), evidence: 'uncontracted' } } })],
    ['unexpected model control character', responseBody({ model: 'model\nforged-log-line' })],
    ['invalid attempt count', responseBody({ attemptCount: 2 })],
    ['invalid reported usage', responseBody({ usage: { input_tokens: -1 } })],
  ])('rejects %s without exposing response details', async (_label, body) => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
    const error = await requestSenkuDecision('private evidence', noulQuestion, makeOptions(fetchImpl))
      .then(() => undefined, (caught: unknown) => caught as DecisionServiceError);
    expect(error).toMatchObject({ category: 'invalid_response' });
    expect(error.message).not.toContain('private evidence');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed JSON and oversized streamed responses', async () => {
    const malformed = jest.fn<typeof fetch>().mockResolvedValue(new Response('{', { status: 200 }));
    await expect(requestSenkuDecision('state', noulQuestion, makeOptions(malformed)))
      .rejects.toMatchObject({ category: 'invalid_response' });

    const oversized = jest.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(MAX_SENKU_RESPONSE_BYTES + 1), { status: 200 }));
    await expect(requestSenkuDecision('state', noulQuestion, makeOptions(oversized)))
      .rejects.toMatchObject({ category: 'invalid_response' });
  });

  it.each([
    [400, 'invalid_request', 'INVALID_REQUEST'],
    [401, 'credentials', 'UNAUTHENTICATED'],
    [403, 'credentials', 'FORBIDDEN'],
    [413, 'invalid_request', 'PAYLOAD_TOO_LARGE'],
    [502, 'provider_failure', 'PROVIDER_UNAVAILABLE'],
    [503, 'service_unavailable', 'NOT_CONFIGURED'],
    [504, 'timeout', 'PROVIDER_TIMEOUT'],
  ] as const)('maps Senku HTTP %i to %s', async (status, category, code) => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code, message: 'secret evidence and provider diagnostics', requestId: 'dec-safe-id' },
    }, status));
    const error = await requestSenkuDecision('private evidence', noulQuestion, makeOptions(fetchImpl))
      .then(() => undefined, (caught: unknown) => caught as DecisionServiceError);
    expect(error).toMatchObject({ category, httpStatus: status, requestId: 'dec-safe-id', attemptCount: 1 });
    expect(error.message).not.toContain('private evidence');
    expect(error.message).not.toContain('provider diagnostics');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps invalid upstream responses and rejects redirects without following them', async () => {
    const upstreamInvalid = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code: 'INVALID_PROVIDER_RESPONSE', requestId: 'dec-invalid' },
    }, 502));
    await expect(requestSenkuDecision('state', noulQuestion, makeOptions(upstreamInvalid)))
      .rejects.toMatchObject({ category: 'invalid_response' });

    const redirect = jest.fn<typeof fetch>().mockResolvedValue(new Response('', {
      status: 302,
      headers: { location: 'https://attacker.example/collect' },
    }));
    await expect(requestSenkuDecision('state', noulQuestion, makeOptions(redirect)))
      .rejects.toMatchObject({ category: 'invalid_response', httpStatus: 302 });
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('maps DNS/network errors without exposing the thrown message', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new Error('token=private-value; DNS details'));
    const error = await requestSenkuDecision('state', noulQuestion, makeOptions(fetchImpl))
      .then(() => undefined, (caught: unknown) => caught as DecisionServiceError);
    expect(error.category).toBe('network');
    expect(error.message).not.toContain('private-value');
    expect(error.message).not.toContain('DNS details');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('enforces the timeout before headers and during response-body reading', async () => {
    const beforeHeaders = jest.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    await expect(requestSenkuDecision('state', noulQuestion, {
      ...makeOptions(beforeHeaders, { SENKU_URL: 'http://127.0.0.1:4011', NODE_ENV: 'test' }),
      timeoutMs: 10,
    }))
      .rejects.toMatchObject({ category: 'timeout' });

    const duringBody = jest.fn<typeof fetch>().mockImplementation((_input, init) => {
      let streamController: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
      init?.signal?.addEventListener('abort', () => streamController.error(new Error('aborted')));
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    await expect(requestSenkuDecision('state', noulQuestion, {
      ...makeOptions(duringBody, { SENKU_URL: 'http://127.0.0.1:4011' }), timeoutMs: 10,
    })).rejects.toMatchObject({ category: 'timeout' });
    expect(duringBody).toHaveBeenCalledTimes(1);
  });

  it('honors an already-aborted caller signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = jest.fn<typeof fetch>();
    await expect(requestSenkuDecision('state', noulQuestion, {
      ...makeOptions(fetchImpl), signal: controller.signal,
    })).rejects.toMatchObject({ category: 'timeout' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects invalid endpoints and credentials before making a request', async () => {
    expect(() => resolveSenkuDecisionUrl({ SENKU_URL: 'http://senku.example.test' })).toThrow(DecisionServiceError);
    expect(() => resolveSenkuDecisionUrl({ NODE_ENV: 'production', SENKU_URL: 'http://127.0.0.1:4011' })).toThrow(DecisionServiceError);
    for (const SENKU_URL of [
      'https://user:pass@senku.example.test',
      'https://senku.example.test/path',
      'https://senku.example.test/?question=1',
      'https://senku.example.test/#fragment',
    ]) {
      expect(() => resolveSenkuDecisionUrl({ SENKU_URL })).toThrow(DecisionServiceError);
    }
    expect(resolveSenkuDecisionUrl({ SENKU_URL: 'http://127.0.0.1:4011', NODE_ENV: 'test' }))
      .toBe('http://127.0.0.1:4011/v1/decisions');

    const fetchImpl = jest.fn<typeof fetch>();
    await expect(requestSenkuDecision('state', noulQuestion, {
      fetchImpl,
      env: { NODE_ENV: 'test', SENKU_URL: 'https://senku.example.test', SENKU_KASEKI_API_TOKEN_FILE: '/missing' },
      readFile: () => { throw new Error('path and OS details'); },
    })).rejects.toMatchObject({ category: 'credentials' });
    const invalidToken = await requestSenkuDecision('state', noulQuestion, {
      ...makeOptions(fetchImpl, { SENKU_KASEKI_API_TOKEN_FILE: '/synthetic/token' }),
      readFile: () => 'short',
    }).then(() => undefined, (caught: unknown) => caught as DecisionServiceError);
    expect(invalidToken).toMatchObject({ category: 'credentials' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects unsupported or oversized requests locally', () => {
    expect(() => buildSenkuDecisionRequest('x'.repeat(130 * 1024), noulQuestion))
      .toThrow(DecisionServiceError);
    expect(() => buildSenkuDecisionRequest('state', {
      'bad-key': { type: 'noul', instructions: 'Does this question have an invalid ID?' },
    })).toThrow(DecisionServiceError);
  });

  it('keeps the legacy classifier shim on one Senku request and ignores retries and model overrides', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(responseBody()));
    const result = await classifyWithJev('state', noulQuestion, {
      fetchImpl,
      model: 'caller-model',
      maxRetries: 8,
      ...makeOptions(fetchImpl),
    });
    expect(result.model).toBe('typesafe/jev-resolved-test');
    expect(result.attemptCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).not.toHaveProperty('model');
  });
});
