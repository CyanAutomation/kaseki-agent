# Configuration audit summary

## Decision summary

The counts below are the measured audit baseline at `d28d9756`, before the implementation follow-up in this checkout. The implementation follow-up has not established a complete supported-variable manifest, so the audit's intentionally unquantified canonical counts and reduction estimates remain unquantified.

Kaseki's configuration is not currently represented by a single enumerable contract. The repository contains active runtime reads, internally injected worker metadata, deployment variables, test/script controls, deprecated names, and historical documentation. Counting every token as a supported setting would inflate the total and produce false reduction estimates. The audit therefore reports a reproducible discovery baseline and explicitly marks the product-setting classification count as unresolved rather than fabricating an implementation-ready percentage.

| Measure | Result | Definition |
|---|---:|---|
| Distinct static `process.env.NAME` references | 192 | `rg` scan of non-doc paths, excluding top-level `tests/`, `docs/`, node_modules and `.backup`; includes some source-adjacent tests and non-Kaseki platform/test names. |
| Distinct Kaseki-prefixed names in that scan | 130 | Same scan, names beginning `KASEKI_`; includes runtime settings, child-process metadata, and a few harness names. This is not the unique supported Kaseki configuration count. |
| Distinct documented/template variable names | 165 | Union of uppercase backtick names in `docs/ENV_VARS.md`, `docs/API.md`, `.env.example`, `.env.template`, `.env.advanced.template`, and `docker-compose.yml`; includes external/provider names and retired names. |
| Distinct Kaseki-prefixed names in docs/templates | 129 | Same union, prefix `KASEKI_`; includes explicitly retired names and some names referenced as examples. |
| Total unique Kaseki-owned supported variables | **Not established** | `.agents/skills/environment-configuration/environment-variables.json` is a partial published-documentation catalog, not a complete runtime ownership manifest; shell/dynamic lookups and aliases still require manual classification. |
| Current ENV variables recommended to remain ENV | **Not countable without choosing a canonical supported-setting denominator** | Inventory identifies retained groups; it does not claim every lexical name is a supported option. |
| Recommended API / CONFIG / CONST / MERGE / REMOVE counts | **Not countable without choosing a canonical supported-setting denominator** | Recommendations are grouped by coherent setting family, with retired/internal/external names separated. |
| Estimated ENV reduction | **Not quantified** | Depends on operator use, canonicalizing currently duplicated interfaces, and external compatibility checks. |
| Estimated total independent-setting reduction | **Not quantified** | Must count normalized settings after a target schema is selected; many current names are aliases, coupled fields, or transport metadata. |

These are measured evidence limits, not zero recommendations. To make future counts exact, extend the existing partial catalog into a supported-setting manifest with one row per canonical setting and explicit aliases/transport fields. Then compare that manifest with the runtime loader and deployment templates in CI.

## Highest-value simplifications

* Use already-existing API fields (`repoUrl`, `gitRef`, `taskPrompt`, `taskMode`, `publishMode`, `timeoutSeconds`, validation and changed-file allowlist) as the canonical run interface, while retaining CLI compatibility and server-enforced bounds.
* Consolidate CLI API URL aliases and overlapping logger settings after preserving present precedence.
* Align API and worker image configuration while maintaining same-revision execution.
* Separate run preferences from immutable server policy: timeout request is bounded, max diff and mandatory validation remain policy, and caller fields cannot set secrets or webhook origins.
* Reduce direct secret values in favor of mounted secret files/secret stores; preserve evaluation credential isolation from coding inference.
* Remove stale retired settings from current docs only after clear migration mapping; retain explicit retired-name diagnostics during a transition.
* Replace clusters of phase/cache/summarization scalars with small validated component schemas only when operators have a real reason to tune them.

## Main risks

The highest risks are changing precedence for existing Docker deployments, unintentionally weakening server policy through API fields, diverging API and worker image/secret behavior, and deleting a setting still consumed by external scripts. No live deployments or usage telemetry were available. Removal confidence is low for names with unverified external use, and no tests were run as part of this assessment.

## Recommended first implementation batch

P1 documentation/default alignment and a checked-in configuration ownership/precedence matrix. This batch can resolve contradictory defaults and clearly label active, retired, platform-owned, and worker-internal names without changing application behavior. Follow with tests for current precedence, then canonical API request normalization and policy-boundary changes in separate reviewed releases.

See [environment-inventory.md](environment-inventory.md), [environment-scoring.md](environment-scoring.md), and [configuration-rationalisation-plan.md](configuration-rationalisation-plan.md) for evidence and proposed migration details.
