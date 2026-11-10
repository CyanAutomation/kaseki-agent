import { classifyWithJev, hasRetiredDecisionSettings, JevClassificationError } from './jev-classifier';

describe('JEV compatibility shim', () => {
  const token = 'synthetic-senku-kaseki-token-value-1234567890';

  it('delegates to Senku once and ignores legacy model and retry options', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: '1',
      requestId: 'dec-compat-test',
      status: 'completed',
      provider: 'jev',
      model: 'typesafe/jev-resolved-test',
      answers: {
        safe: {
          type: 'noul', noul: 0.98,
          probabilities: { false: 0.02, true: 0.98 }, confidence: null,
        },
      },
      durationMs: 1,
      attemptCount: 1,
    }), { status: 200 }));

    const result = await classifyWithJev('state', {
      safe: { type: 'noul', instructions: 'Is it safe?' },
    }, {
      env: {
        NODE_ENV: 'test',
        SENKU_URL: 'https://senku.example.test',
        SENKU_KASEKI_API_TOKEN: token,
      },
      fetchImpl,
      model: 'legacy-model',
      maxRetries: 8,
    });

    expect(result.model).toBe('typesafe/jev-resolved-test');
    expect(result.answers.safe).toMatchObject({ noul: 0.98, confidence: null });
    expect(result.attemptCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('detects retired model and direct-provider settings', () => {
    expect(hasRetiredDecisionSettings({ KASEKI_DECISION_MODEL: 'old/model' })).toBe(true);
    expect(hasRetiredDecisionSettings({ KASEKI_CLASSIFICATION_MODEL: 'old/model' })).toBe(true);
    expect(hasRetiredDecisionSettings({ KASEKI_JEV_API_KEY_FILE: '/old/key' })).toBe(true);
    expect(hasRetiredDecisionSettings({})).toBe(false);
  });

  it('keeps the deprecated error name while exposing only safe error metadata', () => {
    const error = new JevClassificationError('network', 'private request evidence', 502, 'dec-safe');
    expect(error).toMatchObject({ category: 'network', status: 502, requestId: 'dec-safe' });
    expect(error.message).not.toContain('private request evidence');
  });
});
