import crypto from 'crypto';

export interface GitHubAppPrivateKeyValidationResult {
  ok: boolean;
  normalized?: string;
  error?: string;
  remediation?: string;
}

const PRIVATE_KEY_HEADER_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const ANY_PEM_HEADER_PATTERN = /-----BEGIN [^-]+-----/;
const MAX_CRYPTO_ERROR_LENGTH = 240;

function hasPrivateKeyPemHeader(value: string): boolean {
  return PRIVATE_KEY_HEADER_PATTERN.test(value);
}

function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, '');
  return (
    compact.length > 0 &&
    compact.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  );
}

function removeMatchingOuterQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function normalizePrivateKeyText(value: string): string {
  return removeMatchingOuterQuotes(
    value.replace(/^\uFEFF/, '').trim().replace(/\\n/g, '\n')
  );
}

function rewrapPrivateKeyPem(value: string): string {
  return value.replace(
    /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/g,
    (_match, type: string, body: string) => {
      const compactBody = body.replace(/\s+/g, '');
      const bodyLines = compactBody.match(/.{1,64}/g) || [];
      return `-----BEGIN ${type}-----\n${bodyLines.join('\n')}\n-----END ${type}-----\n`;
    }
  );
}

function sanitizeCryptoError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = rawMessage.replace(/\s+/g, ' ').trim();
  if (normalizedMessage.length <= MAX_CRYPTO_ERROR_LENGTH) {
    return normalizedMessage;
  }

  return `${normalizedMessage.slice(0, MAX_CRYPTO_ERROR_LENGTH)}...`;
}

export function normalizeGitHubAppPrivateKey(value: string): string {
  let normalizedPem = rewrapPrivateKeyPem(normalizePrivateKeyText(value));

  if (!hasPrivateKeyPemHeader(normalizedPem) && looksLikeBase64(normalizedPem)) {
    const decodedPem = Buffer.from(
      normalizedPem.replace(/\s+/g, ''),
      'base64'
    ).toString('utf8');
    if (
      hasPrivateKeyPemHeader(decodedPem) ||
      ANY_PEM_HEADER_PATTERN.test(decodedPem)
    ) {
      normalizedPem = rewrapPrivateKeyPem(normalizePrivateKeyText(decodedPem));
    }
  }

  return normalizedPem;
}

export function validateGitHubAppPrivateKey(value: string): GitHubAppPrivateKeyValidationResult {
  const normalized = normalizeGitHubAppPrivateKey(value);

  if (normalized.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) {
    return {
      ok: false,
      error: 'GitHub App private key uses OpenSSH format. GitHub App keys must be the PEM downloaded from GitHub App settings.',
      remediation: 'Download a new private key from the GitHub App settings page and store that PEM content in the github_app_private_key secret file.',
    };
  }

  if (normalized.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
    return {
      ok: false,
      error: 'GitHub App private key is encrypted. Encrypted keys are not supported unless passphrase support is added.',
      remediation: 'Store an unencrypted GitHub App private key PEM in the github_app_private_key secret file.',
    };
  }

  if (/-----BEGIN [^-]*(PUBLIC KEY|CERTIFICATE)-----/.test(normalized)) {
    return {
      ok: false,
      error: 'GitHub App private key file contains a public key or certificate; this is not the GitHub App private key.',
      remediation: 'Replace github_app_private_key with the private-key PEM downloaded from GitHub App settings, not a public key or certificate.',
    };
  }

  if (!hasPrivateKeyPemHeader(normalized)) {
    return {
      ok: false,
      error: 'GitHub App private key file does not contain a private-key PEM header after normalization/base64 decode. Expected -----BEGIN ... PRIVATE KEY-----.',
      remediation: 'The github_app_private_key secret file must contain the complete PEM private key downloaded from GitHub App settings, including BEGIN and END lines.',
    };
  }

  try {
    crypto.createPrivateKey(normalized);
  } catch (error) {
    return {
      ok: false,
      error: `GitHub App private key is not a valid PEM private key: ${sanitizeCryptoError(error)}`,
      remediation: 'Regenerate the GitHub App private key in GitHub App settings and replace the github_app_private_key secret file with the complete downloaded PEM.',
    };
  }

  return {
    ok: true,
    normalized,
  };
}
