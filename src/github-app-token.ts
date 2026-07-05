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
import { pathToFileURL } from 'url';
import type { generateGitHubAppToken as generateGitHubAppTokenFn } from './github-utils';
import { resolveGitHubAppTokenRuntimeImport } from './github-app-token-runtime';

const APP_ID = process.argv[2];
const PRIVATE_KEY_FILE = process.argv[3];
const OWNER = process.argv[4];
const REPO = process.argv[5];

type GitHubUtilsModule = {
  generateGitHubAppToken: typeof generateGitHubAppTokenFn;
};

async function loadGitHubUtils(): Promise<GitHubUtilsModule> {
  return import(resolveGitHubAppTokenRuntimeImport('./github-utils.js', import.meta.url)) as Promise<GitHubUtilsModule>;
}

async function main(): Promise<void> {
  if (!APP_ID || !PRIVATE_KEY_FILE || !OWNER || !REPO) {
    console.error(
      'Usage: node github-app-token.js <app-id> <private-key-file> <owner> <repo>'
    );
    process.exit(1);
  }

  try {
    const privateKeyContent = fs.readFileSync(PRIVATE_KEY_FILE, 'utf8');
    const { generateGitHubAppToken } = await loadGitHubUtils();
    const tokenData = await generateGitHubAppToken(OWNER, REPO, APP_ID, privateKeyContent);

    // Output result as JSON
    console.log(JSON.stringify(tokenData));
    if (tokenData.error) {
      process.exit(1);
    }
  } catch (error) {
    console.log(JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
