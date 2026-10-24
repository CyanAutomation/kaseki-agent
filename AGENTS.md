# Repository Instructions

Kaseki Agent schedules coding tasks through a REST API and runs them in
disposable Docker workers. The TypeScript CLI submits and monitors runs; Bash
and Docker scripts configure hosts and execute worker phases.

## Where to look

- [README](README.md) — product overview and entry points.
- [Documentation index](docs/INDEX.md) — current guides, references, and design notes.
- [Contributing guide](CONTRIBUTING.md) — contribution workflow and review standards.
- `src/` — TypeScript API, CLI, configuration, and run orchestration.
- `scripts/`, `Dockerfile`, and `docker-compose.yml` — host setup and container behavior.
- `.agents/skills/` — agent-facing operational knowledge.
- `.agents/skills/README.md` — skill index and maintenance guidance. The repository does not define an automatic keyword registry; consult a skill when the task matches its scope.
- [Markdown inventory](docs/internal/MARKDOWN_INVENTORY.md) — documentation roles and locations.

Check the implementation and its tests before changing a behavior description.
The active deployment guide is [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); dated
reports and superseded guides are under `docs/archive/`.

## Development

Use Node.js 24 or later and install dependencies with `npm ci`. The standard
checks are:

```bash
npm run check
npm test
```

`npm run check` runs type checking, linting, and local Markdown-link checks.
`npm test` builds the project and runs the unit suite. For a focused change,
run the relevant test first and add regression coverage before fixing the
behavior.

For workflow or documentation-checker changes, also run:

```bash
npm run test:markdown-links
npm run test:workflows
```

## Documentation

- Keep product setup and operation guidance in `docs/` and link it from
  `docs/INDEX.md`.
- Keep project history in `docs/archive/`; do not present dated snapshots as
  current product instructions.
- Keep agent skills, GitHub templates, and script templates beside the tools
  that consume them.
- Update `docs/internal/MARKDOWN_INVENTORY.md` whenever Markdown files move or
  their role changes.
- `npm run check:markdown-links` checks all tracked Markdown files by default.
- Environment variable names and defaults must agree with the implementation
  and [the environment reference](docs/ENV_VARS.md).

## Operational accuracy

- The guided Docker Compose deployment supports Debian 12/13 and 64-bit
  Raspberry Pi OS; see [the quick start](docs/QUICK_START.md).
- The API mounts the Docker socket to launch workers. Treat API bearer tokens
  as host-administrator credentials.
- `/ready` reports API startup and does not test gateway credentials or model
  availability.
- Coding inference uses the configured OpenAI-compatible gateway. OpenRouter
  credentials are optional for evaluation stages.
- Never put real credentials in source, docs, logs, command examples, or test
  fixtures. Use clearly fake values in tests.
