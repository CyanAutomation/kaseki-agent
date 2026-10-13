# Advanced Configuration Guide

Use [Environment Variables](ENV_VARS.md) as the canonical catalog of supported
variable names, defaults, and purposes. This page routes to task-specific
configuration guidance; it does not repeat the variable catalog.

## Configure the host

- For a clean supported deployment, follow the [Raspberry Pi quick start](QUICK_START.md).
- For an existing Compose checkout, see [Docker setup](DOCKER_SETUP.md).
- For secret files and API credentials, see [authentication setup](AUTH_SETUP.md).
- For CLI configuration, see [npm setup](NPM_SETUP.md).

## Tune a run

- Set changed-file and validation constraints in [quality gates](QUALITY_GATES.md).
- Tune timeouts, dependency caching, and resource use in [performance tuning](PERFORMANCE_TUNING.md).
- Review provider usage in [cost estimation](COST_ESTIMATION.md).
- Configure task prompts with [prompt templates](TASK_PROMPT_TEMPLATES.md).

Older detailed configuration examples remain in the
[legacy reference](archive/LEGACY_ADVANCED_CONFIG.md). Check them against the
current variable catalog and implementation before reuse.
