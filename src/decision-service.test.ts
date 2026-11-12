import { decisionFailureMetadata, DecisionServiceError, SenkuDecisionService } from './decision-service';

const TOKEN = 'synthetic-senku-kaseki-token-value-1234567890';

function response() {
  const answers = {
    contains_credentials: {
      type: 'noul', noul: 0.01, probabilities: { false: 0.99, true: 0.01 }, confidence: null,
    },
    changes_permissions: {
      type: 'noul', noul: 0.01, probabilities: { false: 0.99, true: 0.01 }, confidence: null,
    },
    crosses_security_boundary: {
      type: 'noul', noul: 0.01, probabilities: { false: 0.99, true: 0.01 }, confidence: null,
    },
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
  return new Response(JSON.stringify({
    schemaVersion: '1',
    requestId: 'dec-service-test',
    status: 'completed',
    profileId: 'task_admission_v1',
    profileVersion: '1',
    provider: 'jev',
    model: 'typesafe/jev-resolved-test',
    answers,
    result: answers,
    usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
    durationMs: 12,
    attemptCount: 1,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Senku DecisionService', () => {
  it('uses Senku as its only provider and returns typed answer metadata', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(response());
    const service = new SenkuDecisionService({
      fetchImpl,
      readFile: () => TOKEN,
      env: {
        NODE_ENV: 'test',
        SENKU_URL: 'https://senku.example.test',
        SENKU_KASEKI_API_TOKEN_FILE: '/synthetic/senku-token',
      },
    });

    await expect(service.evaluateProfile({
      profileId: 'task_admission_v1',
      input: { taskPrompt: 'Update the README wording' },
    })).resolves.toMatchObject({
      provider: 'senku',
      model: 'typesafe/jev-resolved-test',
      answers: { task_type: { type: 'choice', choice: 'documentation' } },
      usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
      attemptCount: 1,
    });

    expect(service.providerId).toBe('senku');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://senku.example.test/v1/profiles/task_admission_v1/evaluate');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: '1', input: { taskPrompt: 'Update the README wording' },
    });
  });

  it('normalizes decision failure metadata without retaining error text', () => {
    const timeout = new DecisionServiceError('timeout', { attemptCount: 1, httpStatus: 504, requestId: 'dec-timeout' });
    expect(decisionFailureMetadata(timeout)).toEqual({
      code: 'timeout', attemptCount: 1, httpStatus: 504, requestId: 'dec-timeout',
    });
    expect(decisionFailureMetadata(new Error('private state content'))).toEqual({ code: 'provider_failure' });
  });

  it('exposes only a safe message for service failures', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'UNAUTHENTICATED', message: 'private provider response', requestId: 'dec-unauth' },
    }), { status: 401 }));
    const service = new SenkuDecisionService({
      fetchImpl,
      readFile: () => TOKEN,
      env: { NODE_ENV: 'test', SENKU_KASEKI_API_TOKEN_FILE: '/synthetic/senku-token' },
    });

    const error = await service.evaluateProfile({
      profileId: 'task_admission_v1',
      input: { taskPrompt: 'private evidence' },
    }).then(() => undefined, (caught: unknown) => caught as DecisionServiceError);
    expect(error).toMatchObject({ category: 'credentials', httpStatus: 401, requestId: 'dec-unauth' });
    expect(error.message).not.toContain('private evidence');
    expect(error.message).not.toContain('private provider response');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
