#!/usr/bin/env node
/**
 * Opt-in live CloudFlare AI Workers Gateway probe.
 *
 * Requires:
 *   CLOUDFLARE_GATEWAY_TEST=1
 *   LLM_GATEWAY_URL
 *   LLM_GATEWAY_API_KEY or LLM_GATEWAY_API_KEY_FILE
 *   token/network access to CloudFlare
 */

import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';

const enabled = process.env.CLOUDFLARE_GATEWAY_TEST === '1' || process.env.CLOUDFLARE_GATEWAY_TEST === 'true';
if (!enabled) {
  console.error('SKIP: set CLOUDFLARE_GATEWAY_TEST=1 to run the live CloudFlare gateway probe.');
  process.exit(0);
}

const baseUrl = process.env.LLM_GATEWAY_URL;
if (!baseUrl) {
  throw new Error('LLM_GATEWAY_URL must be set to run the live CloudFlare gateway probe.');
}

function resolveApiKey() {
  if (process.env.LLM_GATEWAY_API_KEY) return process.env.LLM_GATEWAY_API_KEY;
  const configuredPath = process.env.LLM_GATEWAY_API_KEY_FILE || '~/.kaseki/secrets.json';
  const expandedPath = configuredPath.startsWith('~/')
    ? `${os.homedir()}/${configuredPath.slice(2)}`
    : configuredPath;
  if (fs.existsSync(expandedPath)) return fs.readFileSync(expandedPath, 'utf8').trim();
  return '';
}

const apiKey = resolveApiKey();
if (!apiKey) {
  throw new Error('LLM_GATEWAY_API_KEY or LLM_GATEWAY_API_KEY_FILE must provide a token.');
}

const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
const model = process.env.LLM_GATEWAY_MODEL || 'dynamic/kaseki-agent';
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Say "CloudFlare gateway test successful" in one sentence' }],
    max_tokens: 50,
  }),
});

if (!response.ok) {
  throw new Error(`CloudFlare gateway probe failed with HTTP ${response.status}`);
}

const data = await response.json();
const content = data?.choices?.[0]?.message?.content;
const text = typeof content === 'string'
  ? content
  : Array.isArray(content)
    ? content.map((part) => part?.text ?? String(part)).join('')
    : String(content ?? '');

if (!text) throw new Error('CloudFlare gateway probe response did not include message content.');
console.log('✓ CloudFlare gateway connectivity verified');
console.log(`  Endpoint: ${endpoint}`);
console.log(`  Model: ${model}`);
console.log(`  Response: ${text.slice(0, 100)}`);
