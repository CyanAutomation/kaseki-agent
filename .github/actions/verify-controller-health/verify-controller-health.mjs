import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SUPPORTED_HEALTH_STATUSES = new Set(['ok', 'healthy']);

export function parseHealthResponse(responseText) {
  let response;
  try {
    response = JSON.parse(responseText);
  } catch {
    throw new Error('Kaseki /health returned invalid JSON.');
  }

  if (
    response === null ||
    typeof response !== 'object' ||
    Array.isArray(response) ||
    typeof response.status !== 'string' ||
    !SUPPORTED_HEALTH_STATUSES.has(response.status)
  ) {
    throw new Error('Kaseki /health returned an unsupported status.');
  }

  return response.status;
}

export function readHealthResponseFile(responsePath) {
  try {
    return readFileSync(responsePath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Failed to read Kaseki /health response file: ${detail}`);
  }
}

function main() {
  const responsePath = process.argv[2];
  if (!responsePath) {
    throw new Error('Usage: verify-controller-health.mjs <response-file>');
  }

  const status = parseHealthResponse(readHealthResponseFile(responsePath));
  console.log(`Kaseki health check succeeded (${status}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Kaseki health check failed.');
    process.exitCode = 1;
  }
}
