import { buildTaskAdmissionRequest, evaluateTaskAdmission } from './task-admission';

describe('task admission classifier', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    delete process.env.KASEKI_CLASSIFICATION_MODEL;
  });

  it('redacts secrets and uses independent typed safety questions', () => {
    const request = buildTaskAdmissionRequest({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Use api_key=sk-test-secret-value to update the service',
      validationCommands: ['echo token=abc123'],
    });

    expect(request.questions).toEqual(expect.objectContaining({
      contains_credentials: expect.objectContaining({ type: 'noul' }),
      changes_permissions: expect.objectContaining({ type: 'noul' }),
      crosses_security_boundary: expect.objectContaining({ type: 'noul' }),
      risk_score: expect.objectContaining({ type: 'score', min: 0, max: 2 }),
    }));
    expect(String(request.state)).not.toContain('sk-test-secret-value');
    expect(String(request.state)).toContain('[REDACTED_SECRET]');
  });

  it('rejects obvious credential-like task content locally without calling the classifier', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Commit this token=sk-obviously-a-secret-value to the repository',
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('rejected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects high-confidence unsafe classifier answers', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: '~typesafe/jev-latest',
        answers: {
          contains_credentials: { type: 'noul', answer: false, confidence: 0.99 },
          changes_permissions: { type: 'noul', answer: true, confidence: 0.95 },
          crosses_security_boundary: { type: 'noul', answer: false, confidence: 0.9 },
          risk_score: { type: 'score', answer: 1, confidence: 0.9 },
        },
        usage: { output_tokens: 12 },
      }),
    } as Response);

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Update the access policy for the deployment role',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('changes_permissions');
    expect(result.outputTokens).toBe(12);
  });

  it('fails open when the classifier is unavailable', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('network timeout')) as typeof fetch;

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Update the README wording',
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe('degraded');
    expect(result.degraded).toBe(true);
  });

  it('allows low-confidence classifications with an explicit warning', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answers: {
          contains_credentials: { type: 'noul', answer: true, confidence: 0.4 },
          changes_permissions: { type: 'noul', answer: false, confidence: 0.95 },
          crosses_security_boundary: { type: 'noul', answer: false, confidence: 0.95 },
          risk_score: { type: 'score', answer: 1, confidence: 0.4 },
        },
      }),
    } as Response);

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Review this ambiguous change',
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe('allowed');
    expect(result.warnings?.[0]).toContain('contains_credentials');
  });
});
