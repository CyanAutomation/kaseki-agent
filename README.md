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

## Running against a custom repo

Use `REPO_URL` to point Kaseki at a different Git repository:

```sh
OPENROUTER_API_KEY=sk-or-... REPO_URL=https://github.com/<org>/<repo> /agents/kaseki-template/run-kaseki.sh
```

For non-default branches or tags, also set `GIT_REF`:

```sh
OPENROUTER_API_KEY=sk-or-... REPO_URL=https://github.com/<org>/<repo> GIT_REF=feature/my-branch /agents/kaseki-template/run-kaseki.sh
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

## Exit codes

Kaseki uses specific non-zero exit codes for validation/policy failures:

- `2`: missing required runtime configuration (for example `OPENROUTER_API_KEY`) or invalid instance format in the wrapper script.
- `3`: empty git diff (the agent produced no changes).
- `4`: diff exceeds `KASEKI_MAX_DIFF_BYTES`.
- `5`: a changed file is outside `KASEKI_CHANGED_FILES_ALLOWLIST`.
- `6`: secret scan detected credential-like content.

Other non-zero exit codes may be propagated from failed steps (for example clone, dependency install, agent run, or validation commands). Check `/results/metadata.json` for `failed_command` and detailed per-stage exit fields.


Container healthcheck behavior:

- The image defines `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD test -f /results/exit_code && exit 0 || exit 1`.
- `/results` always exists because it is created in the image (`mkdir -p /results`) and also created again at runtime by `kaseki-agent.sh`.
- The container is reported **unhealthy** while a run is still in progress (before `/results/exit_code` is written).
- The container flips to **healthy** only after the run finishes and writes `/results/exit_code`.
