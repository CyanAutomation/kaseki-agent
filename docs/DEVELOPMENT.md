# Development Guide

This guide covers local development and the main code paths in Kaseki Agent. For
deployment and operator workflows, start at the [documentation index](INDEX.md).

## Architecture

Kaseki Agent accepts task requests through a REST API or CLI. The API validates
and schedules each run; a disposable Docker worker clones the requested
repository, invokes the Pi coding agent through an OpenAI-compatible model
gateway, runs configured validation, and stores the resulting artifacts.

```text
CLI or API client
        │
        ▼
REST API and job scheduler
        │
        ▼
Disposable Docker worker ── model gateway
        │
        ├── clone target repository
        ├── run agent and validation
        └── store logs, reports, and artifacts
```

OpenRouter is an optional credential for configured evaluation stages. It is
separate from the gateway used for coding inference. The `/ready` endpoint
confirms API readiness; it does not send a model request. See the
[environment reference](ENV_VARS.md) for provider configuration and the
[deployment guide](DEPLOYMENT.md) for the API's security boundary.

## Main components

| Component | Source | Responsibility |
|---|---|---|
| CLI | `src/cli/` | Setup, host diagnostics, and API-backed task commands |
| API service | `src/kaseki-api-service.ts`, `src/kaseki-api-routes.ts`, `src/routes/` | HTTP endpoints, authentication, task admission, and run access |
| Scheduler | `src/job-scheduler.ts` | Queue and worker lifecycle |
| Worker | `Dockerfile`, `kaseki-agent.sh`, `scripts/` | Disposable task execution, validation, and artifact collection |
| Configuration | `src/config/`, `src/setup/` | CLI settings, initialization, and secret discovery |

The REST contract is documented in the [API reference](API.md); CLI commands
are documented in the [CLI reference](CLI.md).

## Development environment

The npm package supports Linux and requires Node.js 24 or later. Install
ShellCheck to run the full lint command. Bun 1.4.3 is needed only for the target
repository package-manager integration tests; Docker is needed for Docker-backed
integration checks.

From a checkout, install the locked dependencies and run the standard checks:

```bash
npm ci
npm run check
npm test
```

- `npm run check` runs type checking, ESLint, ShellCheck, and local Markdown link
  and command-reference checks.
- `npm test` builds the project and runs the Jest unit tests.
- `npm run test:ci` runs the broader CI validation suite. It includes additional
  shell and integration checks and may require Bun and other CI tools.

For a focused unit test while iterating:

```bash
npm run test:unit -- src/path/to/module.test.ts
```

The unit-test script builds before invoking Jest. For Docker-backed integration
coverage, use `npm run test:integration:docker` on a host with Docker available.
See the [verification guide](VERIFICATION_GUIDE.md) for a change-specific test
selection workflow.

## Making changes

- **CLI command:** Add or update a handler in `src/cli/commands/`, register it
  through `src/cli/KasekiCLI.ts`, and update CLI help, focused tests, and
  `CLI.md`.
- **API behavior:** Update the route or service under `src/kaseki-api-routes.ts`,
  `src/routes/`, or `src/kaseki-api-service.ts`; add focused coverage and update
  `API.md` when the contract changes.
- **Configuration:** Update the owning configuration source and
  `ENV_VARS.md`. Run `npm run check:environment-docs` when changing generated
  environment documentation.
- **Worker behavior:** Update the worker scripts or image setup, add regression
  coverage, and document user-visible configuration or behavior changes.

Use the project's existing validation scripts rather than adding new
dependencies for routine checks. Keep changes scoped, add regression tests for
behavior changes, and update the relevant user guide when a command, API, or
configuration contract changes. See [CONTRIBUTING.md](../CONTRIBUTING.md) for
contribution expectations.

## CI workflow

The GitHub Actions validation job uses Node.js 24, installs ShellCheck and the
pinned Bun version, installs npm dependencies with `npm ci`, and runs lint,
documentation checks, and the CI test suite. Keep local instructions aligned
with the scripts in `package.json` and the workflow in `.github/workflows/ci.yml`.

## Further reading

- [Development verification](VERIFICATION_GUIDE.md)
- [Environment variables](ENV_VARS.md)
- [API reference](API.md)
- [CLI reference](CLI.md)
- [Documentation index](INDEX.md)
