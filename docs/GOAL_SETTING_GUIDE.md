# Goal-Setting Agent: Comprehensive Guide

Goal setting refines a task prompt before scouting and coding. It records the
original request, an upgraded goal, key requirements, success criteria, and
confidence in the run's `goal-setting.json` artifact. The artifact can also
include constraints, anti-patterns, examples, quality metrics, or preservation
constraints when relevant.

## Configuration

### When it runs

Goal setting is enabled by default for patch runs. Inspect runs skip it unless
explicitly enabled. Set `KASEKI_GOAL_SETTING=0` to disable it for a worker run.

For API requests, use `goalSetting`:

```json
{
  "goalSetting": {
    "enabled": true,
    "model": "optional-model-override",
    "timeoutSeconds": 300
  }
}
```

`timeoutSeconds` accepts 60–10,800 seconds. The default model follows the
scouting model. See [environment variables](./ENV_VARS.md) for the worker
settings and defaults, and the [API reference](./API.md) for request details.

## Reading the result

Inspect `goal-setting.json` with the run's other artifacts. Check that
`upgraded_goal` preserves the request, `key_requirements` retain its important
conditions, and `success_criteria` can be verified. Criteria may be strings or
structured SMART criteria. The output schema requires at least one criterion
that is not scored low. Goal setting is advisory: the original request and
repository instructions remain authoritative.

If goal setting cannot produce a valid result, the run may continue using a
fallback based on the original prompt. Check the run status and
`goal-setting-validation-errors.jsonl` or `goal-setting-stderr.log` when
investigating a fallback or phase failure. See [exit codes](EXIT_CODES.md) and [evaluation best practices](./EVALUATION_BEST_PRACTICES.md) for related
interpretation. For the evaluation feedback flow, see
[feedback loop integration](./FEEDBACK_LOOP_INTEGRATION.md).

## Exit Codes & Troubleshooting

When goal setting falls back or fails, inspect the run status and phase
diagnostics described above. The specific exit code depends on the failure
phase; see [exit codes](EXIT_CODES.md) for the current mapping.

## Write useful task goals

- State the desired change and the relevant part of the repository.
- Include observable checks, such as behavior to preserve or tests to run.
- Name hard boundaries and files or behavior that must remain untouched.
- Keep requirements from the original request; do not add scope to make a goal
  sound more specific.

The previous detailed implementation guide is preserved as a
[May 2026 archive](archive/LEGACY_GOAL_SETTING_GUIDE_2026-05.md). Treat its
examples as historical and verify them against current code before reuse.
