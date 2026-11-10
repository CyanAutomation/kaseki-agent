import { testClassificationSmoke } from './kaseki-api-gateway-smoke';

const TOKEN = 'synthetic-senku-kaseki-token-value-1234567890';

function smokeResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    schemaVersion: '1',
    requestId: 'dec-smoke-test',
    status: 'completed',
    provider: 'jev',
    model: 'typesafe/jev-resolved-test',
    answers: {
      code_quality_issue: {
        type: 'noul', noul: 0.96,
        probabilities: { false: 0.04, true: 0.96 }, confidence: null,
      },
      requires_human_review: {
        type: 'choice', choice: 'yes', confidence: 0.94,
        probabilities: { yes: 0.94, no: 0.04, maybe: 0.02 },
      },
      fix_risk_level: {
        type: 'score', score: 1, confidence: 0.92,
        probabilities: { 0: 0.03, 1: 0.92, 2: 0.05 },
        legend: { 0: 'Low risk', 1: 'Medium risk', 2: 'High risk' },
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
    'NODE_ENV', 'SENKU_URL', 'SENKU_KASEKI_API_TOKEN', 'SENKU_KASEKI_API_TOKEN_FILE', 'KASEKI_SECRETS_DIR',
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

  it('calls Senku once and validates the returned typed answers', async () => {
    const result = await testClassificationSmoke(true);
    expect(result.status).toBe('ok');
    expect(result.evaluationValidated).toBe(true);
    expect(result.confidenceLevel).toBe('high');
    expect(result.outputTokens).toBe(73);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = jest.mocked(global.fetch).mock.calls[0];
    expect(url).toBe('https://senku.scheimann.workers.dev/v1/decisions');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('model');
  });

  it('skips the opt-in check when the Senku credential is unavailable', async () => {
    delete process.env.SENKU_KASEKI_API_TOKEN;
    process.env.SENKU_KASEKI_API_TOKEN_FILE = '/missing/senku-token';

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
