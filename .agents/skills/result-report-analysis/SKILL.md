---
name: result-report-analysis
description: Interpret Kaseki run reports and artifacts without overstating what they prove.
tags: [kaseki, analysis, reporting, metrics, diagnostics]
relatedSkills: [workflow-diagnosis]
---

# Result Report Analysis for Kaseki Agent

Use this skill to summarize a completed run, explain its outcome, or compare
measured metrics. Start with `kaseki-agent report <run-id>` and use the
artifact schema as the authority for field meaning.

## Review sequence

1. Read the report summary and terminal status.
2. Check `metadata.json` for the recorded exit status and stage outcomes.
3. Inspect artifacts relevant to the question, such as `changed-files.txt`,
   `validation.log`, `validation-timings.tsv`, `cache-metrics.json`, or
   `pi-summary.json` when present.
4. Compare elapsed time, token usage, or changed files only when the metric was
   captured and the runs have comparable task, model route, validation, and
   host conditions.
5. Separate observed facts from likely explanations. A metric by itself does
   not establish quality, correctness, or causation.

Do not infer that a run succeeded from a nonempty diff or that it failed from an
empty diff. Check the admitted task mode, goal result, validation outcomes, and
exit code. Treat secret scan output as sensitive; report file and rule context
without repeating credential values.

## Canonical references

- [Artifact schemas](../../../docs/ARTIFACT_SCHEMAS.md) — artifact fields and
  availability
- [Exit codes](../../../docs/EXIT_CODES.md) — terminal result meanings
- [CLI guide](../../../docs/CLI.md) — report and status commands
- [Workflow diagnosis](../workflow-diagnosis/SKILL.md) — failure investigation
