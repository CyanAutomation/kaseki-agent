import { Router } from 'express';

const controllerPage = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Kaseki Task Console</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap">
    <style>
      :root {
        color-scheme: dark;

        /* Surfaces — tonal layering, no drop shadows */
        --bg:              #10141a;
        --surface-low:     #181c22;
        --surface:         #1c2026;
        --surface-high:    #262a31;
        --surface-highest: #31353c;

        /* Text */
        --ink:   #dfe2eb;
        --muted: #bac9cc;

        /* Borders */
        --line:        #3b494c;
        --line-strong: #849396;

        /* Cyan — primary action */
        --focus:        #00daf3;
        --focus-bright: #00e5ff;
        --focus-text:   #c3f5ff;

        /* Status */
        --ok:      #2ff801;
        --ok-text: #d7ffc5;
        --bad:     #ffb4ab;
        --bad-bg:  #93000a;

        /* Spacing */
        --space-1: 8px;
        --space-2: 12px;
        --space-3: 16px;
        --space-4: 24px;
        --control-gap: var(--space-2);
        --control-min-height: 42px;
        --control-pad: var(--space-2) var(--space-3);

        /* Fonts */
        --font-ui:   'Hanken Grotesk', system-ui, sans-serif;
        --font-mono: 'JetBrains Mono', 'Courier New', monospace;
      }
      * { box-sizing: border-box; letter-spacing: 0; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font: 16px/1.5 var(--font-ui);
      }
      .header-bar {
        background: var(--surface-low);
        border-bottom: 1px solid var(--line);
        padding: var(--space-3) var(--space-3);
        display: flex;
        align-items: center;
        gap: var(--space-3);
        justify-content: space-between;
      }
      .header-bar h1 {
        margin: 0;
        font-size: clamp(18px, 3vw, 24px);
        font-family: var(--font-ui);
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.3;
        color: var(--focus-text);
      }
      .header-bar-title {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .header-token-input {
        min-width: 200px;
        max-width: 300px;
        width: auto;
        background: var(--surface-highest);
        border: none;
        border-bottom: 1px solid var(--line-strong);
        border-radius: 4px 4px 0 0;
        color: var(--ink);
        font-family: var(--font-ui);
        font-size: 14px;
        padding: 10px 11px;
        min-height: var(--control-min-height);
      }
      .header-token-input:focus {
        outline: none;
        border-bottom: 2px solid var(--focus);
      }
      .header-token-input::placeholder { color: var(--muted); }
      @media (max-width: 767px) {
        .header-token-input {
          min-width: 160px;
          max-width: 100%;
        }
      }
      .status-indicator {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 8px;
        border-radius: 9999px;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        background: color-mix(in srgb, var(--muted) 15%, transparent);
        color: var(--muted);
        flex-shrink: 0;
      }
      .status-indicator::before {
        content: '';
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
        flex-shrink: 0;
      }
      .status-indicator::after { content: 'Idle'; }
      .status-indicator.running {
        background: color-mix(in srgb, var(--focus) 15%, transparent);
        color: var(--focus-bright);
      }
      .status-indicator.running::after { content: 'Running'; }
      .status-indicator.running::before { animation: pulse 1s ease-in-out infinite; }
      .status-indicator.completed {
        background: color-mix(in srgb, var(--ok) 15%, transparent);
        color: var(--ok);
      }
      .status-indicator.completed::after { content: 'Done'; }
      .status-indicator.failed {
        background: color-mix(in srgb, var(--bad) 20%, transparent);
        color: var(--bad);
      }
      .status-indicator.failed::after { content: 'Failed'; }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
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
      h2 {
        font-family: var(--font-ui);
        font-size: clamp(17px, 2.2vw, 20px);
        font-weight: 600;
        line-height: 1.4;
        color: var(--ink);
      }
      p { color: var(--muted); font-size: 14px; line-height: 1.5; margin: var(--space-1) 0 0; }
      .panel {
        background: var(--surface-low);
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: var(--space-4);
      }
      header, form, .stack, fieldset { display: grid; gap: var(--space-3); }
      .stack { gap: var(--space-4); }
      section.panel { display: grid; gap: var(--space-3); }
      fieldset {
        border: 1px solid var(--line);
        border-radius: 4px;
        margin: 0;
        padding: var(--space-3);
      }
      legend {
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--muted);
        padding: 0 var(--space-1);
      }
      .form-fields { display: grid; gap: var(--space-3); }
      .form-field { display: grid; gap: var(--space-1); }
      .form-field > label {
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--muted);
        line-height: 1.35;
      }
      .field-helper { color: var(--muted); font-family: var(--font-ui); font-size: 13px; line-height: 1.5; }
      .field-error { color: var(--bad); font-family: var(--font-ui); font-size: 13px; line-height: 1.4; min-height: 1em; }
      input, textarea, select, button {
        box-sizing: border-box;
        color: inherit;
        font: inherit;
      }
      input, textarea, select {
        background: var(--surface-highest);
        border: none;
        border-bottom: 1px solid var(--line-strong);
        border-radius: 4px 4px 0 0;
        color: var(--ink);
        font-family: var(--font-ui);
        font-size: 14px;
        min-height: var(--control-min-height);
        padding: 10px 11px;
        width: 100%;
      }
      input::placeholder, textarea::placeholder { color: var(--muted); }
      textarea { min-height: 140px; resize: vertical; }
      input:focus, textarea:focus, select:focus {
        outline: none;
        border-bottom: 2px solid var(--focus);
      }
      button:focus {
        outline: 2px solid var(--focus);
        outline-offset: 2px;
      }
      .grid, .checks, .action-row, .run-status, .summary-grid, .link-grid { display: grid; gap: var(--control-gap); }
      .grid, .checks, .action-row, .run-status, .summary-grid, .link-grid { grid-template-columns: minmax(0, 1fr); }
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
      .run-status { grid-template-columns: minmax(0, 1fr); }
      .summary-grid {
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      }
      .summary-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 4px;
        display: grid;
        gap: 4px;
        min-height: 76px;
        padding: var(--space-2);
      }
      .summary-label {
        color: var(--muted);
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .summary-value {
        color: var(--ink);
        font-family: var(--font-mono);
        font-size: 16px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .summary-value.ok { color: var(--ok); }
      .summary-value.bad { color: var(--bad); }
      .summary-details {
        color: var(--muted);
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 400;
        line-height: 1.4;
        margin-top: 4px;
        word-break: break-word;
        overflow-wrap: break-word;
      }
      .run-links {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 4px;
        display: grid;
        gap: var(--space-2);
        padding: var(--space-3);
      }
      .run-links[hidden] { display: none; }
      .link-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .link-grid a {
        align-items: center;
        background: transparent;
        border: 1px solid var(--line);
        border-radius: 4px;
        color: var(--ink);
        display: inline-flex;
        font-family: var(--font-ui);
        font-weight: 600;
        justify-content: center;
        min-height: var(--control-min-height);
        padding: var(--control-pad);
        text-decoration: none;
        transition: border-color 0.15s, color 0.15s;
      }
      .link-grid a:hover {
        border-color: var(--focus);
        color: var(--focus-text);
      }
      .panel-section-label {
        display: block;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--muted);
      }
      button {
        background: transparent;
        border: 1px solid var(--line);
        border-radius: 4px;
        color: var(--ink);
        cursor: pointer;
        font-family: var(--font-ui);
        font-size: 14px;
        font-weight: 600;
        min-height: var(--control-min-height);
        padding: var(--control-pad);
        transition: border-color 0.15s, color 0.15s, background 0.15s;
      }
      button:hover:not(:disabled) {
        border-color: var(--focus);
        color: var(--focus-text);
      }
      button.secondary {
        background: transparent;
        color: var(--ink);
        border-color: var(--line);
      }
      button.secondary:hover:not(:disabled) {
        border-color: var(--focus);
        color: var(--focus-text);
      }
      button.run {
        background: var(--focus-bright);
        border-color: var(--focus-bright);
        color: #00363d;
        font-weight: 700;
      }
      button.run:hover:not(:disabled) {
        background: var(--focus-text);
        border-color: var(--focus-text);
        color: #001f24;
      }
      button:disabled { cursor: wait; opacity: .5; }
      .toolbar-button { }
      .toolbar-button-no-wrap { white-space: nowrap; }
      .response-panel {
        background: var(--bg);
        border: 1px solid var(--line);
        border-radius: 4px;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        min-height: 300px;
        overflow: hidden;
      }
      .response-meta {
        border-bottom: 1px solid var(--line);
        color: var(--muted);
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin: 0;
        padding: var(--space-2) var(--space-3);
      }
      .response-summary {
        background: var(--surface-low);
        border-bottom: 1px solid var(--line);
        display: grid;
        gap: var(--space-2);
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        padding: var(--space-2) var(--space-3);
      }
      .response-summary[hidden] { display: none; }
      .response-summary-item {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .response-summary-label {
        color: var(--muted);
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .response-summary-value {
        color: var(--ink);
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .response-log {
        align-self: start;
        color: var(--ink);
        font-family: var(--font-mono);
        font-size: 13px;
        line-height: 1.6;
        margin: 0;
        min-height: 0;
        overflow: auto;
        padding: var(--space-3);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .response-log.empty { color: var(--muted); }
      #state {
        color: var(--muted);
        font-family: var(--font-mono);
        font-size: 12px;
        min-height: 22px;
      }
      #state.ok { color: var(--ok); }
      #state.bad { color: var(--bad); }
      @media (min-width: 768px) {
        .header-bar {
          padding: clamp(var(--space-3), 2vw, 24px) clamp(var(--space-3), 4vw, 48px);
        }
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
      .tabs-nav {
        display: flex;
        gap: 0;
        border-bottom: 1px solid var(--line);
        margin-bottom: var(--space-3);
      }
      .tabs-nav button {
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--muted);
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: var(--space-2) var(--space-3);
        margin-bottom: -1px;
        min-height: auto;
        transition: color 0.15s, border-color 0.15s;
      }
      .tabs-nav button:hover:not(:disabled) {
        color: var(--ink);
        border-color: transparent;
      }
      .tabs-nav button.active {
        color: var(--focus-text);
        border-bottom-color: var(--focus);
      }
      .tabs-nav button:focus {
        outline: 2px solid var(--focus);
        outline-offset: 2px;
      }
      .tab-content {
        display: grid;
        gap: var(--space-3);
      }
      .tab-content.hidden { display: none; }
      .health-checks-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: var(--space-3);
      }
      .health-check-button {
        background: var(--surface);
        color: var(--ink);
        padding: var(--space-3);
        border-radius: 4px;
        border: 1px solid var(--line);
        cursor: pointer;
        font-family: var(--font-ui);
        font-size: 14px;
        font-weight: 600;
        min-height: 80px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-1);
        transition: border-color 0.15s, color 0.15s;
      }
      .health-check-button:hover:not(:disabled) {
        border-color: var(--focus);
        color: var(--focus-text);
      }
      .health-check-button:disabled { opacity: 0.5; cursor: wait; }
      .health-check-button:focus {
        outline: 2px solid var(--focus);
        outline-offset: 1px;
      }
      .hc-label {
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .health-check-status {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        font-family: var(--font-mono);
        font-size: 13px;
      }
      .health-check-status.spinner::after {
        content: '⟳';
        display: inline-block;
        animation: spin 1s linear infinite;
        color: var(--focus);
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .health-check-status.ok::before { content: '✓'; color: var(--ok); }
      .health-check-status.bad::before { content: '✕'; color: var(--bad); }
      @media (max-width: 767px) {
        .action-row.run-actions > .run { order: 1; }
        .response-panel { min-height: 40vh; }
        .health-checks-grid { grid-template-columns: repeat(2, 1fr); }
        main {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    </style>
  </head>
  <body>
    <header class="header-bar">
      <div class="header-bar-title">
        <h1>Kaseki Task Console</h1>
        <span class="status-indicator" id="header-status" data-status="idle"></span>
      </div>
      <input id="header-api-token" class="header-token-input" type="password" autocomplete="off" placeholder="API bearer token (required)" aria-label="API bearer token">
    </header>
    <main>
      <section class="panel stack" aria-labelledby="tabs-heading">
        <div class="tabs-nav" role="tablist" aria-label="Console tabs">
          <button class="tab-button active" data-tab="health" role="tab" aria-selected="true" aria-controls="health-tab">Health</button>
          <button class="tab-button" data-tab="submit" role="tab" aria-selected="false" aria-controls="submit-tab">Submit Task</button>
        </div>
        <div id="health-tab" class="tab-content" role="tabpanel" aria-labelledby="health-heading">
          <div>
            <h2 id="health-heading">Controller Health Checks</h2>
            <p>Run diagnostics to verify the Kaseki API controller is operating correctly.</p>
          </div>
          <div class="health-checks-grid">
            <button class="health-check-button" data-probe="/health" type="button"><span class="hc-label">Health</span><span class="health-check-status" data-status="health"></span></button>
            <button class="health-check-button" data-probe="/ready" type="button"><span class="hc-label">Readiness</span><span class="health-check-status" data-status="readiness"></span></button>
            <button class="health-check-button" data-probe="/api/preflight" data-auth="true" type="button"><span class="hc-label">Preflight</span><span class="health-check-status" data-status="preflight"></span></button>
            <button class="health-check-button" id="status-check" type="button"><span class="hc-label">Check Status</span><span class="health-check-status" data-status="status"></span></button>
          </div>
          <div class="summary-grid" id="health-summary" aria-live="polite">
            <div class="summary-card">
              <span class="summary-label">Controller</span>
              <span class="summary-value" data-summary="controller">Not checked</span>
            </div>
            <div class="summary-card">
              <span class="summary-label">Queue</span>
              <span class="summary-value" data-summary="queue">Not checked</span>
            </div>
            <div class="summary-card">
              <span class="summary-label">Preflight</span>
              <span class="summary-value" data-summary="preflight">Not checked</span>
            </div>
            <div class="summary-card">
              <span class="summary-label">Run</span>
              <span class="summary-value" data-summary="run">No run selected</span>
              <div class="summary-details" id="run-details"></div>
            </div>
          </div>
          <div class="form-field">
            <label for="run-id">Run ID (for Check Status)</label>
            <input id="run-id" placeholder="Filled after a run is submitted">
          </div>
          <div class="run-links" id="runs-list-panel">
            <strong class="panel-section-label">Recent runs</strong>
            <div class="action-row controller-actions">
              <button class="secondary toolbar-button" id="refresh-runs" type="button">Refresh runs</button>
            </div>
            <div class="link-grid" id="runs-list"></div>
          </div>
          <div id="state" role="status" aria-live="polite"></div>
        </div>
        <div id="submit-tab" class="tab-content hidden" role="tabpanel" aria-labelledby="submit-heading" hidden aria-hidden="true">
          <div>
            <h2 id="submit-heading">Submit Repository Task</h2>
            <p>Configure and submit a task for the ephemeral agent to execute.</p>
            <!-- Simplified UI: Git ref, timeout, and publish mode use defaults (main, 3h, auto).
                 For advanced options, use the CLI or API directly with explicit parameters. -->
          </div>
        <form id="run-form">
          <fieldset class="form-fields">
            <legend>Required information</legend>
            <div class="form-field">

              <label for="repo-url">Repository URL</label>
              <input id="repo-url" name="repoUrl" type="url" required placeholder="https://github.com/org/repo">
              <p class="field-error" data-error-for="repoUrl" aria-live="polite"></p>
            </div>
            <div class="form-field">
              <label for="task-prompt">Task details</label>
              <textarea id="task-prompt" name="taskPrompt" required minlength="10" placeholder="Describe the task for the ephemeral agent."></textarea>
              <p class="field-error" data-error-for="taskPrompt" aria-live="polite"></p>
            </div>
          </fieldset>
          <fieldset>
            <legend>Options</legend>
            <div class="form-field">
              <label for="task-mode">Task mode</label>
              <select id="task-mode" name="taskMode">
                <option value="patch" selected>Patch</option>
                <option value="inspect">Inspect</option>
              </select>
              <p class="field-helper">Patch: require code changes. Inspect: read-only analysis (skips pre-validation for speed).</p>
            </div>
            <div class="form-field">
              <div class="check">
                <input name="scouting" type="checkbox" checked>
                <div class="check-copy">
                  <label class="check-label">Enable scouting mode</label>
                  <div class="check-helper">Allow the agent to explore beyond the specified scope (experimental).</div>
                </div>
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend>Run actions</legend>
            <div class="action-row run-actions">
            <button class="secondary" id="validate" type="button">Validate task</button>
            <button class="run" id="submit" type="submit">Start run</button>
            <button class="secondary" id="cancel-run" type="button">Cancel run</button>
            </div>
          </fieldset>
        </form>
        </div>
      </section>
      <section class="panel stack" aria-labelledby="responses-heading">
        <div>
          <h2 id="responses-heading">Responses</h2>
        </div>
        <div class="run-links" id="run-links" hidden>
          <strong class="panel-section-label">Run follow-through</strong>
          <div class="link-grid">
            <button class="secondary toolbar-button-no-wrap" data-run-action="status" type="button">Status</button>
            <button class="secondary toolbar-button-no-wrap" data-run-action="events" type="button">Events</button>
            <button class="secondary toolbar-button-no-wrap" data-run-action="stdout" type="button">Stdout</button>
            <button class="secondary toolbar-button-no-wrap" data-run-action="artifacts" type="button">Artifacts</button>
          </div>
          <div class="recommended-artifacts" id="recommended-artifacts" hidden>
            <span class="summary-label">Recommended artifacts</span>
            <div class="link-grid" id="recommended-artifact-links"></div>
          </div>
        </div>
        <div class="response-panel">
          <p class="response-meta" id="output-meta" aria-live="polite">Status: idle</p>
          <div class="response-summary" id="response-summary" hidden aria-live="polite"></div>
          <pre class="response-log empty" id="output" aria-live="polite">No output yet. Run a health check or submit a task to see responses.</pre>
        </div>
      </section>
    </main>
    <script>
      const form = document.querySelector('#run-form');
      const output = document.querySelector('#output');
      const outputMeta = document.querySelector('#output-meta');
      const responseSummary = document.querySelector('#response-summary');
      const state = document.querySelector('#state');
      const headerTokenInput = document.querySelector('#header-api-token');
      const runIdInput = document.querySelector('#run-id');
      const runLinks = document.querySelector('#run-links');
      const recommendedArtifacts = document.querySelector('#recommended-artifacts');
      const recommendedArtifactLinks = document.querySelector('#recommended-artifact-links');
      const headerStatus = document.querySelector('#header-status');
      const runsList = document.querySelector('#runs-list');
      let pollTimer = null;
      let activeRunView = 'status';

      function getApiToken() {
        return headerTokenInput.value.trim();
      }

      // Restore token from session storage on page load
      headerTokenInput.value = sessionStorage.getItem('kasekiApiToken') || '';

      // Save token to session storage when it changes
      headerTokenInput.addEventListener('change', () => {
        const token = getApiToken();
        if (token) {
          sessionStorage.setItem('kasekiApiToken', token);
        } else {
          sessionStorage.removeItem('kasekiApiToken');
        }
      });

      function updateHeaderStatus(status) {
        if (!headerStatus) return;
        const statusMap = {
          'idle': 'idle',
          'running': 'running',
          'queued': 'running',
          'completed': 'completed',
          'failed': 'failed',
          'request ok': 'idle',
        };
        const statusClass = statusMap[status] || 'idle';
        headerStatus.className = 'status-indicator ' + statusClass;
        headerStatus.setAttribute('data-status', statusClass);
      }

      function sanitizeOutput(value) {
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value, null, 2);
        } catch {
          return String(value);
        }
      }

      function stripControlSequences(value) {
        return String(value || '')
          .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
          .trim();
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
        updateHeaderStatus(status);
      }

      function formatElapsedSeconds(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return '';
        const seconds = Math.max(0, Math.floor(value));
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes === 0) return String(remainingSeconds) + 's';
        return String(minutes) + 'm ' + String(remainingSeconds).padStart(2, '0') + 's';
      }

      function setResponseSummary(payload) {
        if (!responseSummary) return;
        responseSummary.replaceChildren();
        const items = [];
        if (payload && typeof payload === 'object') {
          if (typeof payload.status === 'string') {
            items.push(['Response status', stripControlSequences(payload.status)]);
          }
          if (typeof payload.taskProgressPercent === 'number') {
            items.push(['Task Progress', payload.taskProgressPercent + '%']);
          }
          const elapsed = formatElapsedSeconds(payload.elapsedSeconds);
          if (elapsed) {
            items.push(['Response elapsed time', elapsed]);
          }
          if (payload.progress && typeof payload.progress.stage === 'string') {
            items.push(['Response progress stage', stripControlSequences(payload.progress.stage)]);
          }
        }
        responseSummary.hidden = items.length === 0;
        items.forEach(([label, value]) => {
          const item = document.createElement('div');
          item.className = 'response-summary-item';
          const labelEl = document.createElement('span');
          labelEl.className = 'response-summary-label';
          labelEl.textContent = label;
          const valueEl = document.createElement('span');
          valueEl.className = 'response-summary-value';
          valueEl.textContent = value;
          item.append(labelEl, valueEl);
          responseSummary.appendChild(item);
        });
      }

      function responseStatusLabel(response, payload) {
        if (!response.ok) return 'failed';
        if (payload && typeof payload === 'object' && typeof payload.status === 'string') {
          return payload.status;
        }
        return 'request ok';
      }

      function setOutputBody(text) {
        output.textContent = text;
        output.classList.toggle('empty', !text);
      }

      function setSummary(key, value, kind) {
        const element = document.querySelector('[data-summary="' + key + '"]');
        if (!element) return;
        element.textContent = value;
        element.className = 'summary-value' + (kind ? ' ' + kind : '');
      }

      function setRunDetails(progress) {
        const detailsEl = document.getElementById('run-details');
        if (!detailsEl) return;
        if (!progress) {
          detailsEl.innerHTML = '';
          return;
        }
        const stage = progress.stage ? stripControlSequences(progress.stage) : '';
        const message = progress.message ? stripControlSequences(progress.message) : '';
        const percent = typeof progress.percentComplete === 'number' ? progress.percentComplete + '%' : '';
        const parts = [stage, message, percent].filter(Boolean);
        detailsEl.textContent = parts.join(' | ');
      }

      function runUrl(runId, suffix) {
        return '/api/runs/' + encodeURIComponent(runId) + suffix;
      }

      function showRunLinks(runId) {
        if (!runId) return;
        runLinks.hidden = false;
      }

      function artifactUrl(runId, fileName) {
        return '/api/results/' + encodeURIComponent(runId) + '/' + encodeURIComponent(fileName);
      }

      function showRecommendedArtifacts(runId, artifactsResponse) {
        if (!recommendedArtifacts || !recommendedArtifactLinks || !runId) return;
        const recommended = artifactsResponse && Array.isArray(artifactsResponse.recommended)
          ? artifactsResponse.recommended
          : [];
        recommendedArtifactLinks.replaceChildren();
        if (recommended.length === 0) {
          recommendedArtifacts.hidden = true;
          return;
        }
        recommended.forEach((fileName) => {
          const button = document.createElement('button');
          button.className = 'secondary toolbar-button-no-wrap';
          button.type = 'button';
          button.dataset.artifactFile = fileName;
          button.textContent = fileName;
          button.addEventListener('click', (event) => {
            run(event.currentTarget, artifactUrl(runId, fileName), { auth: true });
          });
          recommendedArtifactLinks.appendChild(button);
        });
        recommendedArtifacts.hidden = false;
      }

      async function loadRecommendedArtifacts(runId) {
        if (!runId) return;
        try {
          const result = await apiRequest(runUrl(runId, '/artifacts'), { auth: true, preserveOutput: true });
          if (result.response.ok) {
            showRecommendedArtifacts(runId, result.payload);
          }
        } catch {
          if (recommendedArtifacts) recommendedArtifacts.hidden = true;
        }
      }

      function formatRunButtonLabel(run) {
        const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
        if (!isDesktop) {
          // Mobile: Extract number from 'kaseki-77' and show condensed format
          const runNumber = run.id.split('-')[1] || run.id;
          return 'K-' + runNumber + ' ' + (run.status || '');
        }
        // Desktop: Full format with time, allow wrapping
        const created = run.createdAt ? new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        return [run.id, run.status, created].filter(Boolean).join(' - ');
      }

      function renderRunsList(payload) {
        if (!runsList || !payload || !Array.isArray(payload.runs)) return;
        runsList.replaceChildren();
        payload.runs.slice(0, 12).forEach((run) => {
          const button = document.createElement('button');
          button.className = 'secondary toolbar-button';
          button.type = 'button';
          button.textContent = formatRunButtonLabel(run);
          button.addEventListener('click', () => {
            runIdInput.value = run.id;
            showRunLinks(run.id);
            activeRunView = 'status';
            pollRun(run.id);
          });
          runsList.appendChild(button);
        });
      }

      async function loadRunsList(options) {
        try {
          const result = await apiRequest('/api/runs', { auth: true, preserveOutput: options && options.preserveOutput });
          if (result.response.ok) {
            renderRunsList(result.payload);
          }
        } catch (error) {
          if (runsList) {
            runsList.textContent = error instanceof Error && error.message.includes('API bearer token')
              ? 'Enter the API bearer token to load recent runs.'
              : 'Runs could not be loaded.';
          }
        }
      }

      function isTerminalStatus(status) {
        return status === 'completed' || status === 'failed';
      }

      function stopPolling() {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
      }

      function summarizeHealth(path, payload) {
        if (path === '/health') {
          setSummary('controller', payload.status || 'Healthy', 'ok');
          if (payload.queue) {
            setSummary('queue', String(payload.queue.running || 0) + ' running, ' + String(payload.queue.pending || 0) + ' pending', 'ok');
          }
        }
        if (path === '/ready') {
          setSummary('controller', payload.status || 'Ready', 'ok');
        }
        if (path === '/api/preflight') {
          const checks = Array.isArray(payload.checks) ? payload.checks : [];
          const failed = checks.filter((check) => !check.ok);
          setSummary('preflight', failed.length === 0 ? String(checks.length) + ' checks passed' : String(failed.length) + ' failed', failed.length === 0 ? 'ok' : 'bad');
        }
      }

      function summarizeRun(payload) {
        if (!payload || !payload.status) return;
        setSummary('run', payload.status, payload.status === 'failed' ? 'bad' : 'ok');
        setRunDetails(payload.progress);
      }

      function requestBody() {
        const data = new FormData(form);
        const body = {
          repoUrl: String(data.get('repoUrl') || '').trim(),
          taskPrompt: String(data.get('taskPrompt') || '').trim(),
          taskMode: String(data.get('taskMode') || 'patch'),
        };
        body.scouting = { enabled: data.get('scouting') === 'on' };
        return body;
      }

      async function apiRequest(path, options) {
        const token = getApiToken();
        const needsAuth = options && options.auth;
        if (needsAuth && !token) throw new Error('Enter the API bearer token in the header first.');
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
        const statusLabel = responseStatusLabel(response, payload);
        if (!(options && options.preserveOutput)) {
          setOutputMetadata(statusLabel, runId || undefined);
          setResponseSummary(payload);
          setOutputBody(JSON.stringify({
            method: options && options.method || 'GET',
            path,
            status: response.status,
            response: payload,
          }, null, 2));
          setState(response.ok ? (runId ? 'Run status updated.' : 'Request completed.') : 'Request failed.', response.ok ? 'ok' : 'bad');
        }
        if (response.ok && payload && typeof payload === 'object') {
          summarizeHealth(path, payload);
          summarizeRun(payload);
          if (runId) showRunLinks(runId);
          if (runId && payload.status && isTerminalStatus(payload.status)) {
            loadRecommendedArtifacts(runId);
          }
        }
        return { payload, response };
      }

      async function run(button, path, options) {
        button.disabled = true;
        setOutputMetadata('running', String(runIdInput.value || '').trim() || undefined);
        setState('Contacting the controller...');
        try {
          return await apiRequest(path, options);
        } catch (error) {
          setOutputMetadata('failed', String(runIdInput.value || '').trim() || undefined);
          setResponseSummary(null);
          setOutputBody(sanitizeOutput(error instanceof Error ? error.message : String(error)));
          setState('Request could not be sent.', 'bad');
          return { payload: null, response: { ok: false } };
        } finally {
          button.disabled = false;
        }
      }

      async function pollRun(runId) {
        stopPolling();
        if (!runId) return;
        let retryCount = 0;
        const maxRetries = 36;
        async function poll() {
          try {
            const result = await apiRequest(runUrl(runId, '/status'), { auth: true, preserveOutput: activeRunView !== 'status' });
            summarizeRun(result.payload);
            retryCount = 0;
            if (result.response.ok && result.payload && result.payload.status && !isTerminalStatus(result.payload.status)) {
              pollTimer = setTimeout(poll, 5000);
              loadRunsList({ preserveOutput: true });
            } else {
              loadRunsList({ preserveOutput: true });
            }
          } catch {
            retryCount++;
            if (retryCount < maxRetries) {
              pollTimer = setTimeout(poll, 10000);
            } else {
              setState('Polling stopped after repeated failures.', 'bad');
            }
          }
        }
        poll();
      }

      // Tab switching
      document.querySelectorAll('.tab-button').forEach((button) => {
        button.addEventListener('click', () => {
          const tabName = button.dataset.tab;
          document.querySelectorAll('.tab-button').forEach(b => {
            const active = b.dataset.tab === tabName;
            b.classList.toggle('active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
          });
          document.querySelectorAll('.tab-content').forEach(content => {
            const contentTabName = content.id.replace('-tab', '');
            const active = contentTabName === tabName;
            content.classList.toggle('hidden', !active);
            content.hidden = !active;
            content.setAttribute('aria-hidden', active ? 'false' : 'true');
          });
          sessionStorage.setItem('kasekiActiveTab', tabName);
        });
      });
      // Restore active tab on page load
      const savedTab = sessionStorage.getItem('kasekiActiveTab') || 'health';
      const savedTabButton = document.querySelector('[data-tab="' + savedTab + '"]');
      if (savedTabButton) savedTabButton.click();
      
      // Initialize header status
      updateHeaderStatus('idle');

      // Health check button handlers
      document.querySelectorAll('[data-probe]').forEach((button) => {
        button.addEventListener('click', () => {
          const statusEl = button.querySelector('.health-check-status');
          if (statusEl) {
            statusEl.className = 'health-check-status spinner';
          }
          run(button, button.dataset.probe, {
            auth: button.dataset.auth === 'true',
          }).then(({ response }) => {
            loadRunsList({ preserveOutput: true });
            if (statusEl) {
              statusEl.className = response.ok ? 'health-check-status ok' : 'health-check-status bad';
            }
          }).catch(() => {
            if (statusEl) {
              statusEl.className = 'health-check-status bad';
            }
          });
        });
      });

      document.querySelector('#validate').addEventListener('click', (event) => {
        if (!form.reportValidity()) return;
        run(event.currentTarget, '/api/validate', { method: 'POST', auth: true, body: requestBody() });
      });

      document.querySelector('#status-check').addEventListener('click', (event) => {
        const runId = runIdInput.value.trim();
        if (!runId) {
          setOutputMetadata('idle');
          setResponseSummary(null);
          setOutputBody('Submit a run or enter a run ID first.');
          setState('Run status needs a run ID.', 'bad');
          return;
        }
        showRunLinks(runId);
        run(event.currentTarget, runUrl(runId, '/status'), { auth: true });
      });

      document.querySelectorAll('[data-run-action]').forEach((button) => {
        button.addEventListener('click', (event) => {
          const runId = runIdInput.value.trim();
          if (!runId) {
            setOutputMetadata('idle');
            setResponseSummary(null);
            setOutputBody('Submit a run or enter a run ID first.');
            setState('Run action needs a run ID.', 'bad');
            return;
          }
          const action = event.currentTarget.dataset.runAction;
          activeRunView = action;
          const paths = {
            status: runUrl(runId, '/status'),
            events: runUrl(runId, '/events?tail=50'),
            stdout: runUrl(runId, '/logs/stdout?tail=lines&lines=200'),
            artifacts: runUrl(runId, '/artifacts'),
          };
          run(event.currentTarget, paths[action], { auth: true });
        });
      });

      document.querySelector('#refresh-runs').addEventListener('click', (event) => {
        run(event.currentTarget, '/api/runs', { auth: true }).then(({ payload, response }) => {
          if (response.ok) renderRunsList(payload);
        });
      });

      document.querySelector('#cancel-run').addEventListener('click', (event) => {
        const runId = runIdInput.value.trim();
        if (!runId) {
          setOutputMetadata('idle');
          setResponseSummary(null);
          setOutputBody('Submit a run or enter a run ID first.');
          setState('Cancel needs a run ID.', 'bad');
          return;
        }
        stopPolling();
        run(event.currentTarget, runUrl(runId, '/cancel'), { method: 'POST', auth: true });
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
              showRunLinks(payload.id);
              activeRunView = 'status';
              loadRunsList({ preserveOutput: true });
              pollRun(payload.id);
            }
          })
          .catch((error) => {
            setOutputMetadata('failed', String(runIdInput.value || '').trim() || undefined);
            setResponseSummary(null);
            setOutputBody(sanitizeOutput(error instanceof Error ? error.message : String(error)));
            setState('Request could not be sent.', 'bad');
          })
          .finally(() => {
            button.disabled = false;
          });
      });
      loadRunsList({ preserveOutput: true });
    </script>
  </body>
</html>
`;

export function createWebRouter(): Router {
  const router = Router();
  router.get(['/', '/ui'], (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'");
    res.set('Referrer-Policy', 'no-referrer');
    res.type('html').send(controllerPage);
  });
  return router;
}
