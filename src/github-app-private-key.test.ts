import crypto from 'crypto';

import {
  normalizeGitHubAppPrivateKey,
  validateGitHubAppPrivateKey,
} from './github-app-private-key';

function generateRsaPrivateKeyPem(): string {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
}

function generateRsaPublicKeyPem(): string {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

describe('normalizeGitHubAppPrivateKey', () => {
  test('rewraps single-line RSA PEM with spaces between header, body, and footer', () => {
    const pem = generateRsaPrivateKeyPem();
    const singleLinePem = pem.trim().replace(/\n/g, ' ');

    expect(normalizeGitHubAppPrivateKey(singleLinePem)).toBe(pem);
    expect(validateGitHubAppPrivateKey(singleLinePem)).toEqual({
      ok: true,
      normalized: pem,
    });
  });

  test('normalizes escaped-newline PEM', () => {
    const pem = generateRsaPrivateKeyPem();
    const escapedNewlinePem = pem.trim().replace(/\n/g, '\\n');

    expect(normalizeGitHubAppPrivateKey(escapedNewlinePem)).toBe(pem);
    expect(validateGitHubAppPrivateKey(escapedNewlinePem)).toEqual({
      ok: true,
      normalized: pem,
    });
  });

  test('normalizes base64-encoded PEM', () => {
    const pem = generateRsaPrivateKeyPem();
    const encodedPem = Buffer.from(pem, 'utf8').toString('base64');

    expect(normalizeGitHubAppPrivateKey(encodedPem)).toBe(pem);
    expect(validateGitHubAppPrivateKey(encodedPem)).toEqual({
      ok: true,
      normalized: pem,
    });
  });
});

describe('validateGitHubAppPrivateKey', () => {
  test('rejects malformed private-key-looking input after normalization', () => {
    const malformedPrivateKey = '-----BEGIN RSA PRIVATE KEY----- not-real-key-material -----END RSA PRIVATE KEY-----';

    const result = validateGitHubAppPrivateKey(malformedPrivateKey);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not a valid PEM private key');
    expect(result.error).not.toContain('not-real-key-material');
  });

  test('rejects public key and certificate inputs', () => {
    const publicKey = generateRsaPublicKeyPem();
    const certificate = '-----BEGIN CERTIFICATE-----\nnot-real-certificate\n-----END CERTIFICATE-----\n';

    expect(validateGitHubAppPrivateKey(publicKey)).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('public key or certificate'),
    }));
    expect(validateGitHubAppPrivateKey(certificate)).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('public key or certificate'),
    }));
  });
});
