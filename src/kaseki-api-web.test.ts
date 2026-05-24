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
      expect(response.headers.get('content-security-policy')).toContain("style-src 'unsafe-inline'");
      expect(body).toContain('Kaseki Task Console');
      expect(body).toContain('/api/preflight');
      expect(body).toContain('/api/validate');
      expect(body).toContain('/api/runs');
      expect(body).toContain('name="publishMode"');
      expect(body).toContain('name="taskMode"');
      expect(body).toContain('name="timeoutSeconds"');
      expect(body).toContain('data-run-link="artifacts"');
      expect(body).toContain('id="recommended-artifacts"');
      expect(body).toContain('Recommended artifacts');
      expect(body).toContain('function loadRecommendedArtifacts(runId)');
      expect(body).toContain("apiRequest(runUrl(runId, '/artifacts'), { auth: true, preserveOutput: true })");
      expect(body).toContain('hidden aria-hidden="true"');
      expect(body).toContain('Check status');
      expect(body).toContain('/status');
      expect(body).toContain('/events?tail=50');
      expect(body).toContain('function responseStatusLabel(response, payload)');
      expect(body).toContain('return payload.status;');
      expect(body).toContain('Run status updated.');
      expect(body).not.toContain('kasekiApiToken =');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  test('scouting checkbox defaults on and only serializes when checked', async () => {
    const app = express();
    app.use(createWebRouter());
    const { server, url } = await listen(app);

    try {
      const response = await fetch(`${url}/ui`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('<input name="scouting" type="checkbox" checked>');

      const requestBodyMatch = body.match(/function requestBody\(\) \{([\s\S]*?)\n{6}\}/);
      expect(requestBodyMatch).toBeTruthy();
      const requestBodySource = `function requestBody() {${requestBodyMatch?.[1] || ''}\n      }`;

      class MockFormData {
        private readonly values: Map<string, string>;

        constructor(formValue: { values: Array<[string, string]> }) {
          this.values = new Map(formValue.values);
        }

        get(key: string): string | null {
          return this.values.has(key) ? this.values.get(key) ?? null : null;
        }
      }

      const baseValues: Array<[string, string]> = [
        ['repoUrl', 'https://github.com/org/repo'],
        ['ref', 'main'],
        ['taskPrompt', 'Test prompt body'],
        ['publishMode', 'pr'],
        ['taskMode', 'patch'],
      ];

      const buildRequestBody = (values: Array<[string, string]>) => {
        const runner = new Function(
          'FormData',
          'form',
          `${requestBodySource}; return requestBody();`,
        );
        return runner(MockFormData, { values }) as Record<string, unknown>;
      };

      const checkedBody = buildRequestBody([...baseValues, ['scouting', 'on']]);
      expect(checkedBody.scouting).toEqual({ enabled: true });

      const uncheckedBody = buildRequestBody(baseValues);
      expect(uncheckedBody).not.toHaveProperty('scouting');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
