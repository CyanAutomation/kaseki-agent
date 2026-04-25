# Kaseki Agent

Kaseki is a proof-of-concept ephemeral coding-agent runner. Each run is a numbered, disposable container instance such as `kaseki-1` or `kaseki-2`. This template uses the Pi coding-agent CLI with OpenRouter.

Host layout:

- `/agents/kaseki-template`: Dockerfile and runner scripts.
- `/agents/kaseki-runs/kaseki-N`: per-run workspace.
- `/agents/kaseki-results/kaseki-N`: logs, metadata, exit code, git status, git diff, and resource timing.
- `/agents/kaseki-cache`: optional host-level cache location for dependency seeds.

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

Run the default repo with a runtime-only OpenRouter key via environment variable:

```sh
OPENROUTER_API_KEY=sk-or-... /agents/kaseki-template/run-kaseki.sh
```

The host wrapper writes this value to a per-run secret file and mounts it at
`/run/secrets/openrouter_api_key`; it does not pass the key through `docker run`
environment variables.

Run the default repo using a host secret file (mounted for compatibility):

```sh
OPENROUTER_API_KEY_FILE=/run/secrets/openrouter_api_key /agents/kaseki-template/run-kaseki.sh
```

Recommended persistent host secret path on a Pi:

```sh
mkdir -p ~/secrets
chmod 0700 ~/secrets
read -rsp "OpenRouter API key: " OPENROUTER_API_KEY
printf '\n'
printf '%s' "$OPENROUTER_API_KEY" > ~/secrets/openrouter_api_key
unset OPENROUTER_API_KEY
chmod 0600 ~/secrets/openrouter_api_key
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key /agents/kaseki-template/run-kaseki.sh --doctor
```

Use that same `OPENROUTER_API_KEY_FILE` value when running Kaseki. The wrapper
mounts the file into the container at `/run/secrets/openrouter_api_key`.

Run an explicit instance:

```sh
OPENROUTER_API_KEY=sk-or-... /agents/kaseki-template/run-kaseki.sh kaseki-4
```

## Running against a custom repo

Use `REPO_URL` to point Kaseki at a different Git repository:

```sh
OPENROUTER_API_KEY=sk-or-... REPO_URL=https://github.com/<org>/<repo> /agents/kaseki-template/run-kaseki.sh
```

```sh
OPENROUTER_API_KEY_FILE=/run/secrets/openrouter_api_key REPO_URL=https://github.com/<org>/<repo> /agents/kaseki-template/run-kaseki.sh
```

For non-default branches or tags, also set `GIT_REF`:

```sh
OPENROUTER_API_KEY=sk-or-... REPO_URL=https://github.com/<org>/<repo> GIT_REF=feature/my-branch /agents/kaseki-template/run-kaseki.sh
```

Useful environment variables:

- `KASEKI_ROOT` defaults to `/agents`.
- `KASEKI_PROVIDER` defaults to `openrouter`.
- `KASEKI_IMAGE` defaults to `docker.io/cyanautomation/kaseki-agent:0.1.0`.
- `KASEKI_CONTAINER_USER` defaults to the current host UID/GID (`$(id -u):$(id -g)`).
- `KASEKI_MODEL` defaults to `openrouter/free`.
- `KASEKI_AGENT_TIMEOUT_SECONDS` defaults to `1200`.
- `KASEKI_VALIDATION_COMMANDS` defaults to `npm run check;npm run test;npm run build`.
- `KASEKI_DEBUG_RAW_EVENTS=1` stores raw Pi JSONL events as `pi-events.raw.jsonl`.
- `KASEKI_KEEP_WORKSPACE=0` removes the workspace after successful runs.
- `KASEKI_CHANGED_FILES_ALLOWLIST` defaults to `src/lib/parser.ts tests/parser.validation.ts`.
- `KASEKI_MAX_DIFF_BYTES` defaults to `200000`.
- `TASK_PROMPT` defaults to a bounded `crudmapper` code-fix task.
- `KASEKI_DEPENDENCY_CACHE_DIR` defaults to `/workspace/.kaseki-cache` (workspace cache for target repo dependencies).
- `KASEKI_IMAGE_DEPENDENCY_CACHE_DIR` defaults to `/opt/kaseki/workspace-cache` (image-provided dependency cache seeds).

## Host readiness check

Run the doctor command before first use or after host changes:

```sh
/agents/kaseki-template/run-kaseki.sh --doctor
```

It checks Docker availability, writable run/result directories, image presence,
and OpenRouter key availability.

## Dependency install behavior (skip vs refresh)

`kaseki-agent.sh` prepares dependencies in this order after cloning the target repo:

1. If no `package.json` is present, dependency installation is skipped.
2. If `node_modules` already exists in the repo and its stored lock hash matches the current lock source (`package-lock.json`, `npm-shrinkwrap.json`, or fallback `package.json`), install is skipped.
3. If `node_modules` is missing, Kaseki tries a workspace cache hit at:
   - `$KASEKI_DEPENDENCY_CACHE_DIR/<repo-and-ref-hash>/<lock-hash>/node_modules`
4. If workspace cache misses, Kaseki tries an image seed cache hit at:
   - `$KASEKI_IMAGE_DEPENDENCY_CACHE_DIR/<repo-and-ref-hash>/<lock-hash>/node_modules`
5. If both caches miss, Kaseki refreshes dependencies with:
   - `npm ci --prefer-offline` (fallback: `npm install`)
6. After a successful cache hit or install, `node_modules` is written back to workspace cache for reuse.

`run-kaseki.sh` keeps the same runtime hardening (`--read-only`, `--tmpfs`, dropped capabilities, and non-root execution via `-u 1000:1000`).

Cleanup old workspaces while keeping results:

```sh
KASEKI_CLEANUP_DAYS=1 /agents/kaseki-template/cleanup-kaseki.sh
```

Results are written to `/agents/kaseki-results/kaseki-N`, including filtered `pi-events.jsonl`, `pi-summary.json`, `result-summary.md`, logs, metadata, validation output, git status, and git diff. `kaseki-agent.sh` resolves the OpenRouter key in this order before Pi execution: non-empty `OPENROUTER_API_KEY` environment value, then `/run/secrets/openrouter_api_key`, else it fails fast with a missing-key error before cloning or validation. Runtime logs report only the source method (`env` or `secret file`), never the key value.

## Exit codes

Kaseki uses specific non-zero exit codes for validation/policy failures:

- `2`: missing required runtime configuration (for example `OPENROUTER_API_KEY`) or invalid instance format in the wrapper script.
- `3`: empty git diff (the agent produced no changes).
- `4`: diff exceeds `KASEKI_MAX_DIFF_BYTES`.
- `5`: a changed file is outside `KASEKI_CHANGED_FILES_ALLOWLIST`.
- `6`: secret scan detected credential-like content.

Other non-zero exit codes may be propagated from failed steps (for example clone, dependency install, agent run, or validation commands). Check `/results/metadata.json` for `failed_command` and detailed per-stage exit fields.


Container healthcheck behavior:

- The image defines `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD test -f /results/stdout.log && test -f /results/stderr.log`.
- `/results` always exists because it is created in the image (`mkdir -p /results`) and also created again at runtime by `kaseki-agent.sh`.
- The container is reported **healthy** after the runner initializes its result logs.
- Run completion is still tracked by `/results/exit_code`.
