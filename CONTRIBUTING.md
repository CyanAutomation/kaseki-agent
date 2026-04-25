# Contributing to Kaseki Agent

Thanks for helping improve Kaseki Agent. This repo is the host/container orchestration layer for running ephemeral coding-agent jobs, so changes here should stay bounded, reproducible, and operator-friendly.

## 1) Proposing or updating `TASK_PROMPT` defaults and guardrails

`TASK_PROMPT` defaults are currently defined in both runtime entrypoints:

- Host launcher: `run-kaseki.sh`
- Container runner: `kaseki-agent.sh`

When changing default prompt behavior, update both files in the same PR so host metadata and in-container execution stay aligned.

### What to include in prompt changes

- **Task objective clarity:** what behavior the downstream agent should change.
- **Scope boundaries:** which files/types of changes are allowed.
- **Security guardrails:** explicit instruction to avoid printing/exposing secrets, credentials, or env vars.
- **Test expectation in prompt:** call out the focused test file(s) to update when behavior changes.

### PR expectations for prompt changes

- Explain *why* the prompt default changed and what failure mode it addresses.
- Include before/after prompt snippets (or a concise diff summary).
- Confirm both scripts were updated together (unless intentionally diverged, which should be justified).

## 2) Test expectations for upstream target repos

Behavior changes in target repos must include corresponding tests. In particular:

- Add or update **focused Vitest coverage** whenever behavior changes.
- Prefer narrow, deterministic tests near the touched behavior (for example, parser-focused tests rather than broad end-to-end-only coverage).
- Ensure `KASEKI_VALIDATION_COMMANDS` still reflects the expected upstream validation sequence.

If a prompt requests behavior changes but no focused Vitest update is present, treat that as an incomplete contribution.

## 3) Running the local containerized flow

Use either the published image or a local build, then run `./run-kaseki.sh` from this repo root.

### Option A: pull published image

```bash
docker pull docker.io/cyanautomation/kaseki-agent:0.1.0
OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh
```

### Option B: build locally, then run

```bash
docker build -t kaseki-template:latest .
KASEKI_IMAGE=kaseki-template:latest OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh
```

Optional: pass a specific instance name (for example `kaseki-7`) as the first arg.

## 4) Validating changed-file allowlist and max diff limits

The container runner enforces quality gates using:

- `KASEKI_CHANGED_FILES_ALLOWLIST`
- `KASEKI_MAX_DIFF_BYTES`

Contributors must validate that any change to defaults or behavior preserves these constraints:

- Changed files remain within the configured allowlist for the intended task.
- `git.diff` size remains under the configured max diff bytes.
- If you intentionally broaden scope, update defaults/documentation and clearly explain operator impact.

A failed allowlist or diff-size check should be treated as a real regression unless intentionally changed and documented.

## 5) Diagnosing failures with `/agents/kaseki-results/kaseki-N`

When a run fails, inspect artifacts in this order:

1. `result-summary.md` for top-level status, failed command, and changed files.
2. `metadata.json` for exit codes (`pi`, validation, quality, secret scan), model details, and timing.
3. `stdout.log` / `stderr.log` for execution flow and shell-level failures.
4. `pi-summary.json` and `pi-events.jsonl` for agent/model behavior.
5. `validation.log` and `validation-timings.tsv` for command failures and duration outliers.
6. `quality.log`, `changed-files.txt`, and `git.diff` for allowlist/diff-limit failures.
7. `secret-scan.log` for credential-detection issues.
8. `host-start.json`, `host_docker_exit_code`, and `resource.time` for host/container startup context.

Tip: If quality or validation failures are ambiguous, compare `git.status` + `git.diff` with `TASK_PROMPT` constraints first.

## PR checklist

Before opening/merging, include:

- [ ] Prompt rationale for any `TASK_PROMPT` default or guardrail change.
- [ ] Test evidence (commands + output summary), including focused Vitest updates when behavior changed.
- [ ] Confirmation that changed-file allowlist and max diff checks still pass (or documented rationale for updates).
- [ ] Any operator-impacting env var, default, or runbook/documentation updates.
