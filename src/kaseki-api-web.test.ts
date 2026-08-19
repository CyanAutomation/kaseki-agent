/* global Document, HTMLTextAreaElement, HTMLSelectElement */
import { JSDOM, VirtualConsole } from 'jsdom';
import { getWebConsoleResponse } from './kaseki-api-web';

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

type FetchHandler = (path: string, init?: FetchInit) => MockResponse | Promise<MockResponse>;
type RouteResponse = MockResponse | Promise<MockResponse> | FetchHandler;
type RouteResponses = Record<string, RouteResponse>;

const openDoms: JSDOM[] = [];

async function fetchConsole(path = '/'): Promise<{ response: Response; body: string }> {
  const { status, headers, body } = getWebConsoleResponse(path);
  return {
    response: new Response(status === 204 ? null : body, { status, headers }),
    body,
  };
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
    const dom = openDoms.pop();
    (dom?.window as unknown as { __kasekiDispose?: () => void }).__kasekiDispose?.();
    dom?.window.close();
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

function routeResponses(routes: RouteResponses, fallback: MockResponse = createJsonResponse({})): FetchHandler {
  return (path, init) => {
    const route = routes[path];
    if (typeof route === 'function') return route(path, init);
    return route || fallback;
  };
}

function getElement<T extends Element = Element>(document: Document, selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Expected ${selector} to exist`);
  return element;
}

function getText(document: Document, selector: string): string {
  return getElement(document, selector).textContent || '';
}

function expectText(document: Document, selector: string, expected: string): void {
  expect(getText(document, selector)).toBe(expected);
}

function expectTextContains(document: Document, selector: string, expected: string): void {
  expect(getText(document, selector)).toContain(expected);
}

function expectTextNotContains(document: Document, selector: string, expected: string): void {
  expect(getText(document, selector)).not.toContain(expected);
}

function expectAttribute(document: Document, selector: string, name: string, expected: string): void {
  expect(getElement(document, selector).getAttribute(name)).toBe(expected);
}

function expectHidden(document: Document, selector: string, expected: boolean): void {
  expect(getElement(document, selector).hasAttribute('hidden')).toBe(expected);
}

function clickSelector(document: Document, selector: string): void {
  click(getElement(document, selector));
}

function inputSelector(document: Document, selector: string, value: string): void {
  input(getElement<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(document, selector), value);
}

function setRunId(document: Document, runId: string): void {
  getElement<HTMLInputElement>(document, '#run-id').value = runId;
}

function openFullResults(document: Document, runId: string): void {
  setRunId(document, runId);
  clickSelector(document, '#full-results-btn');
}

function healthCheckButton(document: Document, label: string): Element {
  const button = [...document.querySelectorAll('.health-check-button')]
    .find((candidate) => (candidate.textContent || '').includes(label));
  if (!button) throw new Error(`Expected health check button ${label} to exist`);
  return button;
}

async function refreshAndSelectFirstRun(document: Document): Promise<void> {
  clickSelector(document, '#refresh-runs');
  await waitFor(() => expect(document.querySelectorAll('#runs-list button')).not.toHaveLength(0));
  clickSelector(document, '#runs-list button');
}

describe('kaseki API web console routes', () => {
  test('serves an empty public favicon response', async () => {
    const { response } = await fetchConsole('/favicon.ico');
    expect(response.status).toBe(204);
  });

  test.each(['/', '/ui'])('serves the task console app shell from %s', async (path) => {
    const { response, body } = await fetchConsole(path);
    const dom = new JSDOM(body, { virtualConsole: new VirtualConsole() });
    const document = dom.window.document;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("style-src 'unsafe-inline'");
    expectText(document, 'h1', 'Kaseki Task Console');
    expectAttribute(document, '#header-api-token', 'aria-label', 'API bearer token');
    expectText(document, 'label[for="repo-url"]', 'Task repository URL');
    expectText(document, 'label[for="issues-repo-url"]', 'Issues repository URL');
    getElement(document, '[data-testid="task-repo-url"]');
    getElement(document, '[data-testid="issues-repo-url"]');
    getElement(document, '[data-probe="/api/preflight"]');
    expectAttribute(document, '[data-probe="/api/gateway-test?stage=1"]', 'data-auth', 'true');
    expectTextContains(document, '[data-probe="/api/gateway-test?stage=2&responseSmoke=true&piProvider=true"]', 'AI Model Test');
    expectAttribute(document, '#task-mode', 'name', 'taskMode');
    getElement(document, '#runs-list');
    expectTextContains(document, '#refresh-runs', 'Refresh runs');
    expectTextContains(document, '#cancel-run', 'Cancel run');
    expectTextContains(document, '[data-tab="artifacts"]', 'Artifacts');
    expectTextContains(document, '#recommended-artifacts', 'Key Diagnostics');
    expectTextContains(document, '#copy-diagnostic-bundle-btn', 'Copy Debug Summary');
    expectHidden(document, '#response-summary', true);
    expect(body).toContain("['failed', 'cancelled', 'canceled', 'timed_out']");
    expect(body).toContain("loadModalTab('events', { background: true })");
    expectAttribute(document, '#submit-tab', 'aria-hidden', 'true');
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

  test('keeps phase diagnostics visible while polling a run', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/runs/kaseki-219/status') {
          return createJsonResponse({
            id: 'kaseki-219',
            status: 'failed',
            correlationId: 'correlation-219',
            diagnosticEntryPoint: 'scouting-validation-errors.jsonl',
            error: 'critical change verification failed',
            phaseOutcome: { scouting: 'completed', weaving: 'failed' },
            diagnosticSummary: {
              phaseDiagnostics: [{ phase: 'scouting', severity: 'critical', reason: 'missing_file' }],
            },
          });
        }
        if (path === '/api/runs') return createJsonResponse({ runs: [{ id: 'kaseki-219', status: 'failed' }] });
        return createJsonResponse({ status: 'ok' });
      },
    });

    click(document.querySelector('#refresh-runs'));
    await waitFor(() => expect(document.querySelectorAll('#runs-list button')).toHaveLength(1));
    click(document.querySelector('#runs-list button'));
    await waitFor(() => expect(document.querySelector('#response-summary')?.textContent).toContain('Phase diagnostics'));
    expect(document.querySelector('#response-summary')?.textContent).toContain('scouting: critical: missing_file');
    // Note: Correlation ID is no longer displayed (removed for simplicity)
  });

  test('labels a recovered scouting handoff as fallback in phase outcomes', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/runs/kaseki-220/status': createJsonResponse({
          id: 'kaseki-220', status: 'running',
          phaseOutcome: { scouting: 'completed', weaving: 'running', scoutingFallback: true },
        }),
        '/api/runs': createJsonResponse({ runs: [{ id: 'kaseki-220', status: 'running' }] }),
      }, createJsonResponse({ status: 'ok' })),
    });

    await refreshAndSelectFirstRun(document);
    await waitFor(() => expectTextContains(document, '#response-summary', 'Scouting: Complete (fallback)'));
    expectTextContains(document, '#response-summary', 'Weaving: In progress');
  });

  test('flags degraded terminal evaluations and enables retry with diagnostics', async () => {
    const { document, calls } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/runs': createJsonResponse({ runs: [{ id: 'kaseki-261', status: 'completed' }] }),
        '/api/runs/kaseki-261/status': createJsonResponse({
          id: 'kaseki-261', status: 'completed',
          goalCheck: { status: 'warning', warning: 'goal_check_artifact_missing', exitCode: 0 },
          runEvaluation: { status: 'warning', warning: 'run_evaluation_failed_exit_86', exitCode: 86 },
        }),
        '/api/runs/kaseki-261/retry': createJsonResponse({ id: 'kaseki-262', status: 'queued' }, 202),
      }, createJsonResponse({ status: 'ok' })),
    });

    await refreshAndSelectFirstRun(document);
    await waitFor(() => expectTextContains(document, '#response-summary', 'Completed with evaluation warnings'));
    expectTextContains(document, '#response-summary', 'goal_check_artifact_missing');
    expectTextContains(document, '#response-summary', 'run_evaluation_failed_exit_86');
    expect(getElement<HTMLButtonElement>(document, '#retry-run-btn').disabled).toBe(false);

    clickSelector(document, '#retry-run-btn');
    await waitFor(() => expect(calls.some((call) => call.path === '/api/runs/kaseki-261/retry')).toBe(true));
  });

  test('prefers durable structured progress events over an inferred Docker-tail status', async () => {
    const { document, calls } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/runs': createJsonResponse({ runs: [{ id: 'kaseki-263', status: 'running' }] }),
        '/api/runs/kaseki-263/status': createJsonResponse({
          id: 'kaseki-263', status: 'running',
          progress: { stage: 'npm run lint:fix', updatedAt: '2026-08-19T21:47:28Z', source: 'docker-logs', timestampEstimated: true },
        }),
        '/api/runs/kaseki-263/events?tail=50': createJsonResponse({
          events: [{ stage: 'validation', displayName: 'Validation', updatedAt: '2026-08-19T21:47:30Z', source: 'progress.jsonl' }],
        }),
      }, createJsonResponse({ status: 'ok' })),
    });

    await refreshAndSelectFirstRun(document);
    await waitFor(() => expect(calls.some((call) => call.path === '/api/runs/kaseki-263/events?tail=50')).toBe(true));
    expectTextContains(document, '#response-summary', 'Validation');
    expectTextContains(document, '#response-summary', 'Confirmed controller progress event');
  });

  test('loads the recent run list into selectable run buttons', async () => {
    const { document, calls } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/runs': createJsonResponse({
          runs: [
            { id: 'kaseki-101', status: 'running', createdAt: '2026-06-09T12:00:00Z' },
            { id: 'kaseki-102', status: 'completed', createdAt: '2026-06-09T12:05:00Z' },
          ],
        }),
      }),
    });

    click(document.querySelector('#refresh-runs'));
    await waitFor(() => expect(document.querySelectorAll('#runs-list button')).toHaveLength(2));

    expect(calls[0]).toMatchObject({ path: '/api/runs' });
    expect([...document.querySelectorAll('#runs-list button')].map((button) => button.textContent)).toEqual([
      expect.stringContaining('kaseki-101'),
      expect.stringContaining('kaseki-102'),
    ]);
    expectTextContains(document, '#runs-list', 'running');
    expectTextContains(document, '#runs-list', 'completed');

    clickSelector(document, '#runs-list button');
    expect(getElement<HTMLInputElement>(document, '#run-id').value).toBe('kaseki-101');
    expect(getElement<HTMLButtonElement>(document, '#cancel-run').disabled).toBe(false);
    expectHidden(document, '#run-links', false);
  });

  test('disables cancellation and surfaces diagnosis for a terminal run', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/runs': createJsonResponse({ runs: [{ id: 'kaseki-199', status: 'failed', createdAt: '2026-07-04T12:00:00Z' }] }),
        '/api/runs/kaseki-199/status': createJsonResponse({
          id: 'kaseki-199',
          status: 'failed',
          lifecyclePhase: 'terminal',
          cancellable: false,
          attempt: { current: 2, maximum: 2, state: 'exhausted' },
          diagnosis: { severity: 'error', summary: 'Provider retry exhausted', remediation: 'Inspect provider attempts' },
        }),
        '/api/runs/kaseki-199/artifacts': createJsonResponse({ artifacts: [] }),
      }),
    });

    await refreshAndSelectFirstRun(document);
    await waitFor(() => expectTextContains(document, '#response-summary', 'Provider retry exhausted'));
    expect(getElement<HTMLButtonElement>(document, '#cancel-run').disabled).toBe(true);
    // Note: "Provider attempt" field is no longer displayed (removed for simplicity)
    expectTextContains(document, '#response-summary', 'Inspect provider attempts');
  });

  test('displays gateway and inference test buttons with correct endpoints', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: () => createJsonResponse({ status: 'ok' }),
    });

    expect(healthCheckButton(document, 'API Connection').getAttribute('data-probe')).toBe('/api/gateway-test?stage=1');
    expect(healthCheckButton(document, 'AI Model Test').getAttribute('data-probe'))
      .toBe('/api/gateway-test?stage=2&responseSmoke=true&piProvider=true');

    const checkStatusButton = [...document.querySelectorAll('.health-check-button')]
      .find(btn => (btn.textContent || '').includes('Check Status'));
    expect(checkStatusButton).toBeUndefined();
  });

  test('keeps other diagnostics available while one is running', async () => {
    let rejectRequest: ((error: Error) => void) | undefined;
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/gateway-test?stage=1': () => {
          return new Promise((_resolve, reject) => { rejectRequest = reject; });
        },
        '/api/runs': createJsonResponse({ runs: [] }),
      }, createJsonResponse({ status: 'ok' })),
    });
    const gateway = getElement<HTMLButtonElement>(document, '[data-probe="/api/gateway-test?stage=1"]');
    const inference = getElement<HTMLButtonElement>(document, '[data-probe="/api/gateway-test?stage=2&responseSmoke=true&piProvider=true"]');
    const repo = getElement<HTMLInputElement>(document, '[name="repoUrl"]');
    click(gateway);
    await waitFor(() => expect(gateway.disabled).toBe(true));
    expect(inference.disabled).toBe(false);
    expect(repo.disabled).toBe(false);
    expectTextContains(document, '#diagnostic-queue-state', 'Other read-only diagnostics remain available');
    rejectRequest?.(new Error('gateway unavailable'));
    await waitFor(() => expect(gateway.disabled).toBe(false));
    expect(inference.disabled).toBe(false);
    expect(repo.disabled).toBe(false);
    expectText(document, '#diagnostic-queue-state', 'Diagnostics are ready.');
  });

  test('summarizes gateway smoke results without OpenRouter recovery status', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/gateway-test?stage=1') {
          return createJsonResponse({ status: 'error', responseTime: 125 });
        }
        if (path === '/api/gateway-test?stage=2&responseSmoke=true&piProvider=true') {
          return createJsonResponse({
            status: 'ok',
            responseTime: 480,
            outputTokens: 7,
            streamSmokeValidated: true,
            largePromptSmokeValidated: true,
            piProviderSmoke: { status: 'ok' },
          });
        }
        if (path === '/api/runs') return createJsonResponse({ runs: [] });
        return createJsonResponse({ status: 'ok' });
      },
    });

    click(document.querySelector('[data-probe="/api/gateway-test?stage=1"]'));
    await waitFor(() => expect(document.querySelector('[data-summary="gateway"]')?.textContent).toBe('Failed'));
    expect(document.querySelector('[data-summary="gateway"]')?.className).toContain('bad');

    click(document.querySelector('[data-probe="/api/gateway-test?stage=2&responseSmoke=true&piProvider=true"]'));
    await waitFor(() => expect(document.querySelector('#response-summary')?.textContent).toContain('Gateway and Pi provider adapter passed.'));
    expectText(document, '[data-summary="llm-test"]', 'gateway 480ms · 7 tokens stream ok, large ok');
    expect(document.querySelector('#response-summary')?.textContent).not.toContain('OpenRouter');
  });

  test('summarizes labeled gateway, Pi adapter, and end-to-end telemetry', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/gateway-test?stage=2&responseSmoke=true&piProvider=true': createJsonResponse({
          status: 'ok',
          responseTime: 600,
          outputTokens: 11,
          modelTest: {
            gatewayInferenceMs: 420,
            piAdapterMs: 35,
            endToEndMs: 475,
          },
          streamSmokeValidated: true,
          largePromptSmokeValidated: true,
          piProviderSmoke: { status: 'ok' },
        }),
        '/api/runs': createJsonResponse({ runs: [] }),
      }, createJsonResponse({ status: 'ok' })),
    });

    clickSelector(document, '[data-probe="/api/gateway-test?stage=2&responseSmoke=true&piProvider=true"]');

    await waitFor(() => expectText(
      document,
      '[data-summary="llm-test"]',
      'gateway 420ms · Pi 35ms · total 475ms · 11 tokens stream ok, large ok',
    ));
  });

  test('keeps Pi provider gateway smoke diagnostics for adapter failures', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/gateway-test?stage=2&responseSmoke=true&piProvider=true': createJsonResponse({
          status: 'ok',
          responseTime: 510,
          partialSuccess: true,
          piProviderSmoke: {
            status: 'error',
            remediation: 'Check gateway configuration and Pi provider registration',
            diagnostics: {
              fieldsFound: ['message.output_text'],
              suggestedPatterns: ['message.output_text'],
              eventsByType: { message: 2 },
              debugOutputPath: '/tmp/pi-provider-debug.jsonl',
            },
          },
        }),
        '/api/runs': createJsonResponse({ runs: [] }),
      }, createJsonResponse({ status: 'ok' })),
    });

    clickSelector(document, '[data-probe="/api/gateway-test?stage=2&responseSmoke=true&piProvider=true"]');

    await waitFor(() => expectTextContains(document, '#response-summary', 'Gateway inference passed; Pi provider adapter contract failed. Diagnostics:'));
    expectTextContains(document, '#response-summary', 'Fields found: message.output_text');
    expectTextContains(document, '#response-summary', 'Event types seen: message(2)');
    expectTextContains(document, '#response-summary', 'Remediation: Check gateway configuration and Pi provider registration');
    expectText(document, '[data-summary="llm-test"]', 'Gateway passed; Pi adapter failed');
    expect(getElement(document, '[data-summary="llm-test"]').className).toContain('warning');
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
      fetchHandler: routeResponses({
        '/api/runs/kaseki-301/status': createJsonResponse({ id: 'kaseki-301', status: 'running' }),
        '/api/runs/kaseki-301/artifacts': createJsonResponse({
          artifacts: [
            { name: 'report.json', available: true, contentType: 'application/json', size: '1 KB' },
            { name: 'archive.tar', available: true, contentType: 'application/x-tar', size: '8 KB' },
            { name: 'missing.txt', available: false, contentType: 'text/plain', size: '1 KB' },
          ],
        }),
        '/api/results/kaseki-301/report.json': createJsonResponse({
          response: {
            file: 'report.json',
            contentType: 'application/json',
            content: '{"status":"ok"}',
          },
        }),
      }),
    });

    openFullResults(document, 'kaseki-301');
    await waitFor(() => expect(calls.map((call) => call.path)).toContain('/api/runs/kaseki-301/status'));

    clickSelector(document, '.tab-btn[data-tab="artifacts"]');
    await waitFor(() => expect(document.querySelectorAll('#artifacts-output .artifact-item')).toHaveLength(1));

    expectHidden(document, '#full-results-modal', false);
    expectText(document, '#modal-title-heading', 'Full Results — kaseki-301');
    expectHidden(document, '#tab-artifacts', false);
    expectAttribute(document, '#tab-artifacts', 'aria-hidden', 'false');
    expectHidden(document, '#tab-status', true);
    expectAttribute(document, '#tab-status', 'aria-hidden', 'true');
    expectText(document, '#artifacts-output .artifact-item-name', 'report.json');
    expectTextNotContains(document, '#artifacts-output', 'archive.tar');
    expectTextNotContains(document, '#artifacts-output', 'missing.txt');

    clickSelector(document, '#artifacts-output .artifact-item');
    await waitFor(() => expectTextContains(document, '.artifact-content-pre', '"status": "ok"'));
    expectTextNotContains(document, '.artifact-content-pre', 'report.json');

    clickSelector(document, '#modal-close-btn');
    clickSelector(document, '#full-results-btn');
    await waitFor(() => expectHidden(document, '#tab-status', false));
    expectAttribute(document, '#tab-status', 'aria-hidden', 'false');
    expectHidden(document, '#tab-artifacts', true);
    expectAttribute(document, '#tab-artifacts', 'aria-hidden', 'true');
  });

  test('leads failed status results with an actionable compact summary', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/runs/kaseki-303/status': createJsonResponse({
          id: 'kaseki-303',
          status: 'failed',
          exitCode: 88,
          attempt: { phase: 'coding', current: 2, maximum: 2, provider: 'gateway' },
          diagnosis: {
            phase: 'coding',
            summary: 'Provider finish_reason: error',
            remediation: 'Inspect provider-attempts.jsonl.',
          },
          artifacts: { diagnosticFiles: ['provider-attempts.jsonl', 'gateway-summary.json'] },
        }),
      }),
    });

    openFullResults(document, 'kaseki-303');
    await waitFor(() => expectTextContains(document, '#status-output', 'RUN SUMMARY'));
    const text = getText(document, '#status-output');
    expect(text).toContain('Provider: gateway');
    expect(text).toContain('Attempts: 2/2');
    expect(text).toContain('Diagnostics: provider-attempts.jsonl, gateway-summary.json');
    expect(text).toContain('Open the Artifacts tab for the raw files and the Events tab for the timeline.');
    expect(text).not.toContain('RAW STATUS');
  });

  test('selecting a GitHub issue carries its repository into the submit form', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/github-issues': createJsonResponse([
          {
            number: 517,
            title: 'Stage names drift',
            body: 'Align the setup stage name.',
            created_at: new Date().toISOString(),
          },
        ]),
      }),
    });

    clickSelector(document, '[data-tab="issues"]');
    inputSelector(document, '#issues-repo-url', 'CyanAutomation/kaseki-agent');
    clickSelector(document, '#load-issues-btn');
    await waitFor(() => expectTextContains(document, '#issues-list', 'Stage names drift'));
    expect(getElement(document, '.issues-list-item').tagName).toBe('BUTTON');
    expectText(document, '#state', 'Issues loaded.');
    expectText(document, '#output-meta', 'Status: ok');
    expectTextContains(document, '#output', '"issueCount": 1');

    clickSelector(document, '.issues-list-item');
    expectAttribute(document, '#submit-tab', 'aria-hidden', 'false');
    const repoInput = getElement<HTMLInputElement>(document, '#repo-url');
    const taskPrompt = getElement<HTMLTextAreaElement>(document, '#task-prompt');
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
      fetchHandler: routeResponses({
        '/api/validate': createJsonResponse({
          isValid: true,
          checks: [{ name: 'repo-reachable', status: 'pass', message: 'ok' }],
          estimatedDurationSeconds: 10,
        }),
        '/api/runs': createJsonResponse({
          id: 'kaseki-777',
          status: 'queued',
          createdAt: '2026-06-12T21:30:00.000Z',
        }, 202),
        '/api/runs/kaseki-777/status': createJsonResponse({ id: 'kaseki-777', status: 'running', elapsedSeconds: 1 }),
      }, createJsonResponse({ runs: [] })),
    });

    const runIdInput = getElement<HTMLInputElement>(document, '#run-id');

    inputSelector(document, '#repo-url', 'https://github.com/CyanAutomation/kaseki-agent');
    inputSelector(document, '#task-prompt', 'Inspect the repository and report stage naming drift.');
    runIdInput.value = 'kaseki-old';
    clickSelector(document, '#validate');
    await waitFor(() => expect(getElement<HTMLButtonElement>(document, '#submit').disabled).toBe(false));

    clickSelector(document, '#submit');
    expect(runIdInput.value).toBe('');
    expectText(document, '#output-meta', 'Status: submitting');
    expectTextNotContains(document, '#output-meta', 'kaseki-old');
    await waitFor(() => expect(getElement<HTMLInputElement>(document, '#run-id').value).toBe('kaseki-777'));
    expectTextContains(document, '#output-meta', 'Run ID: kaseki-777');
    expectText(document, '#state', 'Run submitted.');
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

  test('serializes structured stdout content instead of rendering [object Object]', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/runs/kaseki-303/status') return createJsonResponse({ id: 'kaseki-303', status: 'completed' });
        if (path === '/api/runs/kaseki-303/logs/stdout?tail=lines&lines=200') {
          return createJsonResponse({ logType: 'stdout', content: { message: 'structured agent output' } });
        }
        return createJsonResponse({});
      },
    });

    const runIdInput = document.querySelector<HTMLInputElement>('#run-id');
    if (!runIdInput) throw new Error('Expected #run-id to exist');
    runIdInput.value = 'kaseki-303';
    click(document.querySelector('#full-results-btn'));
    await waitFor(() => expect(document.querySelector('#full-results-modal')?.hasAttribute('hidden')).toBe(false));

    click(document.querySelector('.tab-btn[data-tab="stdout"]'));
    await waitFor(() => expect(document.querySelector('#stdout-output')?.textContent).toContain('structured agent output'));
    expect(document.querySelector('#stdout-output')?.textContent).not.toBe('[object Object]');
  });

  test('does not warn about a successful empty-diff run', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: (path) => {
        if (path === '/api/runs/kaseki-304/status') {
          return createJsonResponse({
            id: 'kaseki-304',
            status: 'completed',
            exitCode: 0,
            resultSummaryContent: '# Summary\nChanged Files: 0\nDiff Lines: 0',
          });
        }
        return createJsonResponse({});
      },
    });

    const runIdInput = document.querySelector<HTMLInputElement>('#run-id');
    if (!runIdInput) throw new Error('Expected #run-id to exist');
    runIdInput.value = 'kaseki-304';
    click(document.querySelector('#full-results-btn'));
    await waitFor(() => expect(document.querySelector('#status-output')?.textContent).toContain('Status: completed'));
    expect(document.querySelector('#status-output')?.textContent).not.toContain('fallback/failure signals');
  });

  test('summarizes noisy preflight and artifact responses in the response panel', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/preflight': createJsonResponse({
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
        }),
        '/api/runs/kaseki-303/artifacts': createJsonResponse({
          id: 'kaseki-303',
          runStatus: 'failed',
          artifactCount: 3,
          recommended: ['failure.json'],
          artifacts: [
            { name: 'failure.json', available: true, contentType: 'application/json', size: 100 },
            { name: 'pending-summary.md', available: true, contentType: 'text/markdown', size: 0 },
            { name: 'missing.txt', available: false, contentType: 'text/plain', size: 0 },
          ],
        }),
      }),
    });

    clickSelector(document, '[data-probe="/api/preflight"]');
    await waitFor(() => expectTextContains(document, '#output', '"checkCount": 2'));
    expectTextContains(document, '#output', '"currentDiagnostics"');
    expectTextContains(document, '#output', '"startupDiagnostics"');
    expectTextContains(document, '#output', 'Historical startup diagnostics only');
    expectTextContains(document, '#output', '"failedChecks"');
    expectTextNotContains(document, '#output', 'large nested payload');
    expectTextContains(document, '#response-summary', 'Startup diagnostics');

    openFullResults(document, 'kaseki-303');
    await waitFor(() => expectHidden(document, '#full-results-modal', false));
    clickSelector(document, '.tab-btn[data-tab="artifacts"]');
    await waitFor(() => expectTextContains(document, '#artifacts-output', 'failure.json'));
    expectTextNotContains(document, '#artifacts-output', 'pending-summary.md');
    expectTextNotContains(document, '#artifacts-output', 'missing.txt');
    expectTextContains(document, '#output', '"path": "/api/preflight"');
    expectTextNotContains(document, '#output', '"availableArtifacts"');
  });

  test('renders gateway failures with retry guidance', async () => {
    const { document } = await renderConsole({
      storedToken: 'token12345',
      fetchHandler: routeResponses({
        '/api/validate': createJsonResponse({
          isValid: true,
          checks: [{ name: 'repo-reachable', status: 'pass', message: 'ok' }],
        }),
        '/api/runs': createTextResponse('Bad Gateway', 502),
      }, createJsonResponse({ runs: [] })),
    });

    inputSelector(document, '#repo-url', 'https://github.com/CyanAutomation/kaseki-agent');
    inputSelector(document, '#task-prompt', 'Inspect the repository and report docs formatting drift.');
    clickSelector(document, '#validate');
    await waitFor(() => expect(getElement<HTMLButtonElement>(document, '#submit').disabled).toBe(false));

    clickSelector(document, '#submit');
    await waitFor(() => expectTextContains(document, '#state', 'web gateway'));
    expectTextContains(document, '#output', '"status": 502');
    expectTextContains(document, '#output', 'retry once');
    expectTextContains(document, '#output', 'Bad Gateway');
  });
});
