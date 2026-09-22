import * as classificationModule from './kaseki-api-gateway-smoke';
import type { ClassificationAnswer } from './types/openrouter-decisions';

describe('testClassificationSmoke (mocked)', () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    process.env.OPENROUTER_API_KEY = 'sk-test-key-mock';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OPENROUTER_API_KEY;
  });

  it('should return skipped when OPENROUTER_API_KEY not configured', async () => {
    /**
     * In Kaseki Agent, the gateway should short-circuit before hitting OpenRouter when
     * no API key is available so CI/CD jobs can report a skipped smoke test instead of a noise failure.
     */
    delete process.env.OPENROUTER_API_KEY;

    const result = await classificationModule.testClassificationSmoke(true);

    expect(result.status).toBe('skipped');
    expect(result.detail).toMatch(/not configured/i);
  });

  it('should successfully classify code review scenario (mocked)', async () => {
    /**
     * In Kaseki Agent, code review and triage scenarios are expected to be recognized as
     * relevant Kaseki content when the LLM returns a confident decision set.
     */
    const mockResponse = {
      model: '~typesafe/jev-latest',
      answers: {
        code_quality_issue: {
          type: 'noul',
          noul: 0.96,
        } as ClassificationAnswer,
        requires_human_review: {
          type: 'choice',
          choice: 'yes',
          confidence: 0.94,
          probabilities: { yes: 0.94, no: 0.04, maybe: 0.02 },
        } as ClassificationAnswer,
        fix_risk_level: {
          type: 'score',
          score: 1,
          confidence: 0.92,
          probabilities: { '0': 0.03, '1': 0.92, '2': 0.05 },
          legend: { '0': 'Low risk', '1': 'Medium risk', '2': 'High risk' },
        } as ClassificationAnswer,
      },
      usage: {
        input_tokens: 427,
        output_tokens: 73,
        total_tokens: 500,
      },
      id: 'gen-123-mock',
      provider: 'OpenRouter',
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
      headers: new Headers(),
      redirected: false,
      statusText: 'OK',
      type: 'basic',
      url: 'https://openrouter.ai/api/alpha/decisions',
      clone: () => ({} as any),
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const result = await classificationModule.testClassificationSmoke(true);

    expect(result.status).toBe('ok');
    expect(result.classificationValidated).toBe(true);
    expect(result.confidenceLevel).toBe('high');
    expect(result.modelUsed).toBeTruthy();
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.detail).toBeTruthy();
  });

  it('should handle low-confidence classifications (mocked)', async () => {
    /**
     * In Kaseki Agent, a low-confidence decision should not be treated as validated because
     * it can incorrectly route or skip important review tasks.
     */
    const mockResponse = {
      model: '~typesafe/jev-latest',
      answers: {
        code_quality_issue: {
          type: 'noul',
          noul: 0.96,
        } as ClassificationAnswer,
        requires_human_review: {
          type: 'choice',
          choice: 'yes',
          confidence: 0.70, // Below threshold
          probabilities: { yes: 0.70, no: 0.20, maybe: 0.10 },
        } as ClassificationAnswer,
        fix_risk_level: {
          type: 'score',
          score: 1,
          legend: { '0': 'Low risk', '1': 'Medium risk', '2': 'High risk' },
          confidence: 0.91,
          probabilities: { '0': 0.03, '1': 0.91, '2': 0.06 },
        } as ClassificationAnswer,
      },
      usage: { input_tokens: 427, output_tokens: 73, total_tokens: 500 },
      id: 'gen-124-mock',
      provider: 'OpenRouter',
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
      headers: new Headers(),
      redirected: false,
      statusText: 'OK',
      type: 'basic',
      url: 'https://openrouter.ai/api/alpha/decisions',
      clone: () => ({} as any),
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
    } as Response);

    const result = await classificationModule.testClassificationSmoke(true);

    expect(result.status).toBe('ok');
    expect(result.classificationValidated).toBe(false);
    expect(['medium', 'low']).toContain(result.confidenceLevel);
    expect(result.confidenceDetails).toBeDefined();
    expect(result.confidenceDetails?.failedQuestions).toContain('requires_human_review');
  });

  it('should handle network errors gracefully', async () => {
    /**
     * In Kaseki Agent, network failures should surface a useful remediation message instead
     * of failing the smoke test without context.
     */
    mockFetch.mockRejectedValue(new Error('fetch failed: network timeout'));

    const result = await classificationModule.testClassificationSmoke(true);

    expect(result.status).toBe('error');
    expect(result.detail.toLowerCase()).toContain('error');
    expect(result.remediation).toBeTruthy();
  });

  it('should handle invalid response structure', async () => {
    /**
     * In Kaseki Agent, malformed OpenRouter payloads should be caught early so the gateway
     * can fail with a clear message instead of silently misclassifying work.
     */
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'gen-125',
        model: '~typesafe/jev-latest',
        // Missing 'answers' field
      }),
      text: async () => '{}',
      headers: new Headers(),
      redirected: false,
      statusText: 'OK',
      type: 'basic',
      url: 'https://openrouter.ai/api/alpha/decisions',
      clone: () => ({} as any),
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
    } as Response);

    const result = await classificationModule.testClassificationSmoke(true);

    expect(result.status).toBe('error');
    expect(result.detail.toLowerCase()).toMatch(/answers|invalid|response|missing/);
  });

  it('should handle API provider errors (non-200 response)', async () => {
    /**
     * In Kaseki Agent, provider rate limits and upstream failures should remain visible to
     * operators during smoke validation without obscuring the root cause.
     */
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({
        error: {
          message: 'Rate limit exceeded for OpenRouter',
        },
      }),
      text: async () => 'Rate limit exceeded',
      headers: new Headers(),
      redirected: false,
      type: 'basic',
      url: 'https://openrouter.ai/api/alpha/decisions',
      clone: () => ({} as any),
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
    } as Response);

    const result = await classificationModule.testClassificationSmoke(true);

    expect(result.status).toBe('error');
    expect(result.detail.toLowerCase()).toMatch(/429|rate|limit|provider|error/);
  });
});

describe.skip('testClassificationSmoke (real API)', () => {
  /**
   * Manual validation only. Use .only() to run these tests locally against the live
   * OpenRouter decisions endpoint when an API key is available in the environment.
   *
   * Command: npm test -- --testNamePattern="real API" --runInBand
   */

  it('should classify kaseki-relevant code scenario (real)', async () => {
    if (!process.env.OPENROUTER_API_KEY) {
      console.log('Skipping real API test: OPENROUTER_API_KEY not set');
      return;
    }

    const result = await classificationModule.testClassificationSmoke(true);

    expect(result.status).toMatch(/ok|error/); // Allow both for real test
    expect(result).toHaveProperty('classificationValidated');
    expect(result).toHaveProperty('confidenceLevel');
    expect(result).toHaveProperty('modelUsed');
    expect(result).toHaveProperty('outputTokens');
    expect(result).toHaveProperty('responseTime');
  });

  it('should have proper token tracking (real)', async () => {
    if (!process.env.OPENROUTER_API_KEY) {
      console.log('Skipping real API test: OPENROUTER_API_KEY not set');
      return;
    }

    const started = Date.now();
    const result = await classificationModule.testClassificationSmoke(true);
    const elapsedMs = Date.now() - started;

    expect(result.status).toMatch(/ok|error/);
    if (result.outputTokens) {
      expect(result.outputTokens).toBeGreaterThan(0);
    }
    expect(result.responseTime).toBeLessThan(30000);
    expect(elapsedMs).toBeLessThan(30000);
  });
});
