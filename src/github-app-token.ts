#!/usr/bin/env node

/**
 * github-app-token.ts - Generate GitHub App installation access tokens
 *
 * Usage:
 *   node dist/github-app-token.js <app-id> <private-key-file> <owner> <repo>
 *
 * Outputs JSON:
 *   {
 *     "token": "ghu_...",
 *     "expires_at": "2026-04-26T...",
 *     "error": "..." (if failed)
 *   }
 */

import fs from 'fs';
import crypto from 'crypto';
import https from 'https';

interface JWTHeader {
  alg: string;
  typ: string;
}

interface JWTPayload {
  iss: string;
  iat: number;
  exp: number;
}

interface InstallationIdResponse {
  id: number;
  [key: string]: any;
}

interface AccessTokenResponse {
  token: string;
  expires_at: string;
  [key: string]: any;
}

interface TokenResult {
  token?: string;
  expires_at?: string;
  error?: string;
}

const APP_ID = process.argv[2];
const PRIVATE_KEY_FILE = process.argv[3];
const OWNER = process.argv[4];
const REPO = process.argv[5];

function hasPrivateKeyPemHeader(value: string): boolean {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value);
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

function rejectUnsupportedPrivateKeyFormat(value: string): void {
  if (value.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) {
    throw new Error(
      'GitHub App private key uses OpenSSH format. GitHub App keys must be the PEM downloaded from GitHub App settings.'
    );
  }

  if (value.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
    throw new Error(
      'GitHub App private key is encrypted. Encrypted keys are not supported unless passphrase support is added.'
    );
  }

  if (/-----BEGIN [^-]*(PUBLIC KEY|CERTIFICATE)-----/.test(value)) {
    throw new Error(
      'GitHub App private key file contains a public key or certificate; this is not the GitHub App private key.'
    );
  }
}

function normalizePrivateKeyValue(value: string): string {
  return removeMatchingOuterQuotes(
    value.replace(/^\uFEFF/, '').trim().replace(/\\n/g, '\n')
  );
}

function loadAndValidatePrivateKey(privateKeyFile: string): crypto.KeyObject {
  let normalizedPem = normalizePrivateKeyValue(
    fs.readFileSync(privateKeyFile, 'utf8')
  );

  if (!hasPrivateKeyPemHeader(normalizedPem) && looksLikeBase64(normalizedPem)) {
    const decodedPem = Buffer.from(
      normalizedPem.replace(/\s+/g, ''),
      'base64'
    ).toString('utf8');
    if (
      hasPrivateKeyPemHeader(decodedPem) ||
      /-----BEGIN [^-]+-----/.test(decodedPem)
    ) {
      normalizedPem = normalizePrivateKeyValue(decodedPem);
    }
  }

  rejectUnsupportedPrivateKeyFormat(normalizedPem);

  if (!hasPrivateKeyPemHeader(normalizedPem)) {
    throw new Error(
      'GitHub App private key file does not contain a private-key PEM header after normalization/base64 decode. Expected -----BEGIN ... PRIVATE KEY-----.'
    );
  }

  try {
    return crypto.createPrivateKey(normalizedPem);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `GitHub App private key is not a valid PEM private key: ${message.replace(/\s+/g, ' ').trim()}`
    );
  }
}

async function generateJWT(appId: string, privateKey: crypto.KeyObject): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = now - 60; // account for clock skew
  const exp = now + 10 * 60; // 10 minutes

  const header: JWTHeader = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload: JWTPayload = {
    iss: appId,
    iat,
    exp,
  };

  const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const message = `${headerBase64}.${payloadBase64}`;

  // Sign with RSA-SHA256
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message);
  signer.end();

  const signature = signer.sign(privateKey, 'base64url');
  return `${message}.${signature}`;
}

async function getInstallationId(jwt: string, owner: string, repo: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/installation`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github.machine-man-preview+json',
        'User-Agent': 'Kaseki-Agent',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(
            new Error(
              `Failed to get installation ID: ${res.statusCode} ${data}`
            )
          );
        } else {
          try {
            const json: InstallationIdResponse = JSON.parse(data);
            resolve(json.id);
          } catch (e) {
            reject(
              new Error(
                `Failed to parse installation response: ${
                  e instanceof Error ? e.message : String(e)
                }`
              )
            );
          }
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function getAccessToken(
  jwt: string,
  installationId: number
): Promise<AccessTokenResponse> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/app/installations/${installationId}/access_tokens`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github.machine-man-preview+json',
        'User-Agent': 'Kaseki-Agent',
        'Content-Length': '0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 201) {
          reject(
            new Error(`Failed to get access token: ${res.statusCode} ${data}`)
          );
        } else {
          try {
            const json: AccessTokenResponse = JSON.parse(data);
            resolve({
              token: json.token,
              expires_at: json.expires_at,
            });
          } catch (e) {
            reject(
              new Error(
                `Failed to parse token response: ${
                  e instanceof Error ? e.message : String(e)
                }`
              )
            );
          }
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main(): Promise<void> {
  if (!APP_ID || !PRIVATE_KEY_FILE || !OWNER || !REPO) {
    console.error(
      'Usage: node github-app-token.js <app-id> <private-key-file> <owner> <repo>'
    );
    process.exit(1);
  }

  try {
    // Read and validate private key
    const privateKey = loadAndValidatePrivateKey(PRIVATE_KEY_FILE);

    // Generate JWT
    const jwt = await generateJWT(APP_ID, privateKey);

    // Get installation ID
    const installationId = await getInstallationId(jwt, OWNER, REPO);

    // Get access token
    const tokenData = await getAccessToken(jwt, installationId);

    // Output result as JSON
    console.log(JSON.stringify(tokenData));
  } catch (error) {
    // Output error as JSON
    const result: TokenResult = {
      error: error instanceof Error ? error.message : String(error),
    };
    console.log(JSON.stringify(result));
    process.exit(1);
  }
}

main();
