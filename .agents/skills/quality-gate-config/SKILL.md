---
name: quality-gate-config
description: Bound Kaseki changes and validation with task-appropriate quality gates.
tags: [kaseki, quality-gates, validation, constraints, security]
relatedSkills: [prompt-engineering, workflow-diagnosis, cost-optimization, environment-configuration, performance-tuning, ci-cd-integration]
---

# Quality Gate Configuration for Kaseki Agent

Use this skill when setting file scope, diff limits, or validation for a Kaseki
run. Prefer per-run request fields for API submissions; use environment
variables only for the execution mode that documents them.

## Choose gates for the task

- `changedFilesAllowlist` limits files the coding agent may change.
- `validationCommands` selects post-agent checks. Keep checks strong enough to
  cover the changed behavior.
- `KASEKI_VALIDATION_ALLOWLIST` is a separate worker setting for restricting
  files changed during validation.
- `KASEKI_MAX_DIFF_BYTES` limits patch size. Set it from representative changes
  for the task, not an arbitrary universal value.
- `KASEKI_VALIDATION_TIMEOUT_SECONDS` and
  `KASEKI_BUILD_VALIDATION_TIMEOUT_SECONDS` bound validation commands; see the
  [environment reference](../../../docs/ENV_VARS.md) for defaults.

Example API request fields:

```json
{
  "taskMode": "patch",
  "changedFilesAllowlist": ["src/parser.ts", "tests/parser.test.ts"],
  "validationCommands": ["npm run check", "npm test"]
}
```

Use paths and commands that exist in the target repository. Do not put a secret
or an untrusted shell fragment in a validation command.

## Gate review

1. Estimate the files and patch size needed for the requested outcome.
2. Confirm the target repository's validation commands work before the run.
3. Review any baseline failures separately from changes introduced by the run.
4. Inspect gate artifacts and the final diff when a gate fails; adjust the task
   or gate only when the evidence shows a legitimate mismatch.
5. Keep secret scanning and required tests enabled.

For request schemas, defaults, validation phases, and gate behavior, use the
canonical [Quality Gates guide](../../../docs/QUALITY_GATES.md) and
[Environment Variables reference](../../../docs/ENV_VARS.md).

## Related references

- [Prompt engineering](../prompt-engineering/SKILL.md)
- [Workflow diagnosis](../workflow-diagnosis/SKILL.md)
- [Performance tuning](../performance-tuning/SKILL.md)
- [CI/CD integration](../ci-cd-integration/SKILL.md)
