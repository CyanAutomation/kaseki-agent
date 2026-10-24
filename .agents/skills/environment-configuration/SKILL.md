---
name: environment-configuration
description: Set up Kaseki deployments and find the supported environment settings.
tags: [kaseki, configuration, environment-variables, secrets, deployment]
relatedSkills: [cost-optimization, performance-tuning, docker-image-management, distributed-deployment, ci-cd-integration, quality-gate-config, prompt-engineering, workflow-diagnosis]
---

# Environment Configuration for Kaseki Agent

Use this skill to plan a setup or locate the right configuration source. The
published [environment reference](../../../docs/ENV_VARS.md) is the source for
supported public variable names, defaults, and behavior. The
[generated public-variable catalog](PUBLIC_ENVIRONMENT_VARIABLES.md) is a
compact, partial lookup; it is not a complete runtime manifest.

## Key boundaries

- Coding inference uses the configured OpenAI-compatible gateway. OpenRouter
  credentials are optional for evaluation stages and are not a coding fallback.
- API service, CLI, host scripts, and worker settings have setting-specific
  sources and precedence; do not assume one global order.
- Repository, ref, task prompt, and per-run quality gates are run inputs passed
  through the CLI or API request.
- Keep gateway and API credentials in supported secret files or a secret store.
  Never put credential values in prompts, logs, or committed configuration.
- Treat API bearer tokens as host-administrator credentials because the API can
  launch workers through the mounted Docker socket.

## Setup workflow

1. Follow the active [deployment guide](../../../docs/DEPLOYMENT.md) for the
   target host and Docker Compose layout.
2. Configure the gateway URL and key file for coding inference. Keep evaluation
   credentials separate and configure them only when evaluation stages need
   them.
3. Configure API authentication and secret mounts using the deployment guide.
   Keep the API bound to loopback unless network access is intentionally
   protected and configured.
4. Supply repository, ref, task prompt, and task-specific gates on each run.
   See [quality-gate-config](../quality-gate-config/SKILL.md) for change and
   validation limits.
5. Verify the actual values with the supported setup or diagnosis command for
   that deployment. Check the environment reference when a setting's source or
   default is unclear.

### Local gateway run

```bash
export KASEKI_PROVIDER=gateway
export LLM_GATEWAY_URL=https://gateway.example.com/v1
export LLM_GATEWAY_API_KEY_FILE="$HOME/.kaseki/secrets/llm_gateway_api_key"
kaseki-agent run https://github.com/org/repo main "Fix the failing test"
```

The key path is an example; create and permission the file using the setup
instructions for the selected deployment.

## Related references

- [Environment variables](../../../docs/ENV_VARS.md)
- [Deployment](../../../docs/DEPLOYMENT.md)
- [Advanced configuration](../../../docs/ADVANCED_CONFIG.md)
- [Cost optimization](../cost-optimization/SKILL.md)
- [Docker image management](../docker-image-management/SKILL.md)
