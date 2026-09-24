import { redactJevEvidence } from './jev-evidence-redaction';

describe('JEV evidence redaction', () => {
  test('redacts authorization headers, authenticated URLs, cloud keys, and JWTs', () => {
    const input = {
      validation: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      remote: 'https://build-user:private-password@example.invalid/repo.git',
      cloud: 'AWS_ACCESS_KEY_ID=AKIA1234567890123456',
    };
    const redacted = JSON.stringify(redactJevEvidence(input));

    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9.payload.signature');
    expect(redacted).not.toContain('private-password');
    expect(redacted).not.toContain('AKIA1234567890123456');
    expect(redacted).toContain('[REDACTED_CREDENTIAL]');
  });

  test('redacts nested secret fields and common key-value credentials', () => {
    const redacted = redactJevEvidence({ nested: { api_key: 'plain-value' }, log: 'token=plain-token' });
    expect(redacted).toEqual({ nested: { api_key: '[REDACTED_SECRET]' }, log: 'token=[REDACTED_SECRET]' });
  });
});
