import { testClassificationSmoke } from './kaseki-api-gateway-smoke';

const TOKEN = 'synthetic-senku-kaseki-token-value-1234567890';

function smokeResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    schemaVersion: '1',
    requestId: 'dec-smoke-test',
    status: 'completed',
    profileId: 'kaseki_run_evaluation_v1',
    profileVersion: '1',
    provider: 'jev',
    model: 'typesafe/jev-resolved-test',
    answers: {
      overall_assessment: {
        type: 'choice', choice: 'good', confidence: 0.94,
        probabilities: { excellent: 0.02, good: 0.94, mixed: 0.03, poor: 0.01 },
      },
      reviewer_confidence: {
        type: 'choice', choice: 'high', confidence: 0.92,
        probabilities: { high: 0.92, medium: 0.06, low: 0.02 },
      },
      task_completion_score: {
        type: 'score', score: 4, confidence: 0.92,
        probabilities: { '0': 0.01, '1': 0.01, '2': 0.02, '3': 0.04, '4': 0.92 },
        legend: { '0': 'Largely unrealized', '1': 'Major requirements unmet', '2': 'Partially complete', '3': 'Nearly complete', '4': 'All requirements verified' },
      },
    },
    result: {
      overall_assessment: {
        type: 'choice', choice: 'good', confidence: 0.94,
        probabilities: { excellent: 0.02, good: 0.94, mixed: 0.03, poor: 0.01 },
      },
      reviewer_confidence: {
        type: 'choice', choice: 'high', confidence: 0.92,
        probabilities: { high: 0.92, medium: 0.06, low: 0.02 },
      },
      task_completion_score: {
        type: 'score', score: 4, confidence: 0.92,
        probabilities: { '0': 0.01, '1': 0.01, '2': 0.02, '3': 0.04, '4': 0.92 },
        legend: { '0': 'Largely unrealized', '1': 'Major requirements unmet', '2': 'Partially complete', '3': 'Nearly complete', '4': 'All requirements verified' },
      },
    },
    usage: { input_tokens: 427, output_tokens: 73, total_tokens: 500 },
    durationMs: 20,
    attemptCount: 1,
    ...overrides,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Senku evaluation smoke check', () => {
  const originalFetch = global.fetch;
  const originalEnv = new Map([
    'NODE_ENV', 'HOME', 'SENKU_URL', 'SENKU_KASEKI_API_TOKEN', 'SENKU_KASEKI_API_TOKEN_FILE', 'KASEKI_SECRETS_DIR',
    'KASEKI_DECISION_MODEL', 'KASEKI_DECISION_API_KEY_FILE',
  ].map((name) => [name, process.env[name]]));

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.SENKU_KASEKI_API_TOKEN = TOKEN;
    delete process.env.SENKU_KASEKI_API_TOKEN_FILE;
    delete process.env.KASEKI_SECRETS_DIR;
    delete process.env.SENKU_URL;
    delete process.env.KASEKI_DECISION_MODEL;
    delete process.env.KASEKI_DECISION_API_KEY_FILE;
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(smokeResponse());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('keeps the decision probe opt-in', async () => {
    const result = await testClassificationSmoke(false);
    expect(result.status).toBe('skipped');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls the fixed Senku run-evaluation profile and validates its typed answers', async () => {
    const result = await testClassificationSmoke(true);
    expect(result.status).toBe('ok');
    expect(result.evaluationValidated).toBe(true);
    expect(result.confidenceLevel).toBe('high');
    expect(result.outputTokens).toBe(73);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = jest.mocked(global.fetch).mock.calls[0];
    expect(url).toBe('https://senku.scheimann.workers.dev/v1/profiles/kaseki_run_evaluation_v1/evaluate');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: '1',
      input: {
        state: {
          status: 'completed',
          task_mode: 'inspect',
          validation_status: 'passed',
          summary: 'Synthetic profile smoke; no repository task was run.',
        },
        includeFailureDiagnosis: false,
      },
    });
  });

  it('skips the opt-in check when the Senku credential is unavailable', async () => {
    delete process.env.SENKU_KASEKI_API_TOKEN;
    delete process.env.SENKU_KASEKI_API_TOKEN_FILE;
    process.env.KASEKI_SECRETS_DIR = '/synthetic/kaseki-no-secrets';
    process.env.HOME = '';

    const result = await testClassificationSmoke(true);

    expect(result.status).toBe('skipped');
    expect(result.detail).toMatch(/Senku decision credentials are not configured/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps authentication errors to safe operator guidance without leaking the body', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'UNAUTHENTICATED', message: 'token=private-provider-detail', requestId: 'dec-auth-failed' },
    }), { status: 401 }));

    const result = await testClassificationSmoke(true);

    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(401);
    expect(result.detail).toContain('Senku rejected');
    expect(JSON.stringify(result)).not.toContain('private-provider-detail');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('maps network errors without retrying or exposing raw error text', async () => {
    global.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error('private DNS detail'));

    const result = await testClassificationSmoke(true);

    expect(result.status).toBe('error');
    expect(result.detail).toContain('unavailable');
    expect(result.remediation).toMatch(/DNS.*outbound HTTPS.*firewall/i);
    expect(JSON.stringify(result)).not.toContain('private DNS detail');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports malformed Senku responses as invalid assessments', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(smokeResponse({ answers: {} }));

    const result = await testClassificationSmoke(true);

    expect(result.status).toBe('error');
    expect(result.detail).toMatch(/invalid response/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
