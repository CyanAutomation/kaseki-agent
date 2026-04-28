# Kaseki Agent

Kaseki is a proof-of-concept ephemeral coding-agent runner. Each run is a numbered, disposable container instance such as `kaseki-1` or `kaseki-2`. This template uses the Pi coding-agent CLI with OpenRouter.

Host layout:

- `/agents/kaseki-template`: Dockerfile and runner scripts.
- `/agents/kaseki-runs/kaseki-N`: per-run workspace.
- `/agents/kaseki-results/kaseki-N`: logs, metadata, exit code, git status, git diff, and resource timing.
- `/agents/kaseki-cache`: persistent host-level cache for dependency installs and npm cache.

Preferred registry image (Docker Hub):

```sh
docker pull docker.io/cyanautomation/kaseki-agent:latest
```

Alternative registry (GitHub Container Registry):

```sh
docker pull ghcr.io/cyanautomation/kaseki-agent:latest
```

Both registries are equivalent and receive identical multi-architecture builds
for `linux/amd64` and `linux/arm64`. Pin a stable version tag once a release
contains the current observability and failure-handling fixes.

Tag publication schedule:

- **Stable version tags** (e.g., `0.1.0`): Published once via version tag push; never overwritten
- **`latest` tag**: Updated on every version push **and** via weekly schedule every Sunday at 00:00 UTC

The default wrapper image is `latest` until the next stable version tag is cut.
Production deployments should pin that newer stable tag once it exists.

Local fallback build:

```sh
cd /agents/kaseki-template
docker build -t kaseki-template:latest .
KASEKI_IMAGE=kaseki-template:latest OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key ./run-kaseki.sh --doctor
```

For readable logs over SSH on a Pi, prefer plain progress output:

```sh
docker build --progress=plain -t kaseki-template:latest .
```

Deploy the current checkout to the host template directory without touching
run, result, cache, or secret directories:

```sh
cd /path/to/kaseki-agent
sudo ./deploy-pi-template.sh
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
chmod +x run-kaseki.sh kaseki cleanup-kaseki.sh kaseki-agent.sh pi-event-filter.js kaseki-report.js
```

Verify Pi is installed in the image (Docker Hub):

```sh
docker run --rm --entrypoint pi docker.io/cyanautomation/kaseki-agent:latest --version
```

Or from GitHub Container Registry:

```sh
docker run --rm --entrypoint pi ghcr.io/cyanautomation/kaseki-agent:latest --version
```

Monitor Kaseki runs on a Pi without installing Node on the host:

```sh
/agents/kaseki-template/kaseki list
/agents/kaseki-template/kaseki status kaseki-1
/agents/kaseki-template/kaseki analysis kaseki-1
```

The `kaseki` wrapper runs the Node-based CLI inside the configured Kaseki Docker
image and mounts `/agents/kaseki-results` read-only.

Run the default repo with a runtime-only OpenRouter key via environment variable:

```sh
OPENROUTER_API_KEY=sk-or-... /agents/kaseki-template/run-kaseki.sh
```

The host wrapper writes this value to a per-run secret file and mounts it at
`/run/secrets/openrouter_api_key`; it does not pass the key through `docker run`
environment variables.

Run the default repo using a host secret file (mounted for compatibility):

```sh
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key /agents/kaseki-template/run-kaseki.sh
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

### Method 1: CLI Arguments (Recommended)

Pass the repository URL and Git reference as positional arguments to `run-kaseki.sh`:

```sh
# Custom repo, auto git-ref and instance
OPENROUTER_API_KEY=sk-or-... /agents/kaseki-template/run-kaseki.sh https://github.com/<org>/<repo>
```

```sh
# Custom repo and branch/tag
OPENROUTER_API_KEY=sk-or-... /agents/kaseki-template/run-kaseki.sh https://github.com/<org>/<repo> feature/my-branch
```

```sh
# Custom repo, ref, and explicit instance name
OPENROUTER_API_KEY=sk-or-... /agents/kaseki-template/run-kaseki.sh https://github.com/<org>/<repo> feature/my-branch kaseki-42
```

```sh
# Using secret file with repo args
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key /agents/kaseki-template/run-kaseki.sh https://github.com/<org>/<repo> develop
```

The arguments are parsed intelligently:

- Arguments containing `/` or `.git` are recognized as repository URLs (GitHub, GitLab, Bitbucket, etc.)
- Short strings like `main`, `develop`, or `v1.0.0` are recognized as Git references
- Names matching the `kaseki-N` pattern are recognized as explicit instance names
- All unspecified arguments are auto-generated (instance name, git ref)

### Method 2: Environment Variables (Legacy)

Use `REPO_URL` and `GIT_REF` environment variables (still supported but superseded by CLI args):

```sh
OPENROUTER_API_KEY=sk-or-... REPO_URL=https://github.com/<org>/<repo> /agents/kaseki-template/run-kaseki.sh
```

```sh
OPENROUTER_API_KEY=sk-or-... REPO_URL=https://github.com/<org>/<repo> GIT_REF=feature/my-branch /agents/kaseki-template/run-kaseki.sh
```

**Note:** CLI arguments take precedence over environment variables. If you provide repo arguments on the command line, `REPO_URL` and `GIT_REF` environment variables are ignored.

## GitHub App Integration (Optional)

Kaseki can automatically push changes to a feature branch and create pull requests using a GitHub App. This requires providing GitHub App credentials (App ID, Client ID, and Private Key).

### Prerequisites

1. Create a GitHub App with the following permissions:
   - `contents: read & write` (for pushing code)
   - `pull_requests: read & write` (for creating PRs)
   - `workflows: read` (optional, for checking CI)

2. Generate a private key for the app and save it locally.

3. Install the app on the target repository.

### Setup

Store credentials in secure files:

```sh
mkdir -p ~/secrets
chmod 0700 ~/secrets

