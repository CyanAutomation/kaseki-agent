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
      risk_level: expect.objectContaining({ type: 'choice', criteria: expect.objectContaining({ high: expect.any(String) }) }),
      task_type: expect.objectContaining({ type: 'choice', criteria: expect.objectContaining({ bug_fix: expect.any(String) }) }),
      validation_focus: expect.objectContaining({ type: 'choice', criteria: expect.objectContaining({ type_and_lint: expect.any(String) }) }),
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
          contains_credentials: { type: 'noul', noul: 0.01 },
          changes_permissions: { type: 'noul', noul: 0.95 },
          crosses_security_boundary: { type: 'noul', noul: 0.1 },
          risk_level: { type: 'choice', choice: 'review', probabilities: { low: 0.05, review: 0.9, high: 0.05 }, confidence: 0.9 },
          task_type: { type: 'choice', choice: 'bug_fix', probabilities: { feature: 0, bug_fix: 1, refactor: 0, documentation: 0, investigation: 0, test_only: 0, infrastructure: 0 }, confidence: 1 },
          validation_focus: { type: 'choice', choice: 'type_and_lint', probabilities: { unit_tests: 0, integration_tests: 0, type_and_lint: 1, docs_checks: 0, repo_defined_checks: 0 }, confidence: 1 },
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
          contains_credentials: { type: 'noul', noul: 0.5 },
          changes_permissions: { type: 'noul', noul: 0.1 },
          crosses_security_boundary: { type: 'noul', noul: 0.1 },
          risk_level: { type: 'choice', choice: 'review', probabilities: { low: 0.3, review: 0.4, high: 0.3 }, confidence: 0.4 },
          task_type: { type: 'choice', choice: 'investigation', probabilities: { feature: 0.2, bug_fix: 0.2, refactor: 0.2, documentation: 0.1, investigation: 0.2, test_only: 0.05, infrastructure: 0.05 }, confidence: 0.2 },
          validation_focus: { type: 'choice', choice: 'repo_defined_checks', probabilities: { unit_tests: 0.2, integration_tests: 0.2, type_and_lint: 0.2, docs_checks: 0.2, repo_defined_checks: 0.2 }, confidence: 0.2 },
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
    expect(result.routingHints).toBeUndefined();
  });

  it('returns high-confidence task and validation hints as nonbinding routing metadata', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answers: {
          contains_credentials: { type: 'noul', noul: 0.01 },
          changes_permissions: { type: 'noul', noul: 0.01 },
          crosses_security_boundary: { type: 'noul', noul: 0.01 },
          risk_level: { type: 'choice', choice: 'low', probabilities: { low: 0.95, review: 0.05, high: 0 }, confidence: 0.95 },
          task_type: { type: 'choice', choice: 'documentation', probabilities: { feature: 0, bug_fix: 0, refactor: 0, documentation: 0.95, investigation: 0.05, test_only: 0, infrastructure: 0 }, confidence: 0.95 },
          validation_focus: { type: 'choice', choice: 'docs_checks', probabilities: { unit_tests: 0, integration_tests: 0, type_and_lint: 0.05, docs_checks: 0.95, repo_defined_checks: 0 }, confidence: 0.95 },
        },
      }),
    } as Response);

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Update the documentation for the install flow',
      validationCommands: ['npm run docs:check'],
    });

    expect(result.allowed).toBe(true);
    expect(result.routingHints).toEqual({ taskType: 'documentation', validationFocus: 'docs_checks' });
    expect(result.answers?.risk_level).toMatchObject({ choice: 'low' });
  });
});
