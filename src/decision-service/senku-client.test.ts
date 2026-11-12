import { ReadableStream } from 'node:stream/web';
import type { ReadableStreamDefaultController } from 'node:stream/web';
import {
  MAX_SENKU_RESPONSE_BYTES,
  buildSenkuDecisionRequest,
  DecisionServiceError,
  hasRetiredDecisionSettings,
  requestSenkuProfile,
  requestSenkuDecision,
  resolveSenkuDecisionUrl,
  resolveSenkuProfileUrl,
  type SenkuDecisionOptions,
} from './senku-client';
import { SenkuDecisionService } from '../decision-service';
import { answerConfidence } from '../decision-answers';

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

const taskAdmissionAnswers = {
  contains_credentials: noulAnswer(0.01),
  changes_permissions: noulAnswer(0.01),
  crosses_security_boundary: noulAnswer(0.01),
  risk_level: { type: 'choice', choice: 'low', probabilities: { low: 1, review: 0, high: 0 }, confidence: 0.99 },
  task_type: {
    type: 'choice', choice: 'documentation',
    probabilities: { feature: 0, bug_fix: 0, refactor: 0, documentation: 1, investigation: 0, test_only: 0, infrastructure: 0 },
    confidence: 0.99,
  },
  validation_focus: {
    type: 'choice', choice: 'docs_checks',
    probabilities: { unit_tests: 0, integration_tests: 0, type_and_lint: 0, docs_checks: 1, repo_defined_checks: 0 },
    confidence: 0.99,
  },
};

const validationRecoveryAnswers = {
  validation_failure_cause: {
    type: 'choice', choice: 'timeout_or_flaky',
    probabilities: { test_failure: 0, type_or_lint_failure: 0, build_failure: 0, dependency_or_environment: 0, timeout_or_flaky: 1, implementation_logic: 0, unknown: 0 },
    confidence: 0.99,
  },
  validation_recovery_action: {
    type: 'choice', choice: 'inspect_diagnostics',
    probabilities: { fix_implementation: 0, repair_environment: 0, retry_validation_once: 0, inspect_diagnostics: 1 },
    confidence: 0.99,
  },
};

