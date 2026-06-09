import express from 'express';
import { Server } from 'http';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createWebRouter } from './kaseki-api-web';

type FetchInit = {
  method?: string;
  headers?: unknown;
  body?: unknown;
};

type FetchCall = {
  path: string;
  init?: FetchInit;
};

type MockResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
};

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

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function fetchConsole(path = '/'): Promise<{ response: Response; body: string }> {
  const app = express();
  app.use(createWebRouter());
  const { server, url } = await listen(app);

  try {
    const response = await fetch(`${url}${path}`);
    const body = await response.text();
    return { response, body };
  } finally {
    await close(server);
  }
}

function createJsonResponse(payload: unknown, status = 200): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

async function renderConsole(options: {
  storedToken?: string;
  fetchHandler?: (path: string, init?: FetchInit) => MockResponse | Promise<MockResponse>;
} = {}) {
  const { body } = await fetchConsole('/');
  const calls: FetchCall[] = [];
  const fetchMock = jest.fn(async (path: string, init?: FetchInit) => {
    calls.push({ path, init });
    if (options.fetchHandler) return options.fetchHandler(path, init);
    return createJsonResponse({ status: 'ok' });
  });
  const dom = new JSDOM(body, {
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole(),
    url: 'https://console.test/ui',
    beforeParse(window) {
      if (options.storedToken) {
        window.sessionStorage.setItem('kasekiApiToken', options.storedToken);
      }
      window.fetch = fetchMock as unknown as typeof window.fetch;
    },
  });

  await waitFor(() => expect(dom.window.document.querySelector('#header-status')).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 0));
  calls.length = 0;
  fetchMock.mockClear();
  return { dom, document: dom.window.document, calls, fetchMock };
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 1000) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function click(element: Element | null): void {
  expect(element).not.toBeNull();
  const view = element.ownerDocument.defaultView;
  if (!view) throw new Error('Element has no defaultView');
  element.dispatchEvent(new view.MouseEvent('click', { bubbles: true }));
}

function change(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new input.ownerDocument.defaultView!.Event('change', { bubbles: true }));
}

