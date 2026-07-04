#!/bin/bash

# Exercises the production requestOwnerReview implementation with fixture PR payloads.
# The test stubs only the GitHub API boundary (fetch) and asserts behavior from
# the generated request rather than duplicating production parsing/status logic.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_SCRIPT="$(mktemp /tmp/kaseki-request-owner-review.XXXXXX.mts)"
trap 'rm -f "$TEST_SCRIPT"' EXIT

cat > "$TEST_SCRIPT" <<'NODE_TEST'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type CapturedCall = {
  url: string;
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
};

const repoRoot = process.env.REPO_ROOT;
if (!repoRoot) {
  throw new Error('REPO_ROOT environment variable is required');
}

const { requestOwnerReview } = await import(
  pathToFileURL(join(repoRoot, 'src', 'request-owner-review.ts')).href
);

const readFixture = (name: string) => JSON.parse(
  readFileSync(join(repoRoot, 'tests', 'fixtures', name), 'utf8'),
);

const personalPr = readFixture('pr-response-personal-repo.json');
const orgPr = readFixture('pr-response-org-repo.json');

const withImmediateTimers = async <T>(run: () => Promise<T>): Promise<T> => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
    callback(...args);
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;

  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
};

const createFetchStub = (statuses: number[]) => {
  const calls: CapturedCall[] = [];
  const fetchStub = async (url: string, options: CapturedCall['options']) => {
    calls.push({ url, options });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return new Response('{}', { status });
  };

  return { calls, fetchStub };
};

const testPersonalRepoRequestPayload = async () => {
  const { calls, fetchStub } = createFetchStub([201]);

  const result = await requestOwnerReview(personalPr, 'test-token', fetchStub);

  assert.equal(result.success, true);
  assert.equal(result.skipped, false);
  assert.equal(result.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/testuser/test-repo/pulls/42/requested_reviewers',
  );
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers?.Authorization, 'token test-token');
  assert.equal(calls[0].options.headers?.Accept, 'application/vnd.github.v3+json');
  assert.equal(calls[0].options.headers?.['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body ?? ''), { reviewers: ['testuser'] });
};

const testOrgRepoOwnerSelection = async () => {
  const { calls, fetchStub } = createFetchStub([201]);

  const result = await requestOwnerReview(orgPr, 'test-token', fetchStub);

  assert.equal(result.success, true);
  assert.equal(result.skipped, true);
  assert.equal(result.skippedReason, 'owner_type_is_organization');
  assert.equal(calls.length, 0, 'organization-owned repos should not call the GitHub review request API');
};

const testRetryClassification = async () => {
  for (const retryableStatus of [429, 500, 502, 503, 504]) {
    const { calls, fetchStub } = createFetchStub([retryableStatus, 201]);

    const result = await withImmediateTimers(() => requestOwnerReview(personalPr, 'test-token', fetchStub));

    assert.equal(result.success, true, `status ${retryableStatus} should recover after retry`);
    assert.equal(result.status, 201, `status ${retryableStatus} should return the eventual success status`);
    assert.equal(calls.length, 2, `status ${retryableStatus} should be retried once before success`);
    assert.deepEqual(JSON.parse(calls[1].options.body ?? ''), { reviewers: ['testuser'] });
  }
};

const testNonRetryClassification = async () => {
  for (const nonRetryableStatus of [400, 401, 403, 404, 422]) {
    const { calls, fetchStub } = createFetchStub([nonRetryableStatus, 201]);

    const result = await requestOwnerReview(personalPr, 'test-token', fetchStub);

    assert.equal(calls.length, 1, `status ${nonRetryableStatus} should not be retried`);
    assert.equal(result.success, false, `status ${nonRetryableStatus} should report failure`);
    assert.equal(result.status, nonRetryableStatus);
  }
};

const tests: Array<[string, () => Promise<void>]> = [
  ['personal fixture generates the GitHub review request payload', testPersonalRepoRequestPayload],
  ['organization fixture is skipped without calling GitHub', testOrgRepoOwnerSelection],
  ['retryable statuses are retried by production logic', testRetryClassification],
  ['non-retryable statuses are not retried by production logic', testNonRetryClassification],
];

for (const [name, run] of tests) {
  await run();
  console.log(`✓ ${name}`);
}

console.log(`\n${tests.length} request owner review tests passed`);
NODE_TEST

cd "$REPO_ROOT"
REPO_ROOT="$REPO_ROOT" npx tsx "$TEST_SCRIPT"
