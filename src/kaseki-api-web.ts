import { Router } from 'express';

const controllerPage = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Kaseki Task Console</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --panel: #fffdf8;
        --ink: #1e2628;
        --muted: #566568;
        --line: #cbd4cf;
        --focus: #146b6d;
        --accent: #b84b2d;
        --ok: #0c6951;
        --bad: #a6332a;
        --space-1: 8px;
        --space-2: 12px;
        --space-3: 16px;
        --space-4: 24px;
        --control-gap: var(--space-2);
        --control-min-height: 42px;
        --control-pad: var(--space-2) var(--space-3);
      }
      * { box-sizing: border-box; letter-spacing: 0; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        display: grid;
        gap: var(--space-4);
        grid-template-columns: minmax(0, 1fr);
        margin: 0 auto;
        max-width: 1260px;
        padding: var(--space-3);
      }
      h1, h2 { margin: 0; }
      h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.12; }
      h2 { font-size: clamp(20px, 2.2vw, 24px); line-height: 1.2; }
      p { color: var(--muted); font-size: 16px; line-height: 1.5; margin: var(--space-1) 0 0; }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: var(--space-4);
      }
      header, form, .stack, fieldset { display: grid; gap: var(--space-3); }
      .stack { gap: var(--space-4); }
      section.panel { display: grid; gap: var(--space-3); }
      fieldset {
        border: 1px solid var(--line);
        border-radius: 8px;
        margin: 0;
        padding: var(--space-3);
      }
      legend { font-weight: 650; padding: 0 var(--space-1); }
      .form-fields { display: grid; gap: var(--space-3); }
      .form-field { display: grid; gap: var(--space-1); }
      .form-field > label { font-size: 14px; font-weight: 650; line-height: 1.35; }
      .field-helper { color: var(--muted); font-size: 14px; line-height: 1.5; }
      .field-error { color: var(--bad); font-size: 14px; line-height: 1.4; min-height: 1em; }
      input, textarea, select, button {
        border: 1px solid #99aaa5;
        border-radius: 6px;
        color: inherit;
        font: inherit;
      }
      input, textarea, select {
        background: #fff;
        min-height: var(--control-min-height);
        padding: 10px 11px;
        width: 100%;
      }
      textarea { min-height: 140px; resize: vertical; }
      input:focus, textarea:focus, select:focus, button:focus {
        outline: 3px solid color-mix(in srgb, var(--focus) 35%, transparent);
        outline-offset: 1px;
      }
      .grid, .checks, .action-row, .run-status { display: grid; gap: var(--control-gap); }
      .grid, .checks, .action-row, .run-status { grid-template-columns: minmax(0, 1fr); }
      .check {
        align-items: center;
        display: flex;
        gap: var(--space-1);
        font-weight: 500;
        min-height: var(--control-min-height);
      }
      .check input { flex: 0 0 20px; height: 20px; margin: 0; width: 20px; }
      .check-copy { display: grid; gap: 2px; }
      .check-label { color: var(--ink); font-size: 14px; font-weight: 550; line-height: 1.35; }
      .check-helper { color: var(--muted); font-size: 14px; line-height: 1.5; }
      .action-row { align-items: end; }
      .action-row > button, .run-status > button { width: 100%; }
      .action-row { align-items: end; }
      .action-row > button, .run-status > button { width: 100%; }
      .run-status { grid-template-columns: minmax(0, 1fr); }
      button {
        background: var(--ink);
        color: #fff;
        cursor: pointer;
        min-height: var(--control-min-height);
        padding: var(--control-pad);
      }
      button.secondary { background: #eef2ee; color: var(--ink); }
      button.run { background: var(--accent); }
      button:disabled { cursor: wait; opacity: .65; }
      .response-panel {
        background: #172022;
        border: 1px solid #2e3a3d;
        border-radius: 8px;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-height: 300px;
        overflow: hidden;
      }
      .response-meta {
        border-bottom: 1px solid #2e3a3d;
        color: #b9c8c3;
        font-size: 14px;
        margin: 0;
        padding: var(--space-2) var(--space-3);
      }
      .response-log {
        color: #e4eee9;
        margin: 0;
        min-height: 0;
        overflow: auto;
        padding: var(--space-3);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .response-log.empty { color: #9db0aa; }
      #state { color: var(--muted); min-height: 22px; }
      #state.ok { color: var(--ok); }
      #state.bad { color: var(--bad); }
      @media (min-width: 768px) {
        main {
          grid-template-columns: minmax(320px, 560px) minmax(320px, 1fr);
          padding: clamp(var(--space-3), 4vw, 48px);
        }
        .grid, .checks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .action-row {
          grid-template-columns: repeat(auto-fit, minmax(160px, max-content));
        }
        .action-row.run-actions { justify-content: end; }
        .action-row.controller-actions { justify-content: start; }
        .run-status { grid-template-columns: minmax(0, 1fr) minmax(160px, max-content); }
      }
      @media (max-width: 767px) {
        .action-row.run-actions > .run { order: 1; }
        .response-panel { min-height: 52vh; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel" aria-labelledby="page-title">
        <header>
          <h1 id="page-title">Kaseki Task Console</h1>
          <p>Submit a repository task to this Kaseki API controller and inspect its checks before a run.</p>
        </header>
      </section>
      <section class="panel stack" aria-labelledby="run-configuration-heading">
        <div>
          <h2 id="run-configuration-heading">Run configuration</h2>
        </div>
        <form id="run-form">
          <fieldset class="form-fields">
            <legend>Task submission</legend>
            <div class="form-field">
              <label for="token">API bearer token</label>
              <input id="token" name="token" type="password" autocomplete="off" placeholder="Required for preflight and task actions">
              <p class="field-helper">Stored in this tab only after a successful request.</p>
              <p class="field-error" data-error-for="token" aria-live="polite"></p>
            </div>
            <div class="form-field">
              <label for="repo-url">Repository URL</label>
              <input id="repo-url" name="repoUrl" type="url" required placeholder="https://github.com/org/repo">
              <p class="field-error" data-error-for="repoUrl" aria-live="polite"></p>
            </div>
            <div class="grid">
              <div class="form-field">
                <label for="ref">Git ref</label>
                <input id="ref" name="ref" value="main" required>
                <p class="field-error" data-error-for="ref" aria-live="polite"></p>
              </div>
              <div class="form-field">
                <label for="publish-mode">Publish mode</label>
                <select id="publish-mode" name="publishMode">
                  <option value="pr">Pull request</option>
                  <option value="draft_pr">Draft pull request</option>
                  <option value="branch">Branch only</option>
                  <option value="auto">Auto</option>
                  <option value="none">Do not publish</option>
                </select>
                <p class="field-error" data-error-for="publishMode" aria-live="polite"></p>
              </div>
            </div>
            <div class="grid">
              <div class="form-field">
                <label for="task-mode">Task mode</label>
                <select id="task-mode" name="taskMode">
                  <option value="patch">Patch</option>
                  <option value="inspect">Inspect</option>
                </select>
                <p class="field-error" data-error-for="taskMode" aria-live="polite"></p>
              </div>
              <div class="form-field">
                <label for="timeout-seconds">Timeout seconds</label>
                <input id="timeout-seconds" name="timeoutSeconds" type="number" min="60" max="10800" placeholder="Controller default">
                <p class="field-error" data-error-for="timeoutSeconds" aria-live="polite"></p>
              </div>
            </div>
            <div class="form-field">
              <label for="task-prompt">Task details</label>
              <textarea id="task-prompt" name="taskPrompt" required minlength="10" placeholder="Describe the task for the ephemeral agent."></textarea>
              <p class="field-error" data-error-for="taskPrompt" aria-live="polite"></p>
            </div>
          </fieldset>
          <fieldset aria-describedby="run-options-helper">
            <legend>Run options</legend>
            <p class="field-helper" id="run-options-helper">These options change how the run executes.</p>
            <div class="checks">
              <label class="check">
                <input name="scouting" type="checkbox">
                <span class="check-copy">
                  <span class="check-label">Enable scouting</span>
                  <span class="check-helper">Runs an additional scouting pass before the main task.</span>
                </span>
              </label>
              <label class="check">
                <input name="startupCheck" type="checkbox">
                <span class="check-copy">
                  <span class="check-label">Startup check only</span>
                  <span class="check-helper">Performs startup checks only and skips task execution.</span>
                </span>
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Run actions</legend>
            <div class="action-row run-actions">
            <button class="secondary" id="validate" type="button">Validate task</button>
            <button class="run" id="submit" type="submit">Start run</button>
            </div>
          </fieldset>
        </form>
      </section>
      <section class="panel stack" aria-labelledby="controller-checks-heading">
        <div>
          <h2 id="controller-checks-heading">Controller checks</h2>
          <p>Health and readiness are public probes. Controller preflight uses the bearer token.</p>
        </div>
        <fieldset>
          <legend>Controller actions</legend>
          <div class="action-row controller-actions">
            <button class="secondary" data-probe="/health" type="button">Health</button>
            <button class="secondary" data-probe="/ready" type="button">Readiness</button>
            <button class="secondary" data-probe="/api/preflight" data-auth="true" type="button">Preflight</button>
            <button class="secondary" id="status" type="button">Check status</button>
          </div>
          <div class="run-status">
            <div class="form-field">
              <label for="run-id">Run ID</label>
              <input id="run-id" placeholder="Filled after a run is submitted">
              <p class="field-error" data-error-for="runId" aria-live="polite"></p>
            </div>
          </div>
        </fieldset>
        <div id="state" role="status" aria-live="polite"></div>
      </section>
      <section class="panel stack" aria-labelledby="responses-heading">
        <div>
          <h2 id="responses-heading">Responses</h2>
        </div>
        <div class="response-panel">
          <p class="response-meta" id="output-meta" aria-live="polite">Status: idle</p>
          <pre class="response-log empty" id="output" aria-live="polite">No output yet. Run a controller action to see responses and events.</pre>
        </div>
      </section>
    </main>
    <script>
      const form = document.querySelector('#run-form');
      const output = document.querySelector('#output');
      const outputMeta = document.querySelector('#output-meta');
      const state = document.querySelector('#state');
      const tokenInput = document.querySelector('#token');
      const runIdInput = document.querySelector('#run-id');
      tokenInput.value = sessionStorage.getItem('kasekiApiToken') || '';

      function sanitizeOutput(value) {
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value, null, 2);
        } catch {
          return String(value);
        }
      }

      function isLikelyBearerToken(token) {
        return /^[A-Za-z0-9._~+\/-]{8,512}$/.test(token);
      }

      function setState(message, kind) {
        state.textContent = message;
        state.className = kind || '';
      }

      function setOutputMetadata(status, runId) {
        outputMeta.textContent = 'Status: ' + status + (runId ? ' | Run ID: ' + runId : '');
      }

      function setOutputBody(text) {
        output.textContent = text;
        output.classList.toggle('empty', !text);
      }

      function requestBody() {
        const data = new FormData(form);
        const timeoutSeconds = String(data.get('timeoutSeconds') || '').trim();
        const body = {
          repoUrl: String(data.get('repoUrl') || '').trim(),
          ref: String(data.get('ref') || 'main').trim(),
          taskPrompt: String(data.get('taskPrompt') || '').trim(),
          publishMode: String(data.get('publishMode') || 'pr'),
          taskMode: String(data.get('taskMode') || 'patch'),
        };
        if (data.get('scouting')) body.scouting = { enabled: true };
        if (data.get('startupCheck')) body.startupCheck = true;
        if (timeoutSeconds) {
          const parsed = Number(timeoutSeconds);
          if (!isNaN(parsed)) {
            body.timeoutSeconds = parsed;
          }
        }
        return body;
      }

      async function apiRequest(path, options) {
        const token = tokenInput.value.trim();
        const needsAuth = options && options.auth;
        if (needsAuth && !token) throw new Error('Enter the API bearer token first.');
        if (needsAuth && token && !isLikelyBearerToken(token)) {
          throw new Error('Token format looks invalid. Use a plain bearer token without spaces.');
        }
        const response = await fetch(path, {
          method: options && options.method || 'GET',
          headers: {
            ...(needsAuth ? { Authorization: 'Bearer ' + token } : {}),
            ...(options && options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options && options.body ? JSON.stringify(options.body) : undefined,
        });
        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('json') ? await response.json() : await response.text();
        if (needsAuth && response.ok) sessionStorage.setItem('kasekiApiToken', token);
        const runId = payload && typeof payload.id === 'string'
          ? payload.id
          : String(runIdInput.value || '').trim();
        setOutputMetadata(response.ok ? 'completed' : 'failed', runId || undefined);
        setOutputBody(JSON.stringify({
          method: options && options.method || 'GET',
          path,
          status: response.status,
          response: payload,
        }, null, 2));
        setState(response.ok ? 'Request completed.' : 'Request failed.', response.ok ? 'ok' : 'bad');
        return { payload, response };
      }

      async function run(button, path, options) {
        button.disabled = true;
        setOutputMetadata('running', String(runIdInput.value || '').trim() || undefined);
        setState('Contacting the controller...');
        try {
          await apiRequest(path, options);
        } catch (error) {
          setOutputMetadata('failed', String(runIdInput.value || '').trim() || undefined);
          setOutputBody(sanitizeOutput(error instanceof Error ? error.message : String(error)));
          setState('Request could not be sent.', 'bad');
        } finally {
          button.disabled = false;
        }
      }

      document.querySelectorAll('[data-probe]').forEach((button) => {
        button.addEventListener('click', () => run(button, button.dataset.probe, {
          auth: button.dataset.auth === 'true',
        }));
      });
      document.querySelector('#validate').addEventListener('click', (event) => {
        if (!form.reportValidity()) return;
        run(event.currentTarget, '/api/validate', { method: 'POST', auth: true, body: requestBody() });
      });
      document.querySelector('#status').addEventListener('click', (event) => {
        const runId = runIdInput.value.trim();
        if (!runId) {
          setOutputMetadata('idle');
          setOutputBody('Submit a run or enter a run ID first.');
          setState('Run status needs a run ID.', 'bad');
          return;
        }
        run(event.currentTarget, '/api/runs/' + encodeURIComponent(runId) + '/status', { auth: true });
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const button = document.querySelector('#submit');
        button.disabled = true;
        setOutputMetadata('running', String(runIdInput.value || '').trim() || undefined);
        setState('Contacting the controller...');
        apiRequest('/api/runs', { method: 'POST', auth: true, body: requestBody() })
          .then(({ payload, response }) => {
            if (response.ok && payload && typeof payload.id === 'string') {
              runIdInput.value = payload.id;
              setOutputMetadata('completed', payload.id);
            }
          })
          .catch((error) => {
            setOutputMetadata('failed', String(runIdInput.value || '').trim() || undefined);
            setOutputBody(sanitizeOutput(error instanceof Error ? error.message : String(error)));
            setState('Request could not be sent.', 'bad');
          })
          .finally(() => {
            button.disabled = false;
          });
      });
    </script>
  </body>
</html>
`;

export function createWebRouter(): Router {
  const router = Router();
  router.get(['/', '/ui'], (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'unsafe-inline'");
    res.set('Referrer-Policy', 'no-referrer');
    res.type('html').send(controllerPage);
  });
  return router;
}
