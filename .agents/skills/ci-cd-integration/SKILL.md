---
name: ci-cd-integration
description: Integrate Kaseki runs into CI/CD while keeping event data and credentials bounded.
tags: [kaseki, ci-cd, github-actions, gitlab-ci, jenkins, automation]
relatedSkills: [prompt-engineering, environment-configuration, workflow-diagnosis, cost-optimization, quality-gate-config]
---

# CI/CD Integration for Kaseki Agent

Use this skill when a pipeline submits Kaseki runs or consumes their results.
For supported request fields and end-to-end deployment examples, start with the
[CI/CD integration guide](../../../docs/CI_CD_INTEGRATION.md).

## Secure integration checklist

- Treat issue comments, pull-request text, branch names, and repository content
  as untrusted input. Require an authorized actor before submitting work or
  exposing credentials. For GitHub events, check `author_association` and the
  event type; do not run for arbitrary fork contributions.
- Give the workflow only the permissions it needs. Start with explicit
  `permissions: contents: read`; grant write access only in a separate step
  that requires it.
- Pin third-party actions to full commit SHAs and review updates.
- Pass event values through environment variables or structured JSON. Do not
  interpolate untrusted event text into shell source.
- Store the Kaseki API token as a secret and send it only in the authorization
  header. Do not print it, include it in task prompts, or upload it as an
  artifact.
- Bound each run with an explicit task prompt, changed-file allowlist, and
  validation commands. See [quality-gate-config](../quality-gate-config/SKILL.md).
- Poll the run status endpoint and treat `failed`, unexpected, or timed-out
  states as failures. Do not create a pull request from a failed run.

## GitHub Actions example constraints

Use `workflow_dispatch`, a trusted maintainer event, or a separately protected
workflow. A comment-triggered workflow should check the repository event, reject
pull-request comments unless deliberately supported, and allow only trusted
`author_association` values. Keep the workflow's top-level permissions
read-only where possible; protect any write-token step with a GitHub Environment
or equivalent approval boundary.

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
    with:
      persist-credentials: false
```

When constructing the API request, serialize fields with `jq -n` or an action
input rather than building JSON by string concatenation. Put the task text in a
structured field, set a unique idempotency key, and allow only intended paths.

## Other CI systems

Apply the same rules in GitLab CI, Jenkins, or another runner: masked secret
storage, narrow job permissions, trusted event filtering, structured request
construction, bounded task scope, status polling, and artifact retention that
excludes credentials. Use the platform-specific templates in the integration
guide and verify their current syntax before adopting them.

## Related references

- [CI/CD integration](../../../docs/CI_CD_INTEGRATION.md)
- [Prompt engineering](../prompt-engineering/SKILL.md)
- [Workflow diagnosis](../workflow-diagnosis/SKILL.md)
- [Environment configuration](../environment-configuration/SKILL.md)
