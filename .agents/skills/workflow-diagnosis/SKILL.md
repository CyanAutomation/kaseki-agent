---
name: workflow-diagnosis
description: Diagnose Kaseki run failures from status, exit codes, and recorded artifacts.
tags: [kaseki, troubleshooting, diagnostics, debugging]
relatedSkills: [prompt-engineering, quality-gate-config, test-automation, docker-image-management, dependency-cache-optimization, result-report-analysis, ci-cd-integration, distributed-deployment, environment-configuration]
---

# Workflow Diagnosis for Kaseki Agent

Use this skill when a Kaseki run fails, times out, changes unexpected files, or
returns an unexpected result. The canonical [troubleshooting guide](../../../docs/TROUBLESHOOTING.md)
contains current decision trees and remediation steps.

## Triage sequence

1. Check the terminal state with `kaseki-agent status <run-id>` and read the
   summary with `kaseki-agent report <run-id>`.
2. Find the exit code and stage that failed in `metadata.json` and the summary.
3. Inspect only the relevant artifacts: for example `validation.log`,
   `quality.log`, `dependency-cache.log`, `pi-summary.json`, or
   `changed-files.txt` when present.
4. Compare the observed result with the documented exit-code meaning.
5. Change one cause at a time and rerun only after preserving relevant evidence.

## Common routing

- Validation failure: inspect the failed command and baseline result; see
  [test-automation](../test-automation/SKILL.md).
- File-scope or diff-size gate: inspect the changed paths and request settings;
  see [quality-gate-config](../quality-gate-config/SKILL.md).
- Dependency install delay or restore error: inspect cache source and package
  manager; see [dependency-cache-optimization](../dependency-cache-optimization/SKILL.md).
- Agent timeout: compare phase timings and task scope; see
  [performance-tuning](../performance-tuning/SKILL.md).
- Provider or gateway error: verify the configured coding gateway and any
  separate evaluation credential; see
  [environment-configuration](../environment-configuration/SKILL.md).
- Secret-scan finding: do not repeat the value in logs or reports. If a real
  credential was exposed, revoke and rotate it, then investigate its source.

Do not assume an empty diff means success or failure. Check task mode, goal
result, validation, and exit status. Do not infer unsupported artifact fields;
use the [artifact schemas](../../../docs/ARTIFACT_SCHEMAS.md).

## Canonical references

- [Troubleshooting](../../../docs/TROUBLESHOOTING.md)
- [Exit codes](../../../docs/EXIT_CODES.md)
- [Artifact schemas](../../../docs/ARTIFACT_SCHEMAS.md)
- [Result report analysis](../result-report-analysis/SKILL.md)
