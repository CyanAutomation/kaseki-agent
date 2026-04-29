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

async function generateJWT(appId: string, privateKey: string): Promise<string> {
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
    // Read private key
    const privateKey = fs.readFileSync(PRIVATE_KEY_FILE, 'utf8');

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
