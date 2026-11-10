import { buildTaskAdmissionRequest, evaluateTaskAdmission } from './task-admission';

const TOKEN = 'synthetic-senku-kaseki-token-value-1234567890';
const ENV_NAMES = [
  'NODE_ENV', 'SENKU_URL', 'SENKU_KASEKI_API_TOKEN', 'SENKU_KASEKI_API_TOKEN_FILE', 'KASEKI_SECRETS_DIR',
  'KASEKI_JEV_WORKFLOW', 'KASEKI_DECISION_MODEL', 'KASEKI_CLASSIFICATION_MODEL',
];

function answer(question: { type: string; criteria?: Record<string, unknown> | string[] }, choice?: string) {
  if (question.type === 'noul') {
    const noul = 0.01;
    return { type: 'noul', noul, probabilities: { false: 0.99, true: noul }, confidence: null };
  }
  const ids = question.type === 'score'
    ? (question.criteria as string[]).map((_, index) => String(index))
    : Object.keys(question.criteria ?? {});
  const selected = choice && ids.includes(choice) ? choice : ids[0];
  const probabilities = Object.fromEntries(ids.map((id) => [id, id === selected ? 1 : 0]));
  if (question.type === 'score') {
    const score = Number(selected);
    return { type: 'score', score, legend: Object.fromEntries(ids.map((id) => [id, (question.criteria as string[])[Number(id)]])), probabilities, confidence: 1 };
  }
  return { type: 'choice', choice: selected, probabilities, confidence: 0.99 };
}

function contractResponse(answers: Record<string, unknown>, usage?: Record<string, number>) {
  return new Response(JSON.stringify({
    schemaVersion: '1',
    requestId: 'dec-task-admission-test',
    status: 'completed',
    provider: 'jev',
    model: 'typesafe/jev-resolved-test',
    answers,
    ...(usage ? { usage } : {}),
    durationMs: 8,
    attemptCount: 1,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function fullAnswers(choices: Record<string, string> = {}) {
  const questions = buildTaskAdmissionRequest({ taskPrompt: 'test' }).questions as Record<string, { type: string; criteria?: Record<string, unknown> | string[] }>;
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, answer(question, choices[id])]));
}

describe('task admission classifier', () => {
  const originalFetch = global.fetch;
  const originalEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.SENKU_KASEKI_API_TOKEN = TOKEN;
    delete process.env.SENKU_KASEKI_API_TOKEN_FILE;
    delete process.env.KASEKI_SECRETS_DIR;
    delete process.env.SENKU_URL;
    delete process.env.KASEKI_JEV_WORKFLOW;
    delete process.env.KASEKI_DECISION_MODEL;
    delete process.env.KASEKI_CLASSIFICATION_MODEL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
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

  it('rejects obvious credential-like task content locally without calling Senku', async () => {
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

  it('rejects high-confidence unsafe classifier answers returned by Senku', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(contractResponse(fullAnswers({
      changes_permissions: 'true', risk_level: 'review', task_type: 'bug_fix', validation_focus: 'type_and_lint',
    }), { input_tokens: 20, output_tokens: 12, total_tokens: 32 })) as typeof fetch;

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Update the access policy for the deployment role',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('changes_permissions');
    expect(result.outputTokens).toBe(12);
    expect(result).not.toHaveProperty('modelUsed');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(jest.mocked(global.fetch).mock.calls[0][1]?.body))).not.toHaveProperty('model');
  });

  it('fails open when Senku is unavailable without exposing thrown network details', async () => {
    global.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error('private DNS diagnostics')) as typeof fetch;

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Update the README wording',
    });

    expect(result).toMatchObject({ allowed: true, status: 'degraded', degraded: true });
    expect(result.warnings?.join(' ')).toContain('network');
    expect(result.warnings?.join(' ')).not.toContain('private DNS diagnostics');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fails open with a migration notice when retired evaluation settings are present', async () => {
    process.env.KASEKI_JEV_WORKFLOW = '0';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    const result = await evaluateTaskAdmission({ repoUrl: 'https://github.com/example/repo', taskPrompt: 'Update the README wording' });

    expect(result).toMatchObject({ allowed: true, status: 'degraded', degraded: true });
    expect(result.reason).toContain('stage-based settings');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows low-confidence classifications with an explicit warning', async () => {
    const answers = fullAnswers({ risk_level: 'review', task_type: 'investigation', validation_focus: 'repo_defined_checks' }) as Record<string, Record<string, unknown>>;
    answers.contains_credentials.noul = 0.5;
    answers.contains_credentials.probabilities = { false: 0.5, true: 0.5 };
    answers.risk_level.confidence = 0.4;
    answers.task_type.confidence = 0.2;
    answers.validation_focus.confidence = 0.2;
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(contractResponse(answers)) as typeof fetch;

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Review this ambiguous change',
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe('allowed');
    expect(result.warnings?.[0]).toContain('contains_credentials');
    expect(result.warnings?.[0]).toContain('Task Admission evaluation confidence');
    expect(result.routingHints).toBeUndefined();
  });

  it('returns high-confidence task and validation hints as nonbinding routing metadata', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(contractResponse(fullAnswers({
      risk_level: 'low', task_type: 'documentation', validation_focus: 'docs_checks',
    }))) as typeof fetch;

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Update the documentation for the install flow',
      validationCommands: ['npm run docs:check'],
    });

    expect(result.allowed).toBe(true);
    expect(result.routingHints).toEqual({ taskType: 'documentation', validationFocus: 'docs_checks' });
    expect(result.answers?.risk_level).toMatchObject({ choice: 'low' });
  });

  it('treats null choice confidence as unavailable and emits no routing hints', async () => {
    const answers = fullAnswers({ risk_level: 'low', task_type: 'documentation', validation_focus: 'docs_checks' }) as Record<string, Record<string, unknown>>;
    answers.risk_level.confidence = null;
    answers.task_type.confidence = null;
    answers.validation_focus.confidence = null;
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(contractResponse(answers)) as typeof fetch;

    const result = await evaluateTaskAdmission({
      repoUrl: 'https://github.com/example/repo',
      taskPrompt: 'Update the docs',
    });

    expect(result.allowed).toBe(true);
    expect(result.routingHints).toBeUndefined();
    expect(result.warnings?.[0]).toContain('risk_level');
  });

  it('fails open when the Senku token is missing and makes no request', async () => {
    delete process.env.SENKU_KASEKI_API_TOKEN;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    const result = await evaluateTaskAdmission({ repoUrl: 'https://github.com/example/repo', taskPrompt: 'Improve docs' });

    expect(result).toMatchObject({ allowed: true, status: 'degraded', degraded: true });
    expect(result.warnings?.[0]).toContain('credentials are not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
