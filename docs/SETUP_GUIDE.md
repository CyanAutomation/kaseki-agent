# Setup Guide

Choose the setup path for your role:

| Need | Start here |
|---|---|
| Install Kaseki API on a clean Raspberry Pi | [Raspberry Pi Quick Start](QUICK_START.md) |
| Run Compose setup from an existing checkout | `bash scripts/setup-pi.sh` |
| Install the task and diagnostics CLI on a workstation | [NPM Setup](NPM_SETUP.md) |
| Configure a production API deployment | [Deployment Guide](DEPLOYMENT.md) |

## Raspberry Pi setup

The supported first-run path uses `scripts/bootstrap-pi.sh` from the latest
GitHub release. It installs Docker Engine and Compose on Debian 12/13 or
64-bit Raspberry Pi OS, checks free disk space, verifies the release bundle's
SHA-256 checksum, and invokes `scripts/setup-pi.sh`. Follow
[QUICK_START.md](QUICK_START.md) for the copyable commands and provider setup.

The Compose service uses an OpenAI-compatible gateway for coding-agent
inference. The setup asks for the gateway base URL and stores its API key in a
host file. It creates a separate Kaseki API bearer token. OpenRouter is
optional for evaluation stages; it is not the coding inference provider.

## Legacy scripts and examples

Older examples that use `setup`, `agent`, or `run-mode` describe legacy
container workflows and should not be used for a new Compose deployment. The
remote helper remains available, but now accepts only an SSH target and
prompts remotely for gateway settings instead of accepting a credential
argument.
