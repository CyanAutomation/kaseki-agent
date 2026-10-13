# Run Artifacts and Schema Sources

Kaseki writes run artifacts under `/results`. The files available for a run
depend on its phases and execution path. The TypeScript types, artifact
writers, and tests define the current formats; the examples in older documents
are not a contract for every artifact.

## Current sources of truth

| Artifact area | Source |
| --- | --- |
| Run metadata | [`KasekiMetadata`](../src/types/kaseki-metadata.ts) and the [metadata writer](../scripts/write-run-metadata.mjs) |
| Run scorecard | [Scorecard types](../src/types/run-scorecard.ts), [implementation](../src/run-scorecard.ts), and [scorecard design](RUN_SCORECARD_DESIGN.md) |
| REST API schemas | [OpenAPI schema definitions](../src/openapi-spec-generators/schemas.ts) and the [API reference](API.md) |
| Phase and summary artifacts | Writers and tests under `scripts/` and `src/` |

The artifact family does not share one schema version. Check each artifact's
own type and producer; `metadata.json` also accepts legacy field names while
older run results remain readable.

## Common results

- `metadata.json` contains run identity, timing, status, and phase data.
- `run-scorecard.json` contains the evidence-based run score when scorecard
  generation succeeds.
- `result-summary.md` is a human-readable run summary when produced.
- Phase outputs and event logs are available according to the phases that ran.

For API response formats, use the [REST API reference](API.md). For the
historical June 2026 artifact proposal, see the
[archived schema snapshot](archive/project-reports/ARTIFACT_SCHEMAS_SNAPSHOT_2026-06.md).