# Store app credentials
echo "YOUR_APP_ID" > ~/secrets/github_app_id
echo "YOUR_CLIENT_ID" > ~/secrets/github_app_client_id
cp ~/path/to/private-key.pem ~/secrets/github_app_private_key
chmod 0600 ~/secrets/github_app_*
```

### Usage

Run Kaseki with GitHub App credentials:

```sh
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
GITHUB_APP_ID_FILE=~/secrets/github_app_id \
GITHUB_APP_CLIENT_ID_FILE=~/secrets/github_app_client_id \
GITHUB_APP_PRIVATE_KEY_FILE=~/secrets/github_app_private_key \
/agents/kaseki-template/run-kaseki.sh https://github.com/<org>/<repo>
```

Alternatively, pass credentials via environment variables (less secure; prefer files):

```sh
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
GITHUB_APP_ID="YOUR_APP_ID" \
GITHUB_APP_CLIENT_ID="YOUR_CLIENT_ID" \
GITHUB_APP_PRIVATE_KEY_FILE=~/secrets/github_app_private_key \
/agents/kaseki-template/run-kaseki.sh https://github.com/<org>/<repo>
```

### Behavior

When GitHub App credentials are configured:

1. **After validation passes** and the diff is non-empty, Kaseki generates a GitHub App installation token.
2. **Creates a feature branch** named `kaseki/<instance-name>` (e.g., `kaseki/kaseki-1`).
3. **Commits and pushes** changes to the remote branch.
4. **Creates a draft PR** against the target branch with:
   - Title: `Kaseki: <instance-name>`
   - Body: Includes model, duration, validation result, quality check status
   - Draft status: Set to `true` for safety; review before merging

### Result Artifacts

When GitHub App is enabled:

- `git-push.log`: Detailed log of push and PR creation operations
- `metadata.json` includes:
  - `github_pr_url`: URL of created PR (if successful)
  - `github_push_exit_code`: Push operation status
  - `github_pr_exit_code`: PR creation status

### Exit Codes

Additional exit codes for GitHub operations:

- `7`: GitHub push/PR setup failed (missing credentials, invalid key, etc.)
- `8`: Failed to push branch to GitHub
- `9`: Push succeeded but PR creation failed (non-blocking; push result is retained)

Useful environment variables:

- `KASEKI_ROOT` defaults to `/agents`.
- `KASEKI_PROVIDER` defaults to `openrouter`.
- `KASEKI_IMAGE` defaults to `docker.io/cyanautomation/kaseki-agent:0.1.0`.
- `KASEKI_CONTAINER_USER` defaults to the current host UID/GID (`$(id -u):$(id -g)`).
- `KASEKI_MODEL` defaults to `openrouter/free`.
- `KASEKI_AGENT_TIMEOUT_SECONDS` defaults to `1200`.
- `KASEKI_VALIDATION_COMMANDS` defaults to `npm run check;npm run test;npm run build`.
- `KASEKI_DEBUG_RAW_EVENTS=1` stores raw Pi JSONL events as `pi-events.raw.jsonl`.
- `KASEKI_KEEP_WORKSPACE=0` removes the per-run workspace after each run. Set to `1` only when you need to inspect the workspace after a failure.
- `KASEKI_STREAM_PROGRESS=1` streams sanitized progress lines from Pi JSON events. Set to `0` to keep progress only in artifacts.
- `KASEKI_VALIDATE_AFTER_AGENT_FAILURE=0` skips validation after the Pi agent fails or times out. Set to `1` to run validation anyway.
- `KASEKI_CHANGED_FILES_ALLOWLIST` defaults to `src/lib/parser.ts tests/parser.validation.ts`.
- `KASEKI_MAX_DIFF_BYTES` defaults to `200000`.
- `TASK_PROMPT` defaults to a bounded `crudmapper` code-fix task.
- `KASEKI_DEPENDENCY_CACHE_DIR` defaults to `/workspace/.kaseki-cache` (external workspace cache for target repo dependencies).
- `KASEKI_IMAGE_DEPENDENCY_CACHE_DIR` defaults to `/opt/kaseki/workspace-cache` (image-provided dependency cache seeds).

## Host readiness check

Run the doctor command before first use or after host changes:

```sh
/agents/kaseki-template/run-kaseki.sh --doctor
```

It checks Docker availability, writable run/result directories, image presence,
OpenRouter key availability, and whether the deployed host template files match
the configured Docker image. A parity warning means host scripts were deployed
without rebuilding or pulling the matching image; set `KASEKI_IMAGE` to the
matching local image or rebuild before trusting behavior changes inside the
container.

## Help and usage

View the full usage guide and all available options:

```sh
/agents/kaseki-template/run-kaseki.sh --help
```

This displays:

- All invocation patterns (CLI arguments and environment variable options)
- Positional argument descriptions
- Environment variable reference with defaults
- Example invocations
- Information about backward compatibility

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

The dependency stamp is stored outside the cloned repo at
`$KASEKI_DEPENDENCY_CACHE_DIR/<repo-and-ref-hash>/<lock-hash>/stamp.txt`, so
`git.status`, `git.diff`, and `changed-files.txt` stay focused on target-repo
changes rather than Kaseki cache bookkeeping.

`run-kaseki.sh` keeps the same runtime hardening (`--read-only`, `--tmpfs`,
dropped capabilities, and non-root execution through `KASEKI_CONTAINER_USER`).

Cleanup old workspaces while keeping results:

```sh
KASEKI_CLEANUP_DAYS=1 /agents/kaseki-template/cleanup-kaseki.sh
```

Docker cleanup is explicit and guarded. Use `--docker --dry-run` first, then
add `--force` to prune old Docker build cache and dangling images:

```sh
/agents/kaseki-template/cleanup-kaseki.sh --docker --dry-run
/agents/kaseki-template/cleanup-kaseki.sh --docker --force
```

Results are written to `/agents/kaseki-results/kaseki-N`, including filtered `pi-events.jsonl`, `pi-summary.json`, `result-summary.md`, logs, metadata, validation output, stage timings, dependency cache status, git status, git diff, `progress.log`, `progress.jsonl`, and `cleanup.log`. Automatic instance selection skips any existing result directory so completed artifacts are not overwritten after run workspace cleanup. `kaseki-agent.sh` resolves the OpenRouter key in this order before Pi execution: non-empty `OPENROUTER_API_KEY` environment value, then `/run/secrets/openrouter_api_key`, else it fails fast with a missing-key error before cloning or validation. Runtime logs report only the source method (`env` or `secret file`), never the key value.

Show sanitized progress for a running or completed instance:

```sh
/agents/kaseki-template/kaseki progress kaseki-4 --tail=25
/agents/kaseki-template/kaseki follow kaseki-4 --tail=progress.log
```

Print a compact diagnostic report for any result directory:

```sh
docker run --rm \
  --entrypoint kaseki-report \
  -v /agents/kaseki-results/kaseki-4:/results:ro \
  kaseki-template:latest \
  /results
