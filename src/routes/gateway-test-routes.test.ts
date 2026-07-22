/**
 * gateway-test-routes.test.ts
 *
 * Tests for gateway connectivity test route handlers.
 */

// Mock before imports
jest.mock('../logger', () => ({
  createEventLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  })),
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  })),
}));

jest.mock('../secrets/host-secrets-reader');

// Mock the gateway smoke test functions
jest.mock('../kaseki-api-gateway-smoke');

import express from 'express';
import { Server } from 'http';
import { createGatewayTestRoutes } from './gateway-test-routes';
import * as kasekiGatewaySmoke from '../kaseki-api-gateway-smoke';

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve, reject) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
    nextServer.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected test server to bind to a TCP port');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe('gateway-test-routes', () => {
  let app: express.Application;
  let server: Server;
  let baseUrl: string;

  async function setupServer() {
    app = express();
    app.use(express.json());
    app.use(createGatewayTestRoutes());

    const { server: nextServer, url } = await listen(app);
    server = nextServer;
    baseUrl = url;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default mock implementations
    (kasekiGatewaySmoke.testGatewayConnectivity_Stage1 as jest.Mock).mockResolvedValue({
      status: 'ok',
      detail: 'Gateway is responsive',
      gatewayUrl: 'https://gateway.example.com',
      responseTime: 100,
      timestamp: '2026-07-05T12:00:00Z',
      authenticationValidated: true,
    });

    (kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2 as jest.Mock).mockResolvedValue({
      status: 'ok',
      detail: 'Model response validated',
      responseTime: 500,
      timestamp: '2026-07-05T12:00:01Z',
      authenticationValidated: true,
      responseId: 'resp_123',
      outputTokens: 50,
      modelUsed: 'claude-3-5-sonnet',
      streamSmokeValidated: true,
      largePromptSmokeValidated: true,
    });

    (kasekiGatewaySmoke.testPiGatewayProviderSmoke as jest.Mock).mockResolvedValue({
      status: 'ok',
      detail: 'Pi provider smoke test passed',
      responseTime: 2000,
      timestamp: '2026-07-05T12:00:03Z',
      codingShapeValidated: true,
      multiTurnValidated: true,
    });

    (kasekiGatewaySmoke.shouldRunGatewayResponseSmoke as jest.Mock).mockReturnValue(true);
    (kasekiGatewaySmoke.resolveGatewayApiKey as jest.Mock).mockReturnValue({
      value: 'test-api-key',
    });

    await setupServer();
  });

  afterEach(async () => {
    if (server) {
      await close(server);
    }
  });

  describe('GET /gateway-test', () => {
    it('should run both stages by default and return ok', async () => {
      const response = await fetch(`${baseUrl}/gateway-test`);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.responseSmokeValidated).toBe(true);
      expect(body.authenticationValidated).toBe(true);
      expect(kasekiGatewaySmoke.testGatewayConnectivity_Stage1).toHaveBeenCalled();
      expect(kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2).toHaveBeenCalled();
    });

    it('should run only stage 1 when ?stage=1', async () => {
      const response = await fetch(`${baseUrl}/gateway-test?stage=1`);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.responseSmokeValidated).toBe(false);
      expect(kasekiGatewaySmoke.testGatewayConnectivity_Stage1).toHaveBeenCalled();
      expect(kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2).not.toHaveBeenCalled();
    });

    it('should run only stage 2 when ?stage=2', async () => {
      const response = await fetch(`${baseUrl}/gateway-test?stage=2`);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(kasekiGatewaySmoke.testGatewayConnectivity_Stage1).not.toHaveBeenCalled();
      expect(kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2).toHaveBeenCalled();
    });

    it('should return 503 when stage 1 fails', async () => {
      (kasekiGatewaySmoke.testGatewayConnectivity_Stage1 as jest.Mock).mockResolvedValueOnce({
        status: 'error',
        detail: 'Gateway unreachable',
        responseTime: 5000,
        authenticationValidated: false,
      });

      const response = await fetch(`${baseUrl}/gateway-test`);
      const body = await response.json() as any;

      expect(response.status).toBe(503);
      expect(body.status).toBe('error');
    });

    it('should return 503 when stage 2 fails', async () => {
      (kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2 as jest.Mock).mockResolvedValueOnce({
        status: 'error',
        detail: 'Model inference failed',
        responseTime: 3000,
      });

      const response = await fetch(`${baseUrl}/gateway-test`);
      const body = await response.json() as any;

      expect(response.status).toBe(503);
      // Handler keeps body.status='ok' when stage1 passes, but returns 503 HTTP status
      // responseSmokeValidated is false since stage2 failed
      expect(body.responseSmokeValidated).toBe(false);
    });

    it('should include pi provider results when ?piProvider=true', async () => {
      const response = await fetch(`${baseUrl}/gateway-test?piProvider=true`);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.piProviderSmoke).toBeDefined();
      expect(body.piAdapterValidated).toBe(true);
      expect(kasekiGatewaySmoke.testPiGatewayProviderSmoke).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (kasekiGatewaySmoke.testGatewayConnectivity_Stage1 as jest.Mock).mockRejectedValueOnce(
        new Error('Unexpected error')
      );

      const response = await fetch(`${baseUrl}/gateway-test`);
      const body = await response.json() as any;

      expect(response.status).toBe(500);
      expect(body.status).toBe('error');
      expect(body.detail).toBe('Unexpected error during gateway test');
    });

    it('should handle pi provider error in partial success case', async () => {
      (kasekiGatewaySmoke.testPiGatewayProviderSmoke as jest.Mock).mockResolvedValueOnce({
        status: 'error',
        detail: 'Pi provider test failed',
      });

      const response = await fetch(`${baseUrl}/gateway-test?piProvider=true`);
      const body = await response.json() as any;

      expect(response.status).toBe(503);
      expect(body.partialSuccess).toBe(true);
      expect(body.piAdapterValidated).toBe(false);
    });

    it('should make pi provider failure fatal for stage 2 only requests', async () => {
      (kasekiGatewaySmoke.testPiGatewayProviderSmoke as jest.Mock).mockResolvedValueOnce({
        status: 'error',
        detail: 'Pi provider test failed',
        codingShapeValidated: false,
        multiTurnValidated: false,
      });

      const response = await fetch(`${baseUrl}/gateway-test?stage=2&piProvider=on`);
      const body = await response.json() as any;

      expect(response.status).toBe(503);
      expect(body.status).toBe('error');
      expect(body.gatewayInferenceValidated).toBe(true);
      expect(body.piAdapterValidated).toBe(false);
      expect(body.codingShapeValidated).toBe(false);
      expect(body.multiTurnValidated).toBe(false);
    });

    it('should accept false boolean aliases without running pi provider smoke', async () => {
      const response = await fetch(`${baseUrl}/gateway-test?piProvider=no&debug=off`);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.piProviderSmoke).toBeUndefined();
      expect(kasekiGatewaySmoke.testPiGatewayProviderSmoke).not.toHaveBeenCalled();
    });

    it('should handle debug mode query param', async () => {
      await fetch(`${baseUrl}/gateway-test?debug=true&piProvider=true`);

      expect(kasekiGatewaySmoke.testPiGatewayProviderSmoke).toHaveBeenCalledWith(
        expect.objectContaining({ debug: true })
      );
    });

    it('should treat invalid stage and boolean query values as defaults', async () => {
      const response = await fetch(`${baseUrl}/gateway-test?stage=bogus&responseSmoke=maybe&piProvider=maybe`);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(kasekiGatewaySmoke.testGatewayConnectivity_Stage1).toHaveBeenCalled();
      expect(kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2).toHaveBeenCalled();
      expect(kasekiGatewaySmoke.testPiGatewayProviderSmoke).not.toHaveBeenCalled();
    });

    it('should skip default stage 2 when responseSmoke=false', async () => {
      (kasekiGatewaySmoke.shouldRunGatewayResponseSmoke as jest.Mock).mockReturnValueOnce(false);

      const response = await fetch(`${baseUrl}/gateway-test?responseSmoke=false`);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.responseSmokeValidated).toBe(false);
      expect(kasekiGatewaySmoke.shouldRunGatewayResponseSmoke).toHaveBeenCalledWith({ responseSmoke: false });
      expect(kasekiGatewaySmoke.testGatewayConnectivity_Stage1).toHaveBeenCalled();
      expect(kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2).not.toHaveBeenCalled();
    });

    it('should force stage 2 when stage=2 even if responseSmoke=false', async () => {
      const response = await fetch(`${baseUrl}/gateway-test?stage=2&responseSmoke=false`);

      expect(response.status).toBe(200);
      expect(kasekiGatewaySmoke.testGatewayConnectivity_Stage1).not.toHaveBeenCalled();
      expect(kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2).toHaveBeenCalled();
    });

    it('should return 503 for stage 2 only when smoke returns no result', async () => {
      (kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2 as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await fetch(`${baseUrl}/gateway-test?stage=2`);
      const body = await response.json() as any;

      expect(response.status).toBe(503);
      expect(body).toMatchObject({
        status: 'error',
        detail: 'LLM inference test failed',
        responseSmokeValidated: false,
      });
    });
  });

  describe('GET /gateway-test/stage1', () => {
    it('should run only stage 1 connectivity test', async () => {
      const response = await fetch(`${baseUrl}/gateway-test/stage1`);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.detail).toBe('Gateway is responsive');
      expect(body.authenticationValidated).toBe(true);
      expect(kasekiGatewaySmoke.testGatewayConnectivity_Stage1).toHaveBeenCalled();
      expect(kasekiGatewaySmoke.testGatewayResponseSmoke_Stage2).not.toHaveBeenCalled();
    });

    it('should return 503 on connectivity failure', async () => {
      (kasekiGatewaySmoke.testGatewayConnectivity_Stage1 as jest.Mock).mockResolvedValueOnce({
        status: 'error',
        detail: 'Gateway unreachable (SSL certificate expired)',
        responseTime: 10000,
        authenticationValidated: false,
      });

      const response = await fetch(`${baseUrl}/gateway-test/stage1`);
      const body = await response.json() as any;

      expect(response.status).toBe(503);
      expect(body.status).toBe('error');
      expect(body.authenticationValidated).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      (kasekiGatewaySmoke.testGatewayConnectivity_Stage1 as jest.Mock).mockRejectedValueOnce(
        new Error('Network timeout')
      );

      const response = await fetch(`${baseUrl}/gateway-test/stage1`);
      const body = await response.json() as any;

      expect(response.status).toBe(500);
      expect(body.status).toBe('error');
      expect(body.detail).toBe('Unexpected error during gateway connectivity test');
    });

    it('should return timestamp in response', async () => {
      const response = await fetch(`${baseUrl}/gateway-test/stage1`);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.timestamp).toBeDefined();
      // Verify it's a valid ISO string
      expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
    });
  });
});
