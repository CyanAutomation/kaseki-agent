# Kaseki Agent Setup Guide

Issue: [cyanautomation/kaseki-agent#984](https://github.com/cyanautomation/kaseki-agent/issues/984)

Migration reference. For full quick-start, see [docs/QUICK_START.md](docs/QUICK_START.md).

## Command Migrations

| Old Command | New Command | Notes |
|---|---|---|
| `kaseki-agent setup` | `kaseki-agent init` | Unified wizard; `setup` removed |
| `kaseki-report <dir>` | `docker run ... kaseki-report /results` | Built into container image |
| `kaseki-cli <cmd>` | `./kaseki-cli.js <cmd>` | Node.js script; [CLI docs](docs/CLI.md) |

## Deprecated Commands

Commands no longer supported:

- `kaseki-agent quickstart` -- replaced by `kaseki-agent init`
- `scripts/kaseki-setup.sh` -- removed; use `kaseki-agent init`
- `scripts/kaseki-activate.sh` -- removed; template auto-initializes on API startup

## Credentials and Configuration

### Secret Storage

Credentials are stored in `~/.kaseki/secrets.json` (permissions `0600`). Default path via `OPENROUTER_API_KEY_FILE`.

### Primary Provider: LLM Gateway

Kaseki uses an LLM Gateway as primary provider:

```bash
# LLM Gateway (primary)
export LLM_GATEWAY_URL=https://your-gateway/v1
export LLM_GATEWAY_API_KEY_FILE=~/.kaseki/secrets.json
# OpenRouter fallback: KASEKI_PROVIDER=openrouter
export KASEKI_PROVIDER=openrouter
export OPENROUTER_API_KEY=sk-or-...
```

### Essential 8 Variables

Minimum 8 variables required. Full details in [docs/ADVANCED_CONFIG.md](docs/ADVANCED_CONFIG.md):
1. `LLM_GATEWAY_URL` -- LLM Gateway endpoint
2. `LLM_GATEWAY_API_KEY_FILE` -- Path to gateway key secret (default: `~/.kaseki/secrets.json`)
3. `KASEKI_MODEL` -- AI model identifier
4. `REPO_URL` -- Target repository URL
5. `GIT_REF` -- Branch, tag, or commit
6. `KASEKI_VALIDATION_COMMANDS` -- Post-run validation commands
7. `KASEKI_AGENT_TIMEOUT_SECONDS` -- Max agent duration (default: 10800s)
8. `TASK_PROMPT` -- Instruction for the coding agent

See [docs/ADVANCED_CONFIG.md](docs/ADVANCED_CONFIG.md) for all 60+ variables across zones.
