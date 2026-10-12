# Plan for the lowest-value and highest-complexity environment settings

This plan follows the six-dimensional scores in [environment-scoring.md](environment-scoring.md). “Lowest scoring” is interpreted as settings with the weakest demonstrated operational necessity, the least deployment/run/user value, or the highest complexity burden. The dimensions are not summed: a secret or server security boundary can have low user-control value and still must remain environment or server configuration.

This document records the implementation backlog from the audit. A first follow-up pass has since implemented the safe precedence, server-bound, summary-validation, secret-file, and stale-example changes listed in the execution status below. The assessment remains a planning baseline for the higher-risk groups.

## Execution status

| Backlog area | Status |
|---|---|
| Retired JEV/provider names and unused API scopes | Current templates do not expose them as active settings; the retired-name diagnostic remains. Deprecated documentation is retained as a migration map. |
| API URL and log-level aliases | Canonical precedence is implemented and documented; the API URL alias warns without logging its value. |
| Setup secret delivery | Setup writes dedicated owner-only secret files and references the gateway key file from `.env`; the legacy protected `secrets.json` remains for compatibility. |
| Request timeout and diff policy | API caller preferences are bounded by the server configured maximum and are documented/tested. |
| Summary configuration | Integer overrides now reject malformed/out-of-range values to defaults with a warning; the existing component config remains the runtime object. |
| No-op cache toggle and obsolete setup examples | Removed from templates and setup output; persistent cache path remains supported. |
| Model/provider and phase model selectors | Retained. They serve different inference phases; gateway and decision-provider credentials remain isolated. No server allowlist or production usage data supports safely narrowing them yet. |
| API and worker image references | Retained as separate role-specific settings. Worker defaults to the API image, while an explicit worker override remains available for controlled rollout. |
| Host/container path variables and direct/`_FILE` secrets | Retained because each pair describes distinct mount or hosting-platform behavior. File-based secrets are preferred; direct values remain compatibility inputs. |
| Caveman/semantic and typed-evaluation flags | Retained as explicit operating/rollback modes. Removing them would delete real behavior; use evidence and an announced compatibility window before retirement. |
| Cache families | Retained as separate cache policies because each has a different correctness, persistence, or lifecycle boundary. Validation and naming should stay consistent. |
| Pricing scalar variables | JSON catalog is the canonical setting. The four scalar rates remain accepted as a documented, legacy single-model fallback until consumers can migrate. |
| Phase advisory targets | Retained for now. They populate prompt-generation and run-assessment targets; converting them to constants changes tuning behavior and needs operator evidence. |
| API worker empty-diff policy | Scheduler now explicitly sets `KASEKI_ALLOW_EMPTY_DIFF` from the admitted task mode and no-change task contract; a service-level value cannot enable it for ordinary API patch runs. Direct CLI compatibility remains. |
| Provider fallback and API key scope documentation | Fallback names moved out of the supported model table and marked ignored; docs now state API keys have equal access and `KASEKI_API_KEY_SCOPES` is not an authorization control. |

## Goals and guardrails

* Reduce names that are obsolete, aliases, internal transport, or implementation details before considering feature-bearing options.
* Preserve behavior and precedence through migration. Do not remove a variable based only on lack of a local code reference if deployment use is unknown.
* Keep credentials and provider endpoints deployment-owned. Never move secrets into API requests.
* Keep security and quality policy server-enforced: authentication, timeout ceilings, maximum diff, mandatory validation, publish authorization, GitHub credential use, and webhook origin allowlists cannot be weakened by request fields.
* Make one small change set per batch, with an explicit compatibility window and rollback path for MEDIUM/HIGH risk work.

## Ordered backlog

