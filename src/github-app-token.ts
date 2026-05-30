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
import { generateGitHubAppToken } from './github-utils';

const APP_ID = process.argv[2];
const PRIVATE_KEY_FILE = process.argv[3];
const OWNER = process.argv[4];
const REPO = process.argv[5];

async function main(): Promise<void> {
  if (!APP_ID || !PRIVATE_KEY_FILE || !OWNER || !REPO) {
    console.error(
      'Usage: node github-app-token.js <app-id> <private-key-file> <owner> <repo>'
    );
    process.exit(1);
  }

  try {
    const privateKeyContent = fs.readFileSync(PRIVATE_KEY_FILE, 'utf8');
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

main();

