import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import express, { type Express } from 'express';
import type { AddressInfo, Server } from 'net';
import * as hostSecretsReader from '../../src/secrets/host-secrets-reader';
import * as subprocessHelpers from '../../src/lib/subprocess-helpers';
import { createApiRouter } from '../../src/kaseki-api-routes';
import { IdempotencyStore } from '../../src/idempotency-store';
import { PreFlightValidator } from '../../src/pre-flight-validator';
import { createTestConfig, type TestScheduler } from '../../src/test-utils';
import type { TaskAdmissionEvaluator } from '../../src/task-admission';
import { applyHttpHardening } from '../../src/kaseki-api-service';
import { SoyuzSubmissionClient } from '../../src/integrations/soyuz/SoyuzSubmissionClient';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const defaultGithubPrivateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
export const execDockerCommandMock = jest.mocked(subprocessHelpers.execDockerCommand);
export const spawnSyncMock = jest.mocked(spawnSync);

function mockSuccessfulDockerCommands(): void {
  execDockerCommandMock.mockImplementation((args: string[]) => ({
    ok: true,
    stdout: args[0] === 'version' ? '24.0.0 -> 24.0.0' : undefined,
  }));
}

function mockReadableGithubAppCredentials(): void {
  const { readHostSecret } = jest.mocked(hostSecretsReader);
  (readHostSecret as jest.Mock).mockImplementation((name: string) => {
    if (name === 'github_app_id') return '12345';
    if (name === 'github_app_client_id') return 'Iv123client';
    if (name === 'github_app_private_key') return defaultGithubPrivateKeyPem;
    return null;
  });
}

export function setupApiRouteTestDefaults(): void {
  originalSkipBootstrapCheck = process.env.KASEKI_SKIP_BOOTSTRAP_CHECK;
  spawnSyncMock.mockImplementation(jest.requireActual<typeof import('node:child_process')>('node:child_process').spawnSync);
  process.env.KASEKI_SKIP_BOOTSTRAP_CHECK = '1';
  mockSuccessfulDockerCommands();
  mockReadableGithubAppCredentials();
}

let originalSkipBootstrapCheck: string | undefined;

export function restoreApiRouteTestDefaults(): void {
  if (originalSkipBootstrapCheck === undefined) delete process.env.KASEKI_SKIP_BOOTSTRAP_CHECK;
  else process.env.KASEKI_SKIP_BOOTSTRAP_CHECK = originalSkipBootstrapCheck;
}

export async function createTestApp(
  scheduler: TestScheduler,
  config: ReturnType<typeof createTestConfig>,
  taskAdmissionEvaluator?: TaskAdmissionEvaluator,
  submissionClient?: SoyuzSubmissionClient,
): Promise<{
  app: Express;
  server: Server;
  port: number;
  idempotencyStore: IdempotencyStore;
  preFlightValidator: PreFlightValidator;
}> {
  const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
  const preFlightValidator = new PreFlightValidator();
  const app = express();
  applyHttpHardening(app);
  app.use(express.json());
  app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, preFlightValidator, undefined, taskAdmissionEvaluator, submissionClient));

  const { server, port } = await listenTestApp(app);
  return { app, server, port, idempotencyStore, preFlightValidator };
}

export async function listenTestApp(app: Express): Promise<{ server: Server; port: number }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  return { server, port: (server.address() as AddressInfo).port };
}

export async function cleanupTestApp(server: Server, idempotencyStore: IdempotencyStore): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await idempotencyStore.shutdown();
}

export async function drainResponseBody(response: Response): Promise<Response> {
  const buffer = await response.arrayBuffer();
  return new Response(buffer, { status: response.status, statusText: response.statusText, headers: response.headers });
}