function profileResponse(
  profileId: 'task_admission_v1' | 'kaseki_goal_check_v1' | 'kaseki_run_evaluation_v1' | 'kaseki_context_routing_v1' | 'validation_recovery_v1' = 'task_admission_v1',
  answers: Record<string, unknown> = taskAdmissionAnswers,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: '1',
    requestId: 'dec-profile-test-123',
    status: 'completed',
    profileId,
    profileVersion: '1',
    provider: 'jev',
    model: 'typesafe/jev-resolved-test',
    answers,
    result: answers,
    usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
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

  it('posts a bounded versioned task-admission profile request to its fixed endpoint', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileResponse()));
    const input = {
      repoUrl: 'https://github.com/example/repo',
      ref: 'main',
      taskPrompt: 'Update the README wording',
    };

    const result = await requestSenkuProfile('task_admission_v1', input, makeOptions(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://senku.example.test/v1/profiles/task_admission_v1/evaluate');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: '1', input });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('questions');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('model');
    expect(result).toMatchObject({
      profileId: 'task_admission_v1', profileVersion: '1', provider: 'jev',
      model: 'typesafe/jev-resolved-test', attemptCount: 1,
      answers: { task_type: { choice: 'documentation' } },
    });
    expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 8, total_tokens: 28 });
  });

  it('posts bounded validation evidence to the server-owned recovery profile', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(
      profileResponse('validation_recovery_v1', validationRecoveryAnswers),
    ));
    const input = { command: 'npm test', exitCode: 1, output: 'test timed out' };

    const result = await requestSenkuProfile('validation_recovery_v1', input, makeOptions(fetchImpl));

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://senku.example.test/v1/profiles/validation_recovery_v1/evaluate');
    expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: '1', input });
    expect(result.answers.validation_recovery_action).toMatchObject({ choice: 'inspect_diagnostics' });
  });

  it('validates input-derived goal-check and run-evaluation answers against their fixed profile contracts', async () => {
    const goalInput = {
      state: { diff: 'updated src/worker.ts' },
      criteria: [
        { id: 'criterion_1', criterion: 'The worker handles cancellation.' },
        { id: 'criterion_2', criterion: 'Credentials stay private.', appliesWhen: 'credentials are used' },
      ],
    };
    const applicable = {
      type: 'choice', choice: 'applicable',
      probabilities: { applicable: 1, not_applicable: 0, unknown: 0 }, confidence: 0.9,
    };
    const goalAnswers = {
      criterion_1: noulAnswer(0.9),
      criterion_2_applicability: applicable,
      criterion_2: noulAnswer(0.9),
    };
    const goalFetch = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileResponse(
      'kaseki_goal_check_v1', goalAnswers,
    )));
    const goal = await requestSenkuProfile('kaseki_goal_check_v1', goalInput, makeOptions(goalFetch));
    expect(goal.answers).toEqual(goalAnswers);
    expect(JSON.parse(String(goalFetch.mock.calls[0][1]?.body))).toEqual({ schemaVersion: '1', input: goalInput });

    const runInput = { state: { validation: 'npm test passed' }, includeFailureDiagnosis: true };
    const completionProbabilities = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 1 };
    const runAnswers = {
      overall_assessment: { type: 'choice', choice: 'excellent', probabilities: { excellent: 1, good: 0, mixed: 0, poor: 0 }, confidence: 0.9 },
      reviewer_confidence: { type: 'choice', choice: 'high', probabilities: { high: 1, medium: 0, low: 0 }, confidence: 0.9 },
      task_completion_score: {
        type: 'score', score: 4, probabilities: completionProbabilities, confidence: null,
        legend: { '0': 'Largely unrealized', '1': 'Major requirements unmet', '2': 'Partially complete', '3': 'Nearly complete', '4': 'All requirements verified' },
      },
      validation_failure_cause: { type: 'choice', choice: 'unknown', probabilities: { test_failure: 0, type_or_lint_failure: 0, build_failure: 0, dependency_or_environment: 0, timeout_or_flaky: 0, implementation_logic: 0, unknown: 1 }, confidence: 0.9 },
      validation_recovery_action: { type: 'choice', choice: 'inspect_diagnostics', probabilities: { fix_implementation: 0, repair_environment: 0, retry_validation_once: 0, inspect_diagnostics: 1 }, confidence: 0.9 },
    };
    const runFetch = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileResponse(
      'kaseki_run_evaluation_v1', runAnswers,
    )));
    const run = await requestSenkuProfile('kaseki_run_evaluation_v1', runInput, makeOptions(runFetch));
    expect(run.answers).toEqual(runAnswers);
    expect(JSON.parse(String(runFetch.mock.calls[0][1]?.body))).toEqual({ schemaVersion: '1', input: runInput });

    const malformedFetch = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileResponse(
      'kaseki_goal_check_v1', { ...goalAnswers, criterion_99: noulAnswer() },
    )));
    await expect(requestSenkuProfile('kaseki_goal_check_v1', goalInput, makeOptions(malformedFetch)))
      .rejects.toMatchObject({ category: 'invalid_response' });
  });

  it('validates context-routing modes and candidate answers through one Senku profile', async () => {
    const input = {
      mode: 'phase_transfer',
      evidence: {
        phase_from: 'scouting', phase_to: 'coding', goal_summary: 'Share the common helper.',
        candidates: [
          { id: 'file_0', kind: 'inspected_file', path: 'src/shared.ts', text: 'Possible shared helper.' },
          { id: 'observation_0', kind: 'observation', text: 'One call site duplicates the existing helper.' },
        ],
      },
    };
    const decision = (choice: string) => ({
      type: 'choice', choice,
      probabilities: { preserve: choice === 'preserve' ? 1 : 0, condense: choice === 'condense' ? 1 : 0, discard: choice === 'discard' ? 1 : 0 },
      confidence: 0.9,
    });
    const answers = { file_0: decision('preserve'), observation_0: decision('condense') };
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileResponse(
      'kaseki_context_routing_v1', answers,
    )));
    const result = await requestSenkuProfile('kaseki_context_routing_v1', input, makeOptions(fetchImpl));
    expect(result.answers).toEqual(answers);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ schemaVersion: '1', input });

    const invalid = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileResponse(
      'kaseki_context_routing_v1', { ...answers, unexpected: decision('discard') },
    )));
    await expect(requestSenkuProfile('kaseki_context_routing_v1', input, makeOptions(invalid)))
      .rejects.toMatchObject({ category: 'invalid_response' });
  });

  it.each([
    ['wrong profile', profileResponse('validation_recovery_v1')],
    ['wrong profile version', profileResponse('task_admission_v1', taskAdmissionAnswers, { profileVersion: '2' })],
    ['missing result mirror', profileResponse('task_admission_v1', taskAdmissionAnswers, { result: undefined })],
    ['unexpected answer', profileResponse('task_admission_v1', { ...taskAdmissionAnswers, unexpected: noulAnswer() })],
    ['invalid choice label', profileResponse('task_admission_v1', {
      ...taskAdmissionAnswers, risk_level: { ...taskAdmissionAnswers.risk_level, choice: 'publish' },
    })],
  ])('rejects a %s profile response', async (_label, body) => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
    await expect(requestSenkuProfile('task_admission_v1', { repoUrl: 'https://github.com/example/repo' }, makeOptions(fetchImpl)))
      .rejects.toMatchObject({ category: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an unregistered Kaseki profile before making a request', async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    expect(resolveSenkuProfileUrl('task_admission_v1', { SENKU_URL: 'https://senku.example.test' }))
      .toBe('https://senku.example.test/v1/profiles/task_admission_v1/evaluate');
    expect(() => resolveSenkuProfileUrl('../decisions' as never, { SENKU_URL: 'https://senku.example.test' }))
      .toThrow(DecisionServiceError);
    await expect(requestSenkuProfile('../decisions' as never, {}, makeOptions(fetchImpl)))
      .rejects.toMatchObject({ category: 'configuration' });
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it('rounds a positive fractional timeout instead of silently using the default budget', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const fetchImpl = jest.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const pending = requestSenkuDecision('state', noulQuestion, {
      ...makeOptions(fetchImpl),
      timeoutMs: 10.5,
      signal: controller.signal,
    });
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });

    try {
      await jest.advanceTimersByTimeAsync(11);
      expect(settled).toBe(true);
      await expect(pending).rejects.toMatchObject({ category: 'timeout' });
    } finally {
      controller.abort();
      await pending.catch(() => undefined);
      jest.clearAllTimers();
      jest.useRealTimers();
    }
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

  it('checks credentials before serializing an oversized request', async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    await expect(requestSenkuDecision('x'.repeat(130 * 1024), noulQuestion, {
      fetchImpl,
      env: { NODE_ENV: 'test', SENKU_URL: 'https://senku.example.test' },
      readFile: () => { throw new Error('synthetic missing token file'); },
    })).rejects.toMatchObject({ category: 'credentials', credentialSource: 'none' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('recognizes retired caller-owned JEV settings without retaining a classifier shim', () => {
    expect(hasRetiredDecisionSettings({ KASEKI_DECISION_MODEL: 'old/model' })).toBe(true);
    expect(hasRetiredDecisionSettings({ KASEKI_CLASSIFICATION_MODEL: 'old/model' })).toBe(true);
    expect(hasRetiredDecisionSettings({ KASEKI_JEV_API_KEY_FILE: '/old/key' })).toBe(true);
    expect(hasRetiredDecisionSettings({})).toBe(false);
  });
});
