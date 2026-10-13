# Kaseki Agent

[![CI](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/ci.yml)
[![CodeQL](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/codeql.yml)

Kaseki Agent runs coding tasks in disposable Docker workers. A REST API
schedules the workers, a CLI submits and monitors runs, and each worker clones
the target repository, invokes Pi through an OpenAI-compatible gateway, runs
validation, and collects results.

Kaseki Agent is a proof of concept. The guided host deployment supports Debian
12/13 and 64-bit Raspberry Pi OS. Its `/ready` endpoint confirms API startup;
it does not contact the model gateway.

## Choose a path

| Goal | Start here |
| --- | --- |
| Set up the API on a clean Raspberry Pi or Debian host | [Raspberry Pi quick start](docs/QUICK_START.md) |
| Install and use the CLI | [Getting started](docs/GETTING_STARTED.md) and [npm setup](docs/NPM_SETUP.md) |
| Deploy or operate the API | [Deployment guide](docs/DEPLOYMENT.md) |
| Develop or contribute | [Development guide](docs/DEVELOPMENT.md) and [contributing guide](CONTRIBUTING.md) |

The npm package is a CLI client and host diagnostics tool. It does not install
the API server or worker image.

## Submit a task

After connecting the CLI to a running Kaseki API, submit and monitor a task:

```bash
export KASEKI_API_URL=http://localhost:8080/api/v1
kaseki-agent run https://github.com/owner/repo main "Fix the failing tests"
kaseki-agent status kaseki-1
kaseki-agent report kaseki-1
```

API clients submit the repository and task using `repoUrl` and `taskPrompt`:

```json
{
  "repoUrl": "https://github.com/owner/repo",
  "ref": "main",
  "taskPrompt": "Fix the failing tests"
}
```

Use the run ID returned by `run` in the status and report commands. The CLI
reads API credentials from the configured Kaseki secret store. See the
[CLI reference](docs/CLI.md) and [API reference](docs/API.md) for options and
authentication.

## Develop locally

Development requires Linux, Node.js 24 or later, npm, and ShellCheck:

```bash
npm ci
npm run check
npm test
```

See [development](docs/DEVELOPMENT.md) for workflows and
[contributing](CONTRIBUTING.md) for review expectations.

## Documentation

Use the [documentation index](docs/INDEX.md) to find current guides and
references. Historical investigation and implementation notes are collected
under [`docs/archive/`](docs/archive/README.md). Repository instructions,
GitHub templates, agent skills, and script templates remain beside the tools
that use them.

## Project links

- [GitHub issues](https://github.com/CyanAutomation/kaseki-agent/issues)
- [GitHub releases](https://github.com/CyanAutomation/kaseki-agent/releases)
- [License](LICENSE)
