import express from 'express';
import { Server } from 'http';
/* global HTMLTextAreaElement, HTMLSelectElement */
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

const openDoms: JSDOM[] = [];

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

function createTextResponse(payload: string, status = 200): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/plain' : null },
    json: async () => payload,
    text: async () => payload,
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
  openDoms.push(dom);

  await waitFor(() => expect(dom.window.document.querySelector('#header-status')).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 0));
  calls.length = 0;
  fetchMock.mockClear();
  return { dom, document: dom.window.document, calls, fetchMock };
}

afterEach(() => {
  while (openDoms.length > 0) {
    openDoms.pop()?.window.close();
  }
});

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
  if (!element) throw new Error('Element is null');
  const view = element.ownerDocument.defaultView;
  if (!view) throw new Error('Element has no defaultView');
  element.dispatchEvent(new view.MouseEvent('click', { bubbles: true }));
}

function change(input: HTMLInputElement, value: string): void {
  input.value = value;
  const view = input.ownerDocument.defaultView;
  if (!view) throw new Error('Input has no defaultView');
  input.dispatchEvent(new view.Event('change', { bubbles: true }));
}

function input(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  element.value = value;
  const view = element.ownerDocument.defaultView;
  if (!view) throw new Error('Element has no defaultView');
  element.dispatchEvent(new view.Event('input', { bubbles: true }));
  element.dispatchEvent(new view.Event('change', { bubbles: true }));
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
    expect(document.querySelector('label[for="repo-url"]')?.textContent).toBe('Task repository URL');
    expect(document.querySelector('label[for="issues-repo-url"]')?.textContent).toBe('Issues repository URL');
    expect(document.querySelector('[data-testid="task-repo-url"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="issues-repo-url"]')).not.toBeNull();
    expect(document.querySelector('[data-probe="/api/preflight"]')).not.toBeNull();
    expect(document.querySelector('[data-probe="/api/gateway-test?stage=1"]')?.getAttribute('data-auth')).toBe('true');
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
    await waitFor(() => expect(document.querySelector('#state')?.textContent).toBe('Current preflight completed.'));
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

  test('displays gateway and LLM test buttons with correct endpoints', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: () => createJsonResponse({ status: 'ok' }),
    });

    // Verify Gateway Test button has stage=1 parameter
    const gatewayTestButton = [...document.querySelectorAll('.health-check-button')]
      .find(btn => btn.textContent?.includes('Test Gateway'));
    expect(gatewayTestButton).toBeDefined();
    expect(gatewayTestButton?.getAttribute('data-probe')).toBe('/api/gateway-test?stage=1');
    
    // Verify LLM Test button has stage=2 and responseSmoke parameters
    const llmTestButton = [...document.querySelectorAll('.health-check-button')]
      .find(btn => btn.textContent?.includes('Test LLM'));
    expect(llmTestButton).toBeDefined();
    expect(llmTestButton?.getAttribute('data-probe')).toBe('/api/gateway-test?stage=2&responseSmoke=true');
    
    // Verify Check Status button does not exist
    const checkStatusButton = [...document.querySelectorAll('.health-check-button')]
      .find(btn => btn.textContent?.includes('Check Status'));
    expect(checkStatusButton).toBeUndefined();
  });

  test('shows failure reasons and progress context in recent runs', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: async (path) => {
        if (path !== '/api/runs') return createJsonResponse({});
        const retryTimeoutMs = Number(process.env.TEST_RETRY_TIMEOUT ?? 10);
        await new Promise((resolve) => setTimeout(resolve, retryTimeoutMs));
        return createJsonResponse({
          runs: [
            {
              id: 'kaseki-901',
              status: 'failed',
              createdAt: '2026-06-09T12:00:00Z',
              failureClass: 'validation_failed',
              error: 'fallback error',
              taskProgressPercent: 25,
              progress: { stage: 'pre-agent validation' },
            },
          ],
        });
      },
    });

    click(document.querySelector('#refresh-runs'));
    await waitFor(() => expect(document.querySelectorAll('#runs-list button')).toHaveLength(1));
    expect(document.querySelector('#runs-list')?.textContent).toContain('validation_failed');
    expect(document.querySelector('#runs-list')?.textContent).toContain('pre-agent validation');
    expect(document.querySelector('#runs-list')?.textContent).toContain('25%');
    expect(document.querySelector('#runs-list button')?.getAttribute('title')).toContain('validation_failed');
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

    const runIdInput = document.querySelector<HTMLInputElement>('#run-id');
    if (!runIdInput) throw new Error('Expected #run-id to exist');
    runIdInput.value = 'kaseki-301';
    click(document.querySelector('#full-results-btn'));
    await waitFor(() => expect(calls.map((call) => call.path)).toContain('/api/runs/kaseki-301/status'));

    click(document.querySelector('.tab-btn[data-tab="artifacts"]'));
    await waitFor(() => expect(document.querySelectorAll('#artifacts-output .artifact-item')).toHaveLength(1));

    expect(document.querySelector('#full-results-modal')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('#modal-title-heading')?.textContent).toBe('Full Results — kaseki-301');
    expect(document.querySelector('#tab-artifacts')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('#tab-artifacts')?.getAttribute('aria-hidden')).toBe('false');
    expect(document.querySelector('#tab-status')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#tab-status')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('#artifacts-output .artifact-item-name')?.textContent).toBe('report.json');
    expect(document.querySelector('#artifacts-output')?.textContent).not.toContain('archive.tar');
    expect(document.querySelector('#artifacts-output')?.textContent).not.toContain('missing.txt');

    click(document.querySelector('#modal-close-btn'));
    click(document.querySelector('#full-results-btn'));
    await waitFor(() => expect(document.querySelector('#tab-status')?.hasAttribute('hidden')).toBe(false));
    expect(document.querySelector('#tab-status')?.getAttribute('aria-hidden')).toBe('false');
    expect(document.querySelector('#tab-artifacts')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#tab-artifacts')?.getAttribute('aria-hidden')).toBe('true');
  });

  test('selecting a GitHub issue carries its repository into the submit form', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/github-issues') {
          return createJsonResponse([
            {
              number: 517,
              title: 'Stage names drift',
              body: 'Align the setup stage name.',
              created_at: new Date().toISOString(),
            },
          ]);
        }
        return createJsonResponse({});
      },
    });

    click(document.querySelector('[data-tab="issues"]'));
    const issuesRepoInput = document.querySelector<HTMLInputElement>('#issues-repo-url');
    const repoInput = document.querySelector<HTMLInputElement>('#repo-url');
    const taskPrompt = document.querySelector<HTMLTextAreaElement>('#task-prompt');
    if (!issuesRepoInput || !repoInput || !taskPrompt) throw new Error('Expected issue and submit inputs to exist');

    input(issuesRepoInput, 'CyanAutomation/kaseki-agent');
    click(document.querySelector('#load-issues-btn'));
    await waitFor(() => expect(document.querySelector('#issues-list')?.textContent).toContain('Stage names drift'));
    expect(document.querySelector('.issues-list-item')?.tagName).toBe('BUTTON');
    expect(document.querySelector('#state')?.textContent).toBe('Issues loaded.');
    expect(document.querySelector('#output-meta')?.textContent).toBe('Status: ok');
    expect(document.querySelector('#output')?.textContent).toContain('"issueCount": 1');

    click(document.querySelector('.issues-list-item'));
    expect(document.querySelector('#submit-tab')?.getAttribute('aria-hidden')).toBe('false');
    expect(repoInput.value).toBe('https://github.com/CyanAutomation/kaseki-agent');
    expect(taskPrompt.value).toBe([
      'GitHub issue #517: Stage names drift',
      'https://github.com/CyanAutomation/kaseki-agent/issues/517',
      '',
      'Align the setup stage name.',
    ].join('\n'));
  });

  test('normalizes recent repository entries across submit and issues flows', async () => {
    const { dom, document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/github-issues') {
          return createJsonResponse([
            {
              number: 516,
              title: 'Progress fallback issue',
              body: 'Use better progress fallback.',
              created_at: new Date().toISOString(),
            },
          ]);
        }
        return createJsonResponse({ runs: [] });
      },
    });

    const repoInput = document.querySelector<HTMLInputElement>('#repo-url');
    const issuesRepoInput = document.querySelector<HTMLInputElement>('#issues-repo-url');
    if (!repoInput || !issuesRepoInput) throw new Error('Expected repo inputs to exist');

    input(repoInput, 'https://github.com/CyanAutomation/kaseki-agent');
    dom.window.sessionStorage.setItem('kasekiRecentRepos', JSON.stringify(['https://github.com/CyanAutomation/kaseki-agent']));

    click(document.querySelector('[data-tab="issues"]'));
    input(issuesRepoInput, 'CyanAutomation/kaseki-agent');
    click(document.querySelector('#load-issues-btn'));
    await waitFor(() => expect(document.querySelector('#issues-list')?.textContent).toContain('Progress fallback issue'));

    expect(JSON.parse(dom.window.sessionStorage.getItem('kasekiRecentRepos') || '[]')).toEqual([
      'https://github.com/CyanAutomation/kaseki-agent',
    ]);
  });

  test('submitting a validated task immediately surfaces the new run id', async () => {
    const { document, calls } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/validate') {
          return createJsonResponse({
            isValid: true,
            checks: [{ name: 'repo-reachable', status: 'pass', message: 'ok' }],
            estimatedDurationSeconds: 10,
          });
        }
        if (path === '/api/runs') {
          return createJsonResponse({
            id: 'kaseki-777',
            status: 'queued',
            createdAt: '2026-06-12T21:30:00.000Z',
          }, 202);
        }
        if (path === '/api/runs/kaseki-777/status') {
          return createJsonResponse({ id: 'kaseki-777', status: 'running', elapsedSeconds: 1 });
        }
        return createJsonResponse({ runs: [] });
      },
    });

    const repoInput = document.querySelector<HTMLInputElement>('#repo-url');
    const taskPrompt = document.querySelector<HTMLTextAreaElement>('#task-prompt');
    const runIdInput = document.querySelector<HTMLInputElement>('#run-id');
    if (!repoInput || !taskPrompt || !runIdInput) throw new Error('Expected submit inputs to exist');

    input(repoInput, 'https://github.com/CyanAutomation/kaseki-agent');
    input(taskPrompt, 'Inspect the repository and report stage naming drift.');
    runIdInput.value = 'kaseki-old';
    click(document.querySelector('#validate'));
    await waitFor(() => expect(document.querySelector<HTMLButtonElement>('#submit')?.disabled).toBe(false));

    click(document.querySelector('#submit'));
    expect(runIdInput.value).toBe('');
    expect(document.querySelector('#output-meta')?.textContent).toBe('Status: submitting');
    expect(document.querySelector('#output-meta')?.textContent).not.toContain('kaseki-old');
    await waitFor(() => expect(document.querySelector<HTMLInputElement>('#run-id')?.value).toBe('kaseki-777'));
    expect(document.querySelector('#output-meta')?.textContent).toContain('Run ID: kaseki-777');
    expect(document.querySelector('#state')?.textContent).toBe('Run submitted.');
    const submitCall = calls.find((call) => call.path === '/api/runs' && call.init?.method === 'POST');
    expect(submitCall).toBeDefined();
    const submitBody = JSON.parse(String(submitCall?.init?.body || '{}')) as { idempotencyKey?: string };
    expect(submitBody.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('renders stdout modal content from structured log responses', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/runs/kaseki-302/status') return createJsonResponse({ id: 'kaseki-302', status: 'running' });
        if (path === '/api/runs/kaseki-302/logs/stdout?tail=lines&lines=200') {
          return createJsonResponse({ logType: 'stdout', content: 'line one\nline two\n', size: 18 });
        }
        return createJsonResponse({});
      },
    });

    const runIdInput = document.querySelector<HTMLInputElement>('#run-id');
    if (!runIdInput) throw new Error('Expected #run-id to exist');
    runIdInput.value = 'kaseki-302';
    click(document.querySelector('#full-results-btn'));
    await waitFor(() => expect(document.querySelector('#full-results-modal')?.hasAttribute('hidden')).toBe(false));

    click(document.querySelector('.tab-btn[data-tab="stdout"]'));
    await waitFor(() => expect(document.querySelector('#stdout-output')?.textContent).toBe('line one\nline two\n'));
    expect(document.querySelector('#stdout-output')?.textContent).not.toBe('[object Object]');
  });

  test('summarizes noisy preflight and artifact responses in the response panel', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/preflight') {
          return createJsonResponse({
            status: 'ok',
            checks: [
              { name: 'results-dir', ok: true, detail: 'writable' },
              { name: 'template', ok: false, detail: 'stale', remediation: 'bootstrap' },
            ],
            image: 'docker.io/cyanautomation/kaseki-agent:latest',
            templateRef: 'abc123',
            resultsDir: '/agents/kaseki-results',
            containerStartup: {
              scope: 'startup',
              current: false,
              readinessImpact: 'excluded-from-current-readiness',
              timestamp: '2026-06-15T21:47:29.203Z',
              checks: [
                { name: 'git-freshness', ok: true, detail: 'Git repository is readable and at ref: d8cf3954' },
              ],
            },
            doctorStdoutTail: 'large nested payload should not be displayed',
          });
        }
        if (path === '/api/runs/kaseki-303/artifacts') {
          return createJsonResponse({
            id: 'kaseki-303',
            runStatus: 'failed',
            artifactCount: 2,
            recommended: ['failure.json'],
            artifacts: [
              { name: 'failure.json', available: true, contentType: 'application/json', size: 100 },
              { name: 'missing.txt', available: false, contentType: 'text/plain', size: 0 },
            ],
          });
        }
        return createJsonResponse({});
      },
    });

    click(document.querySelector('[data-probe="/api/preflight"]'));
    await waitFor(() => expect(document.querySelector('#output')?.textContent).toContain('"checkCount": 2'));
    expect(document.querySelector('#output')?.textContent).toContain('"currentDiagnostics"');
    expect(document.querySelector('#output')?.textContent).toContain('"startupDiagnostics"');
    expect(document.querySelector('#output')?.textContent).toContain('Historical startup diagnostics only');
    expect(document.querySelector('#output')?.textContent).toContain('"failedChecks"');
    expect(document.querySelector('#output')?.textContent).not.toContain('large nested payload');
    expect(document.querySelector('#response-summary')?.textContent).toContain('Startup diagnostics');

    const runIdInput = document.querySelector<HTMLInputElement>('#run-id');
    if (!runIdInput) throw new Error('Expected #run-id to exist');
    runIdInput.value = 'kaseki-303';
    click(document.querySelector('#full-results-btn'));
    await waitFor(() => expect(document.querySelector('#full-results-modal')?.hasAttribute('hidden')).toBe(false));
    click(document.querySelector('.tab-btn[data-tab="artifacts"]'));
    await waitFor(() => expect(document.querySelector('#artifacts-output')?.textContent).toContain('failure.json'));
    expect(document.querySelector('#artifacts-output')?.textContent).not.toContain('missing.txt');
    expect(document.querySelector('#output')?.textContent).toContain('"path": "/api/preflight"');
    expect(document.querySelector('#output')?.textContent).not.toContain('"availableArtifacts"');
  });

  test('renders gateway failures with retry guidance', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/validate') {
          return createJsonResponse({
            isValid: true,
            checks: [{ name: 'repo-reachable', status: 'pass', message: 'ok' }],
          });
        }
        if (path === '/api/runs') return createTextResponse('Bad Gateway', 502);
        return createJsonResponse({ runs: [] });
      },
    });

    const repoInput = document.querySelector<HTMLInputElement>('#repo-url');
    const taskPrompt = document.querySelector<HTMLTextAreaElement>('#task-prompt');
    if (!repoInput || !taskPrompt) throw new Error('Expected submit inputs to exist');

    input(repoInput, 'https://github.com/CyanAutomation/kaseki-agent');
    input(taskPrompt, 'Inspect the repository and report docs formatting drift.');
    click(document.querySelector('#validate'));
    await waitFor(() => expect(document.querySelector<HTMLButtonElement>('#submit')?.disabled).toBe(false));

    click(document.querySelector('#submit'));
    await waitFor(() => expect(document.querySelector('#state')?.textContent).toContain('web gateway'));
    expect(document.querySelector('#output')?.textContent).toContain('"status": 502');
    expect(document.querySelector('#output')?.textContent).toContain('retry once');
    expect(document.querySelector('#output')?.textContent).toContain('Bad Gateway');
  });
});