| Order | Variables / family | Evidence from score | Proposed outcome | Priority / migration risk |
|---:|---|---|---|---|
| 1 | Retired `KASEKI_CLASSIFICATION_MODEL`, `KASEKI_JEV_CONFIDENCE`, retired JEV timeout/model/key/task/focus names | Necessity 0; docs mark retired; no live reads found | Remove from current examples and setup guidance; keep a retired-name diagnostic where one exists; publish replacement mapping | P1 / MEDIUM |
| 2 | `KASEKI_PROVIDER_FALLBACK`, `KASEKI_PROVIDER_FALLBACK_MODEL` | Necessity 0; deprecated docs; current coding path does not perform provider fallback | Remove from active templates/docs after verifying supported release notes; explicitly document gateway failure behavior | P1 / MEDIUM |
| 3 | `KASEKI_API_KEY_SCOPES` | Necessity 0; test says it is no longer read; active keys have equal access | Remove from templates/docs; explain current authorization model and require a separate access-control design if scopes are desired | P1 / HIGH |
| 4 | `OPENROUTER_KEY`, `OPENROUTER_KEY_FILE` | Weak evidence of current use; active resolver uses `OPENROUTER_API_KEY*`; external dependency unknown | Search release/deployment assets and ask operators to confirm; retain until confirmed unused, then remove stale references | P2 / HIGH |
| 5 | `KASEKI_CAVEMAN`, `KASEKI_CAVEMAN_LEVEL`, `KASEKI_CAVEMAN_ROUTER` | Low necessity/user value; complexity 4 due overlapping mode switches | Decide whether supported operator modes exist. If not, adopt one default and collapse legacy flags; retain a documented kill switch only during rollout | P2 / MEDIUM |
| 6 | Semantic routing toggles and thresholds: `KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED`, `KASEKI_SEMANTIC_PHASE_TRANSFER_ENABLED`, `KASEKI_SEMANTIC_CONTEXT_REEVALUATION_ENABLED`, thresholds/minimum tokens and router timeout | Necessity 2; complexity 4; feature flags likely include rollout/rollback controls | Measure deployments/use first; group stable thresholds under a small routing policy; retire independent booleans after a rollback window if the modes are no longer supported | P2 / MEDIUM |
| 7 | `KASEKI_TYPED_EVALUATION_ENABLED` | Necessity 3 but complexity 3; switches between two real evaluation implementations | Treat as a temporary rollout flag, not an immediate removal. Establish one supported evaluator only after equivalence, telemetry and rollback criteria are met | P2 / HIGH |
| 8 | `KASEKI_SUMMARY_*` | Necessity 2; complexity 4; an existing loader assembles a structured config from many scalars | Keep operationally useful cache/timeout controls; convert remaining stable thresholds to defaults/constants; consolidate into a small validated summarization config | P2 / LOW-MEDIUM |
| 9 | Model aliases and phase overrides: `KASEKI_MODEL`, `LLM_GATEWAY_MODEL`, `KASEKI_SCOUTING_MODEL`, evaluation model names, `KASEKI_DECISION_MODEL` | Complexity 4; overlap and precedence unclear, but operational value is real | First define supported model routing and allowlists; then converge on one runtime model policy with optional validated phase overrides. Do not remove model flexibility before that decision | P2 / HIGH |
| 10 | `KASEKI_API_URL`, `KASEKI_API_BASE_URL` | Necessity 3; complexity 3; overlapping client endpoint aliases | Pick one canonical CLI key; preserve existing winner (`KASEKI_API_URL`) and support the other as a warning-producing alias for a release | P1 / MEDIUM |
| 11 | `LOG_LEVEL`, `KASEKI_API_LOG_LEVEL` | Necessity 2; complexity 3; overlapping logger controls | Confirm consumers, establish one effective API log level, retain alias precedence temporarily, then remove duplicate | P1 / MEDIUM |
| 12 | `KASEKI_API_IMAGE`, `KASEKI_IMAGE` | Necessity 3; complexity 3; intended same-revision API/worker deployment | Make one image reference authoritative by default; preserve explicit worker override only if operators need split-version deployments. Validate API and worker image compatibility | P2 / MEDIUM-HIGH |
| 13 | Direct secret values and corresponding `_FILE` names | Complexity 2; direct and file delivery overlap; security sensitivity 4 | Prefer mounted secret files or a secret store. Keep direct values only where the hosting platform requires them; document exact precedence and avoid logging. Never delete compatibility paths without deployment review | P2 / HIGH |
| 14 | Duplicate roots and paths (`KASEKI_ROOT`, `KASEKI_WORKSPACE_DIR`, `KASEKI_CHECKOUT_DIR`, `KASEKI_TEMPLATE_DIR`, `KASEKI_APP_ROOT`, `KASEKI_SCRIPT_DIR`) | Complexity 4; some paths are host/container-specific | Map path ownership and mounts, derive children from a configured root only where layouts prove equivalence, retain explicit exceptions for packaged/container roots | P2 / HIGH |
| 15 | Cache families (`KASEKI_ARTIFACT_CACHE_*`, `KASEKI_PREFLIGHT_CACHE_*`, `KASEKI_LIVE_PROGRESS_CACHE_TTL_MS`, `KASEKI_BASELINE_CACHE_*`, `KASEKI_DEPENDENCY_CACHE_*`) | Mostly necessity 2–3, complexity 3; similarly shaped knobs but distinct cache semantics | Normalize names, units and validation; retain independent storage/expiry where correctness differs. Move rarely changed capacities to application config or constants after production evidence | P2 / MEDIUM |
| 16 | `KASEKI_LLM_PRICING_JSON` and scalar `KASEKI_LLM_*_USD_PER_MTOKEN` | Necessity 2; complexity 4; overlapping pricing representations | Establish one validated price catalog as source of truth; preserve “unknown model is unpriced”; migrate and compare outputs before dropping scalar fallback | P2 / MEDIUM |
| 17 | `KASEKI_ALLOW_EMPTY_DIFF` | Necessity 2; user value 1; policy-adjacent escape hatch | Trace all callers and existing task-contract/inspect exceptions; if equivalent coverage is demonstrated, remove the switch and rely on explicit server policy. Otherwise keep narrowly scoped and non-caller-overridable | P2 / HIGH |
| 18 | Phase advisory context/output/turn variables | Low variability and low caller value; complexity arises from many phase-specific scalars | Consolidate to code defaults or a short phase profile. Keep only soft targets with operational evidence; do not send them as provider hard limits or imply they enforce safety | P3 / LOW |

