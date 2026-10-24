---
name: performance-tuning
description: Diagnose Kaseki run time, resource use, and cost from measured run data.
tags: [kaseki, performance, optimization, speed, tuning, cost]
relatedSkills: [cost-optimization, dependency-cache-optimization, environment-configuration, quality-gate-config]
---

# Performance Tuning for Kaseki Agent

Use this skill when a Kaseki run is consistently slow, resource-heavy, or more
expensive than expected. Start with the run's artifacts and change one cause at
a time. Do not infer performance from a single timing or promise fixed savings.

## Diagnose the stage first

Use `kaseki-agent report <run-id>` to find the run summary, then inspect its
artifacts and the relevant timing data.

| Observation | Investigate |
| --- | --- |
| Dependency preparation dominates | Cache hit/miss and package-manager details; see [dependency-cache-optimization](../dependency-cache-optimization/SKILL.md). |
| Validation dominates | Which command is slow, whether it runs before and after agent work, and whether a narrower check preserves needed coverage. |
| Scouting or coding dominates | Task scope, irrelevant repository exploration, tool-output volume, and context limits. |
| Runs queue or slow under concurrency | Host CPU, memory, disk, Docker capacity, and gateway limits before increasing concurrency. |
| Agent timeout | Whether the task is too broad or the configured ceiling is too low. A higher timeout permits longer work; it does not make work faster. |

Compare runs only when their task scope, target repository, validation, model
routing, and host conditions are similar. Use several representative runs for a
baseline and report the sample size and configuration.

## Tune with evidence

1. Record elapsed time by phase, validation timings, dependency-cache metrics,
   changed-file count, and available token usage.
2. Identify the dominant phase before changing configuration.
3. Make one bounded change, such as narrowing an irrelevant task scope,
   correcting a cache miss, or selecting an adequate focused validation command.
4. Repeat with a comparable task and compare the same measurements.
5. Keep the change only if it improves the target metric without weakening the
   required quality gates or task outcome.

Do not recommend skipping tests, secret checks, or file-scope gates solely to
reduce run time. Use [quality-gate-config](../quality-gate-config/SKILL.md) when
the validation scope itself needs review.

## Cost measurements

Coding inference uses the configured OpenAI-compatible gateway and model route.
OpenRouter usage is separate and applies to configured evaluation stages. Check
the model and token counts reported by the gateway before estimating cost; a
dynamic route can select different models. Use current provider rates and
representative task samples. Do not present old example prices or generic
percentage savings as expected outcomes.

See the canonical [performance guide](../../../docs/PERFORMANCE_TUNING.md),
[cost guide](../../../docs/COST_ESTIMATION.md), and
[environment reference](../../../docs/ENV_VARS.md) for settings and artifact
details.