describe('kaseki API web console routes', () => {
  test.each(['/', '/ui'])('serves the task console app shell from %s', async (path) => {
    const { response, body } = await fetchConsole(path);
    const dom = new JSDOM(body, { virtualConsole: new VirtualConsole() });
    const document = dom.window.document;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("style-src 'unsafe-inline'");
    expect(document.querySelector('h1')?.textContent).toBe('Kaseki Task Console');
    expect(document.querySelector('#header-api-token')?.getAttribute('aria-label')).toBe('API bearer token');
    expect(document.querySelector('[data-probe="/api/preflight"]')).not.toBeNull();
    expect(document.querySelector('#task-mode')?.getAttribute('name')).toBe('taskMode');
    expect(document.querySelector('#runs-list')).not.toBeNull();
    expect(document.querySelector('#refresh-runs')?.textContent).toContain('Refresh runs');
    expect(document.querySelector('#cancel-run')?.textContent).toContain('Cancel run');
    expect(document.querySelector('[data-tab="artifacts"]')?.textContent).toContain('Artifacts');
    expect(document.querySelector('#recommended-artifacts')?.textContent).toContain('Recommended artifacts');
    expect(document.querySelector('#response-summary')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#submit-tab')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.body.textContent).not.toContain('Task Progress');
  });
});

describe('kaseki API web console behavior', () => {
  test('restores, updates, validates, and persists API bearer tokens', async () => {
    const { dom, document, calls } = await renderConsole({
      storedToken: 'storedtoken123',
      fetchHandler: () => createJsonResponse({ status: 'ok' }),
    });
    const tokenInput = document.querySelector<HTMLInputElement>('#header-api-token');
    expect(tokenInput?.value).toBe('storedtoken123');

    change(tokenInput!, 'newtoken456');
    expect(dom.window.sessionStorage.getItem('kasekiApiToken')).toBe('newtoken456');

    click(document.querySelector('[data-probe="/api/preflight"]'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ path: '/api/preflight' });
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer newtoken456' });
    expect(dom.window.sessionStorage.getItem('kasekiApiToken')).toBe('newtoken456');
    await waitFor(() => expect(document.querySelector('#state')?.textContent).toBe('Request completed.'));
    calls.length = 0;

    change(tokenInput!, 'bad token with spaces');
    click(document.querySelector('[data-probe="/api/preflight"]'));
    await waitFor(() => expect(document.querySelector('#state')?.textContent).toBe('Request could not be sent.'));
    expect(document.querySelector('#output')?.textContent).toContain('Token format looks invalid');
    expect(calls).toHaveLength(0);
  });

  test('loads the recent run list into selectable run buttons', async () => {
    const { document, calls } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path !== '/api/runs') return createJsonResponse({});
        return createJsonResponse({
          runs: [
            { id: 'kaseki-101', status: 'running', createdAt: '2026-06-09T12:00:00Z' },
            { id: 'kaseki-102', status: 'completed', createdAt: '2026-06-09T12:05:00Z' },
          ],
        });
      },
    });

    click(document.querySelector('#refresh-runs'));
    await waitFor(() => expect(document.querySelectorAll('#runs-list button')).toHaveLength(2));

    expect(calls[0]).toMatchObject({ path: '/api/runs' });
    expect([...document.querySelectorAll('#runs-list button')].map((button) => button.textContent)).toEqual([
      expect.stringContaining('kaseki-101'),
      expect.stringContaining('kaseki-102'),
    ]);
    expect(document.querySelector('#runs-list')?.textContent).toContain('running');
    expect(document.querySelector('#runs-list')?.textContent).toContain('completed');

    click(document.querySelector('#runs-list button'));
    expect(document.querySelector<HTMLInputElement>('#run-id')?.value).toBe('kaseki-101');
    expect(document.querySelector<HTMLButtonElement>('#cancel-run')?.disabled).toBe(false);
    expect(document.querySelector('#run-links')?.hasAttribute('hidden')).toBe(false);
  });

  test('loads status-triggered recommended artifacts and filters binary entries', async () => {
    const { document, calls } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/runs/kaseki-201/status') {
          return createJsonResponse({ id: 'kaseki-201', status: 'completed' });
        }
        if (path === '/api/runs/kaseki-201/artifacts') {
          return createJsonResponse({
            recommended: ['summary.md', 'bundle.zip'],
            artifacts: [
              { name: 'summary.md', available: true, contentType: 'text/markdown', size: '2 KB' },
              { name: 'bundle.zip', available: true, contentType: 'application/zip', size: '4 KB' },
            ],
          });
        }
        return createJsonResponse({ runs: [] });
      },
    });

    document.querySelector<HTMLInputElement>('#run-id')!.value = 'kaseki-201';
    click(document.querySelector('#status-check'));

    await waitFor(() => expect(document.querySelectorAll('#recommended-artifact-links button[data-artifact-file]')).toHaveLength(1));
    expect(calls.map((call) => call.path)).toEqual(['/api/runs/kaseki-201/status', '/api/runs/kaseki-201/artifacts']);
    expect(document.querySelector('#recommended-artifacts')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-artifact-file="summary.md"]')?.textContent).toBe('summary.md');
    expect(document.querySelector('[data-artifact-file="bundle.zip"]')).toBeNull();
  });

  test('loads artifact lists in the full-results modal with DOM controls for text artifacts only', async () => {
    const { document, calls } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/runs/kaseki-301/status') return createJsonResponse({ id: 'kaseki-301', status: 'running' });
        if (path === '/api/runs/kaseki-301/artifacts') {
          return createJsonResponse({
            artifacts: [
              { name: 'report.json', available: true, contentType: 'application/json', size: '1 KB' },
              { name: 'archive.tar', available: true, contentType: 'application/x-tar', size: '8 KB' },
              { name: 'missing.txt', available: false, contentType: 'text/plain', size: '1 KB' },
            ],
          });
        }
        return createJsonResponse({});
      },
    });

    document.querySelector<HTMLInputElement>('#run-id')!.value = 'kaseki-301';
    click(document.querySelector('#full-results-btn'));
    await waitFor(() => expect(calls.map((call) => call.path)).toContain('/api/runs/kaseki-301/status'));

    click(document.querySelector('.tab-btn[data-tab="artifacts"]'));
    await waitFor(() => expect(document.querySelectorAll('#artifacts-output .artifact-item')).toHaveLength(1));

    expect(document.querySelector('#full-results-modal')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('#modal-title-heading')?.textContent).toBe('Full Results — kaseki-301');
    expect(document.querySelector('#artifacts-output .artifact-item-name')?.textContent).toBe('report.json');
    expect(document.querySelector('#artifacts-output')?.textContent).not.toContain('archive.tar');
    expect(document.querySelector('#artifacts-output')?.textContent).not.toContain('missing.txt');
  });

  test('handles status and cancel actions through the run controls', async () => {
    const { document, calls } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/runs/kaseki-401/status') {
          return createJsonResponse({ id: 'kaseki-401', status: 'running', progress: { stage: 'apply_patch', percentComplete: 25 } });
        }
        if (path === '/api/runs/kaseki-401/cancel') {
          return createJsonResponse({ id: 'kaseki-401', status: 'cancelled' });
        }
        return createJsonResponse({ runs: [] });
      },
    });

    click(document.querySelector('#status-check'));
    expect(document.querySelector('#state')?.textContent).toBe('Run status needs a run ID.');
    expect(document.querySelector('#output')?.textContent).toBe('Submit a run or enter a run ID first.');

    document.querySelector<HTMLInputElement>('#run-id')!.value = 'kaseki-401';
    click(document.querySelector('#status-check'));
    await waitFor(() => expect(document.querySelector('#state')?.textContent).toBe('Run status updated.'));
    expect(document.querySelector('#output-meta')?.textContent).toBe('Status: running | Run ID: kaseki-401');
    expect(document.querySelector('[data-summary="run"]')?.textContent).toBe('running');
    expect(document.querySelector('#run-details')?.textContent).toBe('apply_patch | 25%');

    click(document.querySelector('#cancel-run'));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/runs/kaseki-401/cancel')).toBe(true));
    const cancelCall = calls.find((call) => call.path === '/api/runs/kaseki-401/cancel');
    expect(cancelCall?.init?.method).toBe('POST');
  });

  test('renders response summary fields from response payloads', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: () => createJsonResponse({
        id: 'kaseki-501',
        status: '\u001b[31mcompleted\u001b[0m',
        elapsedSeconds: 125.9,
        taskProgressPercent: 80,
        progress: {
          stage: 'verify',
          displayName: '\u001b[32mVerification\u001b[0m',
          message: '\u001b[33mChecks passed\u001b[0m',
        },
      }),
    });

    document.querySelector<HTMLInputElement>('#run-id')!.value = 'kaseki-501';
    click(document.querySelector('#status-check'));

    await waitFor(() => expect(document.querySelector('#response-summary')?.hasAttribute('hidden')).toBe(false));
    const summaryItems = [...document.querySelectorAll('#response-summary .response-summary-item')].map((item) => ({
      label: item.querySelector('.response-summary-label')?.textContent,
      value: item.querySelector('.response-summary-value')?.textContent,
    }));
    expect(summaryItems).toEqual([
      { label: 'Response status', value: 'completed' },
      { label: 'Response elapsed time', value: '2m 05s' },
      { label: 'Response progress stage', value: 'Verification' },
      { label: 'Progress (%)', value: '80%' },
      { label: 'Progress message', value: 'Checks passed' },
    ]);
    expect(document.querySelector('#response-summary')?.textContent).not.toContain('\u001b');
  });
});