```

The report includes status, failed command, exit codes, requested and actual
models, total and agent duration, stage timings, validation timings, dependency
cache status, changed files, secret-scan status, and the next diagnostic
artifact to inspect.

## Exit codes

Kaseki uses specific non-zero exit codes for validation/policy failures:

- `2`: missing required runtime configuration (for example `OPENROUTER_API_KEY`) or invalid instance format in the wrapper script.
- `3`: empty git diff (the agent produced no changes).
- `4`: diff exceeds `KASEKI_MAX_DIFF_BYTES`.
- `5`: a changed file is outside `KASEKI_CHANGED_FILES_ALLOWLIST`.
- `6`: secret scan detected credential-like content.
- `7`: GitHub push/PR setup failed (missing credentials, invalid key, token generation failed, etc.)
- `8`: failed to push branch to GitHub.
- `9`: push succeeded but PR creation failed (non-blocking; push result is retained).

Other non-zero exit codes may be propagated from failed steps (for example clone, dependency install, agent run, or validation commands). Check `/results/metadata.json` for `failed_command` and detailed per-stage exit fields.

Container healthcheck behavior:

- The image defines `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD test -f /results/stdout.log && test -f /results/stderr.log`.
- `/results` always exists because it is created in the image (`mkdir -p /results`) and also created again at runtime by `kaseki-agent.sh`.
- The container is reported **healthy** after the runner initializes its result logs.
- Run completion is still tracked by `/results/exit_code`.
