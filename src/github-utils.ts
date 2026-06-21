/**
 * GitHub API Utilities
 *
 * Provides helper functions for interacting with GitHub API:
 * - Token generation using GitHub App authentication
 * - URL parsing and validation
 * - Issue fetching with filtering
 */

import { KeyObject, createPrivateKey, createSign } from 'crypto';
import { request } from 'https';
import { validateGitHubAppPrivateKey } from './github-app-private-key';
import { readHostSecret } from './secrets/host-secrets-reader';
import { createLogger } from './logger';

const logger = createLogger('github-utils');
const GITHUB_API_TIMEOUT_MS = 15000;

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

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  url: string;
  created_at: string;
  state: string;
  labels: Array<{ name: string }>;
}

interface TokenResult {
  token?: string;
  expires_at?: string;
  error?: string;
}

interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  isValid: boolean;
  error?: string;
}

/**
 * Parse a GitHub URL and extract owner/repo
 * Accepts formats like:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - owner/repo (shorthand)
 */
export function parseGitHubUrl(urlOrShorthand: string): ParsedGitHubUrl {
  if (!urlOrShorthand || typeof urlOrShorthand !== 'string') {
    return {
      owner: '',
      repo: '',
      isValid: false,
      error: 'URL is required and must be a string',
    };
  }

  const trimmed = urlOrShorthand.trim();

  // Try shorthand format first (owner/repo)
  if (!trimmed.startsWith('http')) {
    const parts = trimmed.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return {
        owner: parts[0],
        repo: parts[1],
        isValid: true,
      };
    }
    return {
      owner: '',
      repo: '',
      isValid: false,
      error: 'Invalid shorthand format. Use "owner/repo" or full GitHub URL',
    };
  }

  // Parse full URL
  try {
    const url = new URL(trimmed);

    if (url.hostname !== 'github.com') {
      return {
        owner: '',
        repo: '',
        isValid: false,
        error: 'Only github.com URLs are supported',
      };
    }

    const parts = url.pathname.split('/').filter((p) => p);

    if (parts.length < 2) {
      return {
        owner: '',
        repo: '',
        isValid: false,
        error: 'URL must contain owner/repo path',
      };
    }

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, '');

    return {
      owner,
      repo,
      isValid: true,
    };
  } catch (e) {
    return {
      owner: '',
      repo: '',
      isValid: false,
      error: `Invalid URL: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Load and validate a GitHub App private key from disk
 */
function loadAndValidatePrivateKey(privateKeyContent: string): KeyObject {
  const validation = validateGitHubAppPrivateKey(privateKeyContent);

  if (!validation.ok || !validation.normalized) {
    const message = validation.remediation
      ? `${validation.error} ${validation.remediation}`
      : validation.error;
    throw new Error(message || 'GitHub App private key is not valid.');
  }

  return createPrivateKey(validation.normalized);
}

/**
 * Generate a JWT for GitHub App authentication
 */
async function generateJWT(appId: string, privateKey: KeyObject): Promise<string> {
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
  const signer = createSign('RSA-SHA256');
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

    let settled = false;
    const failOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk;
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
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

    req.setTimeout(GITHUB_API_TIMEOUT_MS, () => {
      req.destroy(new Error(`GitHub API request timed out after ${GITHUB_API_TIMEOUT_MS}ms while resolving installation`));
    });
    req.on('error', failOnce);
    req.end();
  });
}

/**
 * Get a GitHub App installation access token
 */
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

    let settled = false;
    const failOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk;
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
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

    req.setTimeout(GITHUB_API_TIMEOUT_MS, () => {
      req.destroy(new Error(`GitHub API request timed out after ${GITHUB_API_TIMEOUT_MS}ms while creating access token`));
    });
    req.on('error', failOnce);
    req.end();
  });
}

/**
 * Generate a GitHub App access token
 *
 * Loads GitHub App credentials from host secrets:
 * - github_app_id
 * - github_app_private_key
 *
 * Returns token, expires_at, and error fields
 */
export async function generateGitHubAppToken(
  owner: string,
  repo: string,
  overrideAppId?: string,
  overridePrivateKey?: string
): Promise<TokenResult> {
  try {
    const appId = overrideAppId || readHostSecret('github_app_id');
    if (!appId) {
      return {
        error: 'GitHub App ID not found. Configure GITHUB_APP_ID_FILE or .kaseki/secrets/github_app_id',
      };
    }

    const privateKeyContent = overridePrivateKey || readHostSecret('github_app_private_key');
    if (!privateKeyContent) {
      return {
        error: 'GitHub App private key not found. Configure GITHUB_APP_PRIVATE_KEY_FILE or .kaseki/secrets/github_app_private_key',
      };
    }

    // Load and validate private key
    const privateKey = loadAndValidatePrivateKey(privateKeyContent);

    // Generate JWT
    const jwt = await generateJWT(appId, privateKey);

    // Get installation ID
    const installationId = await getInstallationId(jwt, owner, repo);

    // Get access token
    const tokenData = await getAccessToken(jwt, installationId);

    return tokenData;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      error: errorMessage,
    };
  }
}

/**
 * Fetch GitHub issues from a repository with filtering
 *
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name
 * @param token - GitHub API access token
 * @param options - Filtering options
 * @returns Array of issues matching the criteria
 */
export async function fetchGitHubIssues(
  owner: string,
  repo: string,
  token: string,
  options: {
    labels?: string[];
    limit?: number;
    state?: 'open' | 'closed' | 'all';
  } = {}
): Promise<GitHubIssue[]> {
  const { labels = [], limit = 5, state = 'open' } = options;

  return new Promise((resolve, reject) => {
    // Build query parameters
    const params = new URLSearchParams();
    params.append('state', state);
    params.append('sort', 'created');
    params.append('direction', 'desc');
    params.append('per_page', String(Math.min(limit, 100))); // GitHub max 100

    if (labels.length > 0) {
      params.append('labels', labels.join(','));
    }

    const path = `/repos/${owner}/${repo}/issues?${params.toString()}`;

    const options_https = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Kaseki-Agent',
      },
    };

    let settled = false;
    const failOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = request(options_https, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk;
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        if (res.statusCode !== 200) {
          const errorMsg = `GitHub API error: ${res.statusCode}`;
          logger.error(errorMsg);
          reject(new Error(errorMsg));
        } else {
          try {
            const issues: GitHubIssue[] = JSON.parse(data);
            // Return only the first `limit` issues
            resolve(issues.slice(0, limit));
          } catch (e) {
            reject(
              new Error(
                `Failed to parse issues response: ${
                  e instanceof Error ? e.message : String(e)
                }`
              )
            );
          }
        }
      });
    });

    req.on('error', (err) => {
      logger.error(`GitHub API request failed: ${err.message}`);
      failOnce(err);
    });
    req.setTimeout(GITHUB_API_TIMEOUT_MS, () => {
      req.destroy(new Error(`GitHub API request timed out after ${GITHUB_API_TIMEOUT_MS}ms while fetching issues`));
    });
    req.end();
  });
}
