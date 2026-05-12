import crypto from 'crypto';

import {
  normalizeGitHubAppPrivateKey,
  validateGitHubAppPrivateKey,
} from './github-app-private-key';

function generateRsaPrivateKeyPem(): string {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
}

function generateRsaPublicKeyPem(): string {
  const { publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

function buildValidPemVariants(pem: string): Record<string, string> {
  return {
    'proper multiline PEM': pem,
    'single-line PEM with spaces': pem.trim().replace(/\n/g, ' '),
    'PEM with escaped newlines': pem.trim().replace(/\n/g, '\\n'),
    'base64-encoded PEM': Buffer.from(pem, 'utf8').toString('base64'),
  };
}

describe('normalizeGitHubAppPrivateKey', () => {
  test('normalizes a single-line RSA PEM to newline-separated header, body, and footer', () => {
    const pem = generateRsaPrivateKeyPem();
    const singleLinePem = buildValidPemVariants(pem)['single-line PEM with spaces'];

    const normalized = normalizeGitHubAppPrivateKey(singleLinePem);
    const normalizedLines = normalized.trim().split('\n');

    expect(normalized).toBe(pem);
    expect(normalizedLines[0]).toBe('-----BEGIN RSA PRIVATE KEY-----');
    expect(normalizedLines.at(-1)).toBe('-----END RSA PRIVATE KEY-----');
    expect(normalizedLines.slice(1, -1)).toHaveLength(
      pem.trim().split('\n').length - 2
    );
    expect(normalizedLines.slice(1, -1).every((line) => line.length > 0)).toBe(
      true
    );
  });
});

describe('validateGitHubAppPrivateKey', () => {
  test.each(Object.entries(buildValidPemVariants(generateRsaPrivateKeyPem())))(
    'accepts %s',
    (_name, variant) => {
      const result = validateGitHubAppPrivateKey(variant);

      expect(result).toEqual({
        ok: true,
        normalized: expect.stringContaining(
          '-----BEGIN RSA PRIVATE KEY-----\n'
        ),
      });
      expect(result.normalized).toContain('\n-----END RSA PRIVATE KEY-----\n');
    }
  );

  test('rejects malformed private-key-looking input after normalization', () => {
    const malformedPrivateKey = '-----BEGIN RSA PRIVATE KEY----- not-real-key-material -----END RSA PRIVATE KEY-----';

    const result = validateGitHubAppPrivateKey(malformedPrivateKey);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not a valid PEM private key');
    expect(result.error).not.toContain('not-real-key-material');
  });

  test('rejects public key input', () => {
    const publicKey = generateRsaPublicKeyPem();

    expect(validateGitHubAppPrivateKey(publicKey)).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('public key or certificate'),
    }));
  });

  test('rejects certificate input', () => {
    const certificate = '-----BEGIN CERTIFICATE-----\nnot-real-certificate\n-----END CERTIFICATE-----\n';

    expect(validateGitHubAppPrivateKey(certificate)).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining('public key or certificate'),
      })
    );
  });

  test('rejects OpenSSH private-key input', () => {
    const openSshKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\n';

    expect(validateGitHubAppPrivateKey(openSshKey)).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining('OpenSSH format'),
      })
    );
  });

  test('rejects encrypted private-key input', () => {
    const encryptedKey = '-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIFHDBOBgkqhkiG9w0BBQ0wQTApBgkq\n-----END ENCRYPTED PRIVATE KEY-----\n';

    expect(validateGitHubAppPrivateKey(encryptedKey)).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining('is encrypted'),
      })
    );
  });
});
