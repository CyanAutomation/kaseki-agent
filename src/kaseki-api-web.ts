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
      }
      * { box-sizing: border-box; letter-spacing: 0; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        display: grid;
        gap: 20px;
        grid-template-columns: minmax(320px, 560px) minmax(320px, 1fr);
        margin: 0 auto;
        max-width: 1260px;
        padding: clamp(20px, 4vw, 48px);
      }
      h1, h2 { line-height: 1.1; margin: 0; }
      h1 { font-size: clamp(30px, 4vw, 50px); }
      h2 { font-size: 17px; }
      p { color: var(--muted); margin: 8px 0 0; }
      form, section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 20px;
      }
      header, form, .stack { display: grid; gap: 16px; }
      label { display: grid; gap: 6px; font-weight: 650; }
      small { color: var(--muted); font-weight: 450; }
      input, textarea, select, button {
        border: 1px solid #99aaa5;
        border-radius: 6px;
        color: inherit;
        font: inherit;
      }
      input, textarea, select { background: #fff; padding: 10px 11px; width: 100%; }
      textarea { min-height: 140px; resize: vertical; }
      input:focus, textarea:focus, select:focus, button:focus {
        outline: 3px solid color-mix(in srgb, var(--focus) 35%, transparent);
        outline-offset: 1px;
      }
      .grid, .checks, .actions, .probes, .run-status { display: grid; gap: 10px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .checks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .check {
        align-items: center;
        display: flex;
        gap: 8px;
        font-weight: 500;
      }
      .check input { height: 18px; margin: 0; width: 18px; }
      .actions, .probes { grid-template-columns: repeat(3, minmax(0, max-content)); }
      .run-status { grid-template-columns: minmax(0, 1fr) max-content; }
      button {
        background: var(--ink);
        color: #fff;
        cursor: pointer;
        min-height: 42px;
        padding: 9px 13px;
      }
      button.secondary { background: #eef2ee; color: var(--ink); }
      button.run { background: var(--accent); }
      button:disabled { cursor: wait; opacity: .65; }
      pre {
        background: #172022;
        border-radius: 8px;
        color: #e4eee9;
        margin: 0;
        min-height: 360px;
        overflow: auto;
        padding: 16px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #state { color: var(--muted); min-height: 22px; }
      #state.ok { color: var(--ok); }
      #state.bad { color: var(--bad); }
      @media (max-width: 860px) {
        main { grid-template-columns: 1fr; padding: 18px; }
        .grid, .checks { grid-template-columns: 1fr; }
        .actions, .probes { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="stack">
        <header>
          <h1>Kaseki Task Console</h1>
          <p>Submit a repository task to this Kaseki API controller and inspect its checks before a run.</p>
        </header>
        <form id="run-form">
          <label>
            API bearer token
            <input id="token" name="token" type="password" autocomplete="off" placeholder="Required for preflight and task actions">
            <small>Stored in this tab only after a successful request.</small>
          </label>
          <label>
            Repository URL
            <input name="repoUrl" type="url" required placeholder="https://github.com/org/repo">
          </label>
          <div class="grid">
            <label>
              Git ref
              <input name="ref" value="main" required>
            </label>
            <label>
              Publish mode
              <select name="publishMode">
                <option value="pr">Pull request</option>
                <option value="draft_pr">Draft pull request</option>
                <option value="branch">Branch only</option>
                <option value="auto">Auto</option>
                <option value="none">Do not publish</option>
              </select>
            </label>
          </div>
          <div class="grid">
            <label>
              Task mode
              <select name="taskMode">
                <option value="patch">Patch</option>
                <option value="inspect">Inspect</option>
              </select>
            </label>
            <label>
              Timeout seconds
              <input name="timeoutSeconds" type="number" min="60" max="10800" placeholder="Controller default">
            </label>
          </div>
          <label>
            Task details
            <textarea name="taskPrompt" required minlength="10" placeholder="Describe the task for the ephemeral agent."></textarea>
          </label>
          <div class="checks">
            <label class="check"><input name="scouting" type="checkbox">Enable scouting</label>
            <label class="check"><input name="startupCheck" type="checkbox">Startup check only</label>
          </div>
          <div class="actions">
            <button class="secondary" id="validate" type="button">Validate task</button>
            <button class="run" id="submit" type="submit">Start run</button>
          </div>
        </form>
      </div>
      <section class="stack">
        <div>
          <h2>Controller checks</h2>
          <p>Health and readiness are public probes. Controller preflight uses the bearer token.</p>
        </div>
        <div class="probes">
          <button class="secondary" data-probe="/health" type="button">Health</button>
          <button class="secondary" data-probe="/ready" type="button">Readiness</button>
          <button class="secondary" data-probe="/api/preflight" data-auth="true" type="button">Preflight</button>
        </div>
        <div class="run-status">
          <label>
            Run ID
            <input id="run-id" placeholder="Filled after a run is submitted">
          </label>
          <button class="secondary" id="status" type="button">Check status</button>
        </div>
        <div id="state" role="status" aria-live="polite"></div>
        <pre id="output" aria-live="polite">Responses appear here.</pre>
      </section>
    </main>
    <script>
      const form = document.querySelector('#run-form');
      const output = document.querySelector('#output');
      const state = document.querySelector('#state');
      const tokenInput = document.querySelector('#token');
      const runIdInput = document.querySelector('#run-id');
      tokenInput.value = sessionStorage.getItem('kasekiApiToken') || '';

      function setState(message, kind) {
        state.textContent = message;
        state.className = kind || '';
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
        output.textContent = JSON.stringify({
          method: options && options.method || 'GET',
          path,
          status: response.status,
          response: payload,
        }, null, 2);
        setState(response.ok ? 'Request completed.' : 'Request failed.', response.ok ? 'ok' : 'bad');
        return { payload, response };
      }

      async function run(button, path, options) {
        button.disabled = true;
        setState('Contacting the controller...');
        try {
          await apiRequest(path, options);
        } catch (error) {
          output.textContent = error instanceof Error ? error.message : String(error);
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
          output.textContent = 'Submit a run or enter a run ID first.';
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
        setState('Contacting the controller...');
        apiRequest('/api/runs', { method: 'POST', auth: true, body: requestBody() })
          .then(({ payload, response }) => {
            if (response.ok && payload && typeof payload.id === 'string') runIdInput.value = payload.id;
          })
          .catch((error) => {
            output.textContent = error instanceof Error ? error.message : String(error);
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
    res.type('html').send(controllerPage);
  });
  return router;
}
