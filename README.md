# Kaseki Agent

Kaseki is a proof-of-concept ephemeral coding-agent runner. Each run is a numbered, disposable container instance such as `kaseki-1` or `kaseki-2`. This template uses the Pi coding-agent CLI with OpenRouter.

Host layout:

- `/agents/kaseki-template`: Dockerfile and runner scripts.
- `/agents/kaseki-runs/kaseki-N`: per-run workspace.
- `/agents/kaseki-results/kaseki-N`: logs, metadata, exit code, git status, git diff, and resource timing.
- `/agents/kaseki-cache`: reserved for optional future cache reuse.

Preferred registry image:

```sh
docker pull docker.io/cyanautomation/kaseki-agent:0.1.0
```

Local fallback build:

```sh
cd /agents/kaseki-template
docker build -t kaseki-template:latest .
```

Controlled base-image refresh (monthly security review):

```sh
# 1) review current upstream digest for the pinned tag
docker buildx imagetools inspect docker.io/library/node:22.22.2-bookworm-slim

# 2) update Dockerfile FROM digest via PR, run validation, then rebuild
docker build -t kaseki-template:latest .
```

If scripts were copied from a fresh clone without executable bits, run:

```sh
chmod +x run-kaseki.sh cleanup-kaseki.sh kaseki-agent.sh pi-event-filter.js
```

Verify Pi is installed in the image:

```sh
docker run --rm --entrypoint pi docker.io/cyanautomation/kaseki-agent:0.1.0 --version
```

Run the default repo with a runtime-only OpenRouter key:

```sh
OPENROUTER_API_KEY=sk-or-... /agents/kaseki-template/run-kaseki.sh
```

Run an explicit instance:

```sh
OPENROUTER_API_KEY=sk-or-... /agents/kaseki-template/run-kaseki.sh kaseki-4
```

Useful environment variables:

- `KASEKI_PROVIDER` defaults to `openrouter`.
- `KASEKI_IMAGE` defaults to `docker.io/cyanautomation/kaseki-agent:0.1.0`.
- `KASEKI_MODEL` defaults to `openrouter/free`.
- `KASEKI_AGENT_TIMEOUT_SECONDS` defaults to `1200`.
- `KASEKI_VALIDATION_COMMANDS` defaults to `npm run check;npm run test;npm run build`.
- `KASEKI_DEBUG_RAW_EVENTS=1` stores raw Pi JSONL events as `pi-events.raw.jsonl`.
- `KASEKI_KEEP_WORKSPACE=0` removes the workspace after successful runs.
- `KASEKI_CHANGED_FILES_ALLOWLIST` defaults to `src/lib/parser.ts tests/parser.validation.ts`.
- `KASEKI_MAX_DIFF_BYTES` defaults to `200000`.
- `TASK_PROMPT` defaults to a bounded `crudmapper` code-fix task.

Cleanup old workspaces while keeping results:

```sh
KASEKI_CLEANUP_DAYS=1 /agents/kaseki-template/cleanup-kaseki.sh
```

Results are written to `/agents/kaseki-results/kaseki-N`, including filtered `pi-events.jsonl`, `pi-summary.json`, `result-summary.md`, logs, metadata, validation output, git status, and git diff. The OpenRouter API key is mounted as a one-run secret file and is available only to the Pi invocation.
