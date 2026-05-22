import express from 'express';
import { Server } from 'http';
import { createWebRouter } from './kaseki-api-web';

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected test server to bind to a TCP port');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe('kaseki API web console', () => {
  test.each(['/', '/ui'])('serves the task console from %s', async (path) => {
    const app = express();
    app.use(createWebRouter());
    const { server, url } = await listen(app);

    try {
      const response = await fetch(`${url}${path}`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('Kaseki Task Console');
      expect(body).toContain('/api/preflight');
      expect(body).toContain('/api/validate');
      expect(body).toContain('/api/runs');
      expect(body).toContain('Check status');
      expect(body).toContain('/status');
      expect(body).not.toContain('kasekiApiToken =');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
