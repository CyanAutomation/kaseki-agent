#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const senkuRepoPath = process.env.SENKU_REPO_PATH;
if (!senkuRepoPath) {
  throw new Error('Set SENKU_REPO_PATH to a local Senku main checkout. See docs/SENKU-INTEGRATION.md.');
}
if (!Number.isInteger(Number(process.versions.node.split('.')[0])) || Number(process.versions.node.split('.')[0]) < 26) {
  throw new Error(`Senku main requires Node.js 26; found ${process.versions.node}.`);
}

const senkuIndex = pathToFileURL(path.resolve(senkuRepoPath, 'src/index.ts')).href;
const [{ createWorker }, { SenkuDecisionService }] = await Promise.all([
  import(senkuIndex),
  import('../src/decision-service.ts'),
]);

const kasekiToken = 'synthetic-kaseki-machine-token-0123456789abcdef';
const soyuzToken = 'synthetic-soyuz-machine-token-0123456789abcdef';
const providerToken = 'synthetic-openrouter-provider-key-never-sent-over-network';
let workerRequestCount = 0;
let providerAttemptCount = 0;
let malformedProviderResponse = false;
let observedKasekiAuthorization;

const providerFetch = async (input, init = {}) => {
  providerAttemptCount += 1;
  assert.equal(String(input), 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${providerToken}`);
  if (malformedProviderResponse) {
    return new Response('provider private trace that must stay inside Senku', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  const request = JSON.parse(String(init.body));
  const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === 'choice') {
      const labels = Object.keys(question.criteria);
      const probabilities = Object.fromEntries(labels.map((label, index) => [label, index === 0 ? 0.97 : 0.03 / (labels.length - 1)]));
      return [id, { type: 'choice', choice: labels[0], probabilities, confidence: 0.97 }];
    }
    return [id, { type: 'noul', noul: 0.97 }];
  }));
  return new Response(JSON.stringify({
    model: '~typesafe/jev-latest',
    answers,
    usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, cost: 0.00001 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const worker = createWorker({ fetchImpl: providerFetch, logger: () => undefined });
const workerEnv = {
  OPENROUTER_API_KEY: providerToken,
  SENKU_KASEKI_API_TOKEN: kasekiToken,
  SENKU_SOYUZ_API_TOKEN: soyuzToken,
  SENKU_PUBLIC_BASE_URL: 'https://senku.example.test',
  SENKU_PROVIDER_TIMEOUT_MS: '15000',
};

const server = createServer(async (incoming, outgoing) => {
  workerRequestCount += 1;
  observedKasekiAuthorization = incoming.headers.authorization;
  const chunks = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string' && name !== 'host' && name !== 'connection') headers.set(name, value);
  }
  try {
    const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
      method: incoming.method,
      headers,
      ...(body.byteLength > 0 ? { body, duplex: 'half' } : {}),
    });
    const response = await worker.fetch(request, workerEnv);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.statusCode = 500;
    outgoing.end();
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const env = {
    NODE_ENV: 'test',
    SENKU_URL: `http://127.0.0.1:${address.port}`,
    SENKU_KASEKI_API_TOKEN_FILE: '/synthetic/kaseki-token',
  };
  const baseOptions = {
    env,
    readFile: () => kasekiToken,
    timeoutMs: 5_000,
  };
  const questions = { allowed: { type: 'noul', instructions: 'Does the evidence satisfy the requested policy?' } };
  const service = new SenkuDecisionService(baseOptions);

  const success = await service.decide({ state: { status: 'ok' }, questions });
  assert.equal(success.provider, 'senku');
  assert.equal(success.model, '~typesafe/jev-latest');
  assert.equal(success.attemptCount, 1);
  assert.deepEqual(success.answers.allowed, {
    type: 'noul',
    noul: 0.97,
    probabilities: { false: 0.030000000000000027, true: 0.97 },
    confidence: null,
  });
  assert.deepEqual(success.usage, { input_tokens: 12, output_tokens: 3, total_tokens: 15, cost: 0.00001 });
  assert.equal(observedKasekiAuthorization, `Bearer ${kasekiToken}`);
  assert.equal(workerRequestCount, 1);
  assert.equal(providerAttemptCount, 1);

  const contextRouting = await service.evaluateProfile({
    profileId: 'kaseki_context_routing_v1',
    input: {
      mode: 'semantic_context',
      evidence: {
        phase: 'coding', toolName: 'read', resultKind: 'file_content', isError: false,
        characters: 2_000, bytes: 2_000, approximateTokens: 500, lineCount: 60,
        consecutiveDuplicateLineRatio: 0.1, hasReadRange: false, goalSummary: 'Inspect the bounded file context.',
      },
    },
  });
  assert.equal(contextRouting.profileId, 'kaseki_context_routing_v1');
  assert.equal(contextRouting.answers.disposition.choice, 'preserve');
  assert.equal(contextRouting.attemptCount, 1);
  assert.equal(workerRequestCount, 2);
  assert.equal(providerAttemptCount, 2);

  const wrongIdentity = new SenkuDecisionService({
    ...baseOptions,
    readFile: () => 'synthetic-wrong-identity-token-0123456789',
  });
  await assert.rejects(
    () => wrongIdentity.decide({ state: 'private evidence', questions }),
    (error) => error.category === 'credentials' && error.httpStatus === 401
      && !error.message.includes('private evidence'),
  );
  assert.equal(workerRequestCount, 3);
  assert.equal(providerAttemptCount, 2);

  malformedProviderResponse = true;
  await assert.rejects(
    () => service.decide({ state: 'private evidence', questions }),
    (error) => error.category === 'invalid_response' && error.httpStatus === 502
      && !error.message.includes('provider private trace')
      && !error.message.includes('private evidence'),
  );
  assert.equal(workerRequestCount, 4);
  assert.equal(providerAttemptCount, 3);

  process.stdout.write('Senku Worker contract integration passed: authenticated generic and context-profile calls, one provider attempt per evaluation, and safe failures.\n');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
