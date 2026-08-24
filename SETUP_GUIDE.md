# Kaseki Agent Setup Guide

Issue: [cyanautomation/kaseki-agent#984](https://github.com/cyanautomation/kaseki-agent/issues/984)

This guide provides an overview of running kaseki-agent and migrating from previous setup documentation. For full setup instructions by execution path, see [docs/QUICK_START.md](docs/QUICK_START.md).

## Overview

**SETUP_GUIDE.md** replaces the retired `NPM_SETUP.md`, `DOCKER_SETUP.md`, and `GETTING_STARTED.md`. Those files were merged into the unified [docs/QUICK_START.md](docs/QUICK_START.md) decision tree covering all three deployment paths: Docker Compose, single-run, and API service.

## Command Migrations

| Old Command | New Command | Notes |
|---|---|---|
| `kaseki-agent setup` | `kaseki-agent init` | Unified wizard; `setup` delegates to `init` |
| `kaseki-report <dir>` | `docker run ... kaseki-report /results` | Built into container image |
| `kaseki-cli <cmd>` | `./kaseki-cli.js <cmd>` | Node.js script; documented in [docs/CLI.md](docs/CLI.md) |

## Deprecated Commands

The following commands are no longer supported. Users migrating from prior versions should consult [docs/MIGRATION.md](docs/MIGRATION.md):

- `kaseki-agent quickstart` -- replaced by `kaseki-agent init`
- `scripts/kaseki-setup.sh` -- removed; use `kaseki-agent init`
- `scripts/kaseki-activate.sh` -- removed; template auto-initializes on API startup

## Credentials and Configuration

### Secret Storage

Credentials are stored in a single file: `~/.kaseki/secrets.json` with permissions set to `0600` (owner read/write only). The `OPENROUTER_API_KEY_FILE` variable defaults to this path.

### Essential 8 Variables

The minimum configuration requires 8 variables. Full details are in [docs/ADVANCED_CONFIG.md](docs/ADVANCED_CONFIG.md), organized by configuration zone:

1. `OPENROUTER_API_KEY_FILE` -- Path to API key secret
2. `KASEKI_MODEL` -- AI model for code generation
3. `REPO_URL` -- Target repository URL
4. `GIT_REF` -- Branch, tag, or commit
5. `KASEKI_VALIDATION_COMMANDS` -- Validation command string
6. `KASEKI_AGENT_TIMEOUT_SECONDS` -- Agent timeout
7. `TASK_PROMPT` -- Instruction for the coding agent
8. `OPENROUTER_API_KEY` -- Inline API key (alternative to file)

See [docs/ADVANCED_CONFIG.md](docs/ADVANCED_CONFIG.md) for all 60+ variables across execution, validation, caching, logging, infrastructure, and advanced zones.
