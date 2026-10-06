# Getting Started with Kaseki Agent

Kaseki runs coding tasks in short-lived Docker workers and provides an API and
CLI for submitting and monitoring tasks. For a Raspberry Pi deployment, the
Compose path is the supported low-friction setup and does not need Node.js on
the host.

## Raspberry Pi

On a clean Debian 12/13 or 64-bit Raspberry Pi OS device, follow
[Raspberry Pi Quick Start](QUICK_START.md). It installs Docker when needed,
downloads a checksum-verified Kaseki release bundle, asks for the gateway
settings, and waits for `/ready` before reporting success.

From an existing checkout, run:

```bash
bash scripts/setup-pi.sh
```

The required provider for coding inference is an OpenAI-compatible gateway
URL and its key. The gateway key stays in `~/secrets/llm_gateway_api_key`;
Kaseki generates a separate API bearer key. The default API binding is
localhost. OpenRouter is optional and used only for evaluation stages.

## Use the npm CLI

Install the CLI on a workstation or controller with Node.js 24 or later:

```bash
npm install -g @cyanautomation/kaseki-agent
kaseki-agent --help
kaseki-agent doctor
```

Task commands such as `run`, `list`, `status`, and `report` use a Kaseki API
service. Point the CLI at the Pi API over an SSH tunnel or a secured LAN
connection. See [NPM_SETUP.md](NPM_SETUP.md) for CLI configuration and
[API.md](API.md) for API endpoints.

## First task

After setup, connect to the API and submit a task from the CLI:

```bash
export KASEKI_API_URL=http://127.0.0.1:8080/api/v1
export KASEKI_API_KEY="$(head -n 1 ~/secrets/kaseki_api_keys)"
kaseki-agent run https://github.com/CyanAutomation/crudmapper main \
  "Add input validation to all POST endpoints"
kaseki-agent list
```

If the CLI is on another machine, use the tunnel described in
[QUICK_START.md](QUICK_START.md), or configure the API to bind to a specific
LAN interface and allow access only to trusted clients.

## Further reading

- [Docker Setup](DOCKER_SETUP.md) — Compose details, credentials, networking,
  diagnostics, and updates.
- [Deployment Guide](DEPLOYMENT.md) — production deployment options.
- [Environment Variables](ENV_VARS.md) — full configuration reference.
- [NPM Setup](NPM_SETUP.md) — install and configure the CLI.
- [Troubleshooting](TROUBLESHOOTING.md) — diagnosing common failures.