## Batches and completion checks

### Batch 1 — Low-risk contract cleanup (P1)

The API URL and log-level precedence plus stale cache-toggle cleanup are already implemented. The remaining docs-only cleanup is done for provider fallback and API key scopes. Retired JEV mappings and `KASEKI_JEV_WORKFLOW` rejection remain as migration diagnostics. Check README/setup wizard/API/Compose references and packaged docs together before considering this batch fully closed.

**Complete when:** every retired setting points to its replacement or says it is unsupported; no current setup path instructs users to configure an ignored variable; alias precedence is written down; no runtime behavior changed.

### Batch 2 — Evidence gathering and usage confirmation (P1/P2)

Inspect release artifacts, maintained deployment examples and operator-owned manifests for legacy OpenRouter spellings, API scopes, provider fallback, image split, root overrides, typed evaluation and empty-diff behavior. Record evidence per candidate. Do not infer “unused” solely from repository search.

**Complete when:** every candidate has an owner, known deployment consumers, current effective behavior and a removal/retention decision. External uncertainty remains marked unknown, not treated as approval.

### Batch 3 — Small configuration consolidation (P2)

Normalize summary/retry/cache configuration parsing. Use small schemas for components with related validation and lifecycle. Keep distinct caches distinct; unify units, naming and defaults. Emit redacted effective settings to diagnostics only where useful.

**Complete when:** invalid values fail predictably, defaults match docs and Compose, old/new precedence tests pass, and behavior remains equivalent for representative configurations.

### Batch 4 — Run API and policy boundary (P2)

Use the existing API request fields as the canonical run preferences for task mode, publish mode, repository/ref, validation request and timeout. Keep CLI ENV/arguments as compatibility inputs translated into the request. Enforce timeout ceilings, mandatory validation, publication authorization and diff limits on the server after request validation.

**Complete when:** omitted fields preserve current defaults; API and CLI resolve identically; callers cannot raise limits or bypass policy; API/OpenAPI/CLI docs and tests agree. This batch must not silently change precedence.

### Batch 5 — Provider, secret and path ownership (P2)

Decide whether gateway is the sole supported coding provider; define model allowlists and separate decision-stage credentials. Make mounted secret files the preferred delivery, and define host-to-container path mapping. Collapse image configuration only while preserving API/worker revision guarantees.

**Complete when:** credential isolation is tested, no secrets enter request schemas/logs, model resolution is deterministic, image compatibility is checked and legacy settings have a documented release transition.

### Batch 6 — Retire live flags and knobs (P2/P3)

After usage evidence and implementation equivalence, retire temporary typed-evaluation and semantic-routing flags, low-value phase tuning controls, and any now-redundant empty-diff switch. Remove runtime compatibility diagnostics only after the announced deprecation period.

**Complete when:** tests prove supported behavior without the knob, telemetry shows no active dependency where telemetry is available, docs and examples have migrated, rollback is documented, and the release notes identify removed names.

## Compatibility and rollback rules

* No precedence change without a behavior matrix and tests covering old-only, new-only, both-set and omitted cases.
* For MEDIUM/HIGH risk work, deploy a dual-read/canonical-write period where possible; warn on old names without echoing secret values.
* Rollback restores the old resolver and preserves old deployment entries. Do not force operators to rotate credentials or alter API clients during a config-only transition.
* A removal confidence score is evidence, not authorization. In particular, several candidates have scores below 80 because external use and test equivalence are unknown.

## Suggested first batch

The safe part of Batch 1 is implemented. Next, complete Batch 2's deployment evidence matrix before removing any compatibility name. The API empty-diff server-boundary fix is covered by a regression test; do not remove the direct CLI setting until the CLI migration contract is separately established.
