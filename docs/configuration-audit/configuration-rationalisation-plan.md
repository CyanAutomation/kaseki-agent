# Configuration rationalisation plan

## Implementation follow-up (2026-10-12)

The assessment below remains the architectural recommendation baseline. A first implementation pass has now landed in the working tree: API URL alias precedence is documented with a value-free warning, API log-level precedence is unified, run timeout and diff requests are bounded by server policy, summary integer inputs are validated, setup writes individual owner-only secret files, and the no-op `KASEKI_CACHE_ENABLED` knob was removed from generated examples. Secret mount documentation was aligned with `/run/secrets/kaseki` and the local `~/.kaseki/secrets` fallback. Focused tests were added for these changes.

The remaining high-complexity groups (provider/model routing, image and path ownership, typed-evaluation and semantic-routing flags, cache families, and legacy external aliases) are not deleted in this pass because the audit found no deployment usage telemetry or complete compatibility evidence. The current code must remain the reference for behavior; this plan identifies the next migration decisions rather than claiming those families have already been consolidated.

## 1. Executive summary

Configuration is distributed across shell defaults, direct `process.env` reads, API configuration loading, Docker Compose interpolation, setup wizard output, and documentation. The strongest gains come from clarifying ownership and precedence before deleting names: distinguish deployment policy from run request, collapse aliases, and stop surfacing internal worker protocol fields as user settings. The existing API already accepts several run-varying properties, so those should become the canonical source for repository, task mode, validation request, publish mode, and requested timeout. Secrets, infrastructure endpoints, mounts, authentication, resource ceilings, validation policy, and webhook allowlists remain server/deployment controlled.

No setting should move to API merely to reduce ENV count. The API caller must not be able to weaken auth, server resource limits, required checks, host egress policy, max diff, or GitHub credential policy.

## 2. Current configuration problems

* There is no single configuration ownership map or loader. API config has validated parsers, while extensions, evaluators, shell scripts, and summarization read ambient environment directly.
* Defaults differ by entry point (`KASEKI_API_MAX_CONCURRENT_RUNS` is a salient example); dotenv templates and ENV documentation contain stale/retired entries.
* `KASEKI_API_URL`/`KASEKI_API_BASE_URL`, general/API log level, direct secret/secret-file variants, API/worker image, host/container paths, model overrides, and cache controls create precedence or duplication.
* The worker environment is both configuration transport and internal metadata channel. Scheduler code already projects request values into worker env; that does not make those fields deployment settings.
* Boolean flags include legitimate security/rollout switches and implementation-stage switches. A flag is not redundant solely because it is boolean; its lifecycle and rollback value must be established.
* Some behavior is policy but exposed as a flag (`KASEKI_ALLOW_EMPTY_DIFF`, validation recovery and safe commands). Keep policy in server validation and encode only bounded preferences in requests.
* Docs differ in defaults and describe retired controls; operators may configure values which the current runtime ignores.

## 3. Target configuration architecture

1. **Server policy**: a small validated startup object owns authentication, bind, concurrency, timeout ceiling, maximum diff, mandatory validation/quality rules, egress allowlist, secret references, and publication permissions. These limits are never supplied or raised by a caller.
2. **Deployment config**: validated, nonsecret infrastructure preferences (listener port, mounted root, log level, cache capacity, provider URL, image reference) use one config schema with defaults and explicit override precedence. Keep host/container mount mapping visible rather than hiding it in a generic bag.
3. **Run request**: API `RunRequest` owns repository URL/ref, task prompt, task mode, validation request, changed-file allowlist, publish preference, and requested timeout. Model selection may be introduced only as an allowlisted field after the model-routing decision. All request values are schema-validated and normalized once.
4. **Internal constants**: implementation thresholds, transport-only fields, fixed supported provider IDs, phase implementation details, and nonoperational defaults are constants. Do not create an app config schema for details with no operator use case.
5. **Secret delivery**: secret manager/mounted files are preferred; env contains secret file references only where the deployment platform requires it. Never accept credentials in run requests or forward unrelated process env to workers. Preserve stage-specific OpenRouter isolation.

Effective resolution, without changing current behavior during the audit: `validated server policy` bounds `validated caller preference`; omitted request fields inherit current API default; worker receives normalized effective run values; policy fields are applied after caller normalization and cannot be overridden. Any change to present precedence needs explicit compatibility release notes. For timeout, proposed future formula is `min(request.timeoutSeconds ?? configuredDefault, configuredMaximum)` with positivity checks and documented rejection/clamp behavior chosen before implementation. Do not silently change today's documented behavior.

## 4. ENV to retain

Retain API auth keys and secret-file references, GitHub App material/secret paths, gateway and decision-provider endpoint/credential, optional Soyuz endpoint/credential, listener bind/port, persistent mount roots, image reference, host/container identity mapping when required by Docker, and policy/resource limits that vary by deployment. Retain `KASEKI_WEBHOOK_ALLOWED_ORIGINS` as trusted deployment policy. Prefer a dedicated secret store or mounted read-only files for credentials; do not print their values.

## 5. API parameters to reuse or introduce

Reuse existing request schema fields confirmed in `src/job-scheduler.ts`: `repoUrl`, `gitRef`, `taskPrompt`, `taskMode`, `publishMode`, `timeoutSeconds`, `validationCommands`/`validation.commands`, `changedFilesAllowlist`/`allowlist.include`, and startup-check options where explicitly supported. Resolve duplicate validation/allowlist spellings into one canonical input in a versioned compatibility transition. Do not move maximum timeout, max diff, caller auth, validation-required policy, secret selection, webhook origins, or worker image into the request. A future `model` field requires server allowlisting and a defined default; do not assume arbitrary model IDs are safe.

When API parameters replace CLI ENV inputs, keep CLI syntax and have CLI construct the same request. Existing API deployments that set `KASEKI_TASK_MODE` or `KASEKI_PUBLISH_MODE` use these as defaults only when request fields are omitted; no precedence change without deprecation window. Existing timeout ENV sets server default/ceiling according to documented semantics and must continue to bound caller requests.

## 6. Application configuration

Add or complete a typed loader only for settings with established operational ownership: API rate limits, job index bounds, artifact/cache capacities, log verbosity, provider model routing (pending decision), summary component policy, and GitHub retry policy. Use small nested objects where the fields share a lifecycle (`api.rateLimits`, `cache.artifacts`, `summarization`); avoid a universal `advanced` object that only relocates the same knobs. Validate types, ranges, units, and unknown/retired keys. Publish one effective-config diagnostic with secret values redacted.

## 7. Internal constants

Candidate constants include gateway-only coding provider when confirmed; worker inference metadata field names; phase-specific advisory context/turn/output targets absent operator demand; default cache values; local result transformations; and `KASEKI_ALLOW_EMPTY_DIFF` behavior if current task-mode/contract policy fully covers every supported use. Constants remain unit-testable. Do not constantize real deployment endpoints, path roots, credentials, server resource limits, or required integration controls.

## 8. Consolidation candidates

| Current group | Proposed owner/replacement | Notes |
|---|---|---|
| `KASEKI_API_URL` + `KASEKI_API_BASE_URL` | CLI config `api.baseUrl`, with one canonical ENV and time-limited alias | Current URL takes precedence. Preserve that precedence during deprecation. |
| `LOG_LEVEL` + `KASEKI_API_LOG_LEVEL` | One API logger setting | Confirm other library consumers before removing generic `LOG_LEVEL`. |
| `KASEKI_IMAGE` + `KASEKI_API_IMAGE` | One deployment image by default; optional separate worker image only if use case documented | Maintain API/worker exact-revision guarantee. |
| direct secret values + `_FILE` | Secret reference resolver / mounted file | Transition to file-first; never change secret precedence silently. |
| host and container path variables | Explicit root/mount mapping config | Keep exceptions for container paths that are not derivable from host roots. |
| `KASEKI_MODEL`, gateway model and per-phase models | One validated routing policy with optional allowlisted phase overrides | Requires architectural decision on supported model routing; don't merge simply by name similarity. |
| Caveman level/router and semantic enable flags | One stable routing policy; temporary kill switch retained only for rollout | Remove legacy compatibility branches after adoption evidence. |
| summary size/time/cache variables | `summarization` component config with defaults | Existing loader already maps these settings. |
| validation aliases/explicitness flags | Canonical request validation object plus immutable server validation policy | Preserve API version compatibility; mandatory gates always apply. |
| scalar LLM token pricing + `KASEKI_LLM_PRICING_JSON` | One validated pricing catalog | Unknown models remain unpriced; no fall-through rate attribution. |
| cache-specific bounds | Keep distinct cache namespaces; consolidate field naming/validation, not separate lifetimes | Caches have different correctness and persistence semantics. |

## 9. Removal candidates and confidence

Removal scores and consequence detail are in [environment-scoring.md](environment-scoring.md). Highest-confidence action is documentation cleanup for explicitly retired names, not immediate code removal. `KASEKI_JEV_WORKFLOW` rejection is a migration aid and should remain until rollout. `KASEKI_API_KEY_SCOPES` and `OPENROUTER_KEY*` require operator confirmation because external expectations are unknown. `KASEKI_ALLOW_EMPTY_DIFF` and typed-evaluation switch have live behavior and require tests/usage telemetry before removal. No removal candidate is authorized for implementation by this audit.

## 10. Migration and compatibility strategy

For every MEDIUM/HIGH change, preserve present effective behavior first; add canonical field/config reader; add deprecation warning for old aliases; update API/OpenAPI, CLI help, Compose and setup wizard; add tests for old-only, new-only, both-set precedence, invalid values, omitted defaults, and server-policy boundaries; observe one release; then remove old names in a separately announced release. Roll back by restoring old resolver precedence and retaining both values in deployment config. Never log secrets.

Specific MEDIUM/HIGH contracts:

* **Request fields replacing run ENV** — Existing API fields already take precedence over server task/publish defaults in scheduler. Keep omitted-field defaults and keep CLI mapping. Add schema/OpenAPI/CLI tests and max-timeout/publish-policy tests. Rollback is request projection to previous environment format; no API compatibility break is needed if fields already exist.
* **Timeout policy** — Existing request `timeoutSeconds` and `KASEKI_AGENT_TIMEOUT_SECONDS` both matter. Document current selection from scheduler, introduce explicit configured maximum separately from default, validate positive bounds, test below/equal/above ceiling and omitted value. Roll back resolver while keeping deployment variable.
* **Model/provider routing** — Existing docs claim gateway-only coding inference and separate JEV credential. Define allowlisted model classes, test provider-isolation and fallback behavior, migrate deployment model settings, retain old variables through one compatibility release. Rollback restores current precedence; never route decision credentials into coding worker.
* **Secrets and image aliases** — Existing deployments use Compose `_FILE` mounts and image equality. Preserve direct/file precedence and exact image identity; test secret path resolution and API/worker revision. Rollback is dual-read; never copy secret contents into env or logs.
* **Validation and publication** — Existing request fields can choose validation commands/publish mode, subject to current checks. Add authorization/policy tests proving callers cannot skip mandatory validation, supply secret credentials, widen origin allowlist, or violate repository constraints. Keep old request aliases until API version/deprecation policy allows removal.
* **Retired names** — Existing behavior mostly ignores them or explicitly rejects `KASEKI_JEV_WORKFLOW`; removal could surprise operators. Warn first, inventory real configs, update templates and migration guide, test error message and absence of accidental fallback. Rollback retains alias detection.

## 11. Risks and mitigations

* **Security boundary erosion**: API field accidentally controls resource/security policy. Mitigate by separate policy schema, normalization after validation, and adversarial policy tests.
* **Docker deployment drift**: Compose/setup/service unit disagree. Treat all as one release contract; test generated Compose/config and packaged image paths.
* **Precedence regression**: direct ENV, `.env`, CLI config and request overlap. Document a precedence matrix and test every pair before changing it.
* **Unseen external consumers**: operator scripts may use undocumented names. Keep aliases for a release, emit redacted deprecation notices, and provide migration mapping.
* **Too much abstraction**: a large config object can retain complexity while reducing names. Add only categories with coherent validation/lifecycle.
* **Operational debugging loss**: removing knobs obscures failure diagnosis. Preserve structured effective-config diagnostics with secret/path redaction and stable defaults.

## 12. Prioritized independent implementation batches

1. **P1 / LOW — Documentation and defaults alignment**: reconcile current defaults across `docs/ENV_VARS.md`, `docs/API.md`, Compose, `.env.example`, `.env.template`, setup wizard; label internal worker fields and retired names. No runtime behavior change.
2. **P1 / MEDIUM — Precedence map and config ownership**: document and test current precedence for API/client URL, log level, model, secrets, image, task/publish/timeout. Add tests only when implementation begins; no behavior change in this assessment.
3. **P2 / MEDIUM — Canonical API run request**: normalize existing aliases for validation/allowlist and make CLI construct canonical request. Maintain omitted-field fallback and compatibility alias.
4. **P2 / HIGH — Explicit policy vs preference for timeout, diff, validation and publishing**: establish server caps and tests before changing loaders. Preserve API contract and rollback path.
5. **P2 / HIGH — Provider/model and secret ownership**: decide if gateway is the sole coding provider; consolidate model routing and secret file references while preserving JEV credential isolation.
6. **P2 / MEDIUM — Small config families**: summary, retry, cache and rate-limit schemas; keep only proven operator knobs.
7. **P3 / MEDIUM — Remove obsolete/rollout flags**: only after deployment usage and equivalence are established; remove migration detection last.

## 13. Acceptance criteria for subsequent implementation

* One source-of-truth matrix names each supported deployment setting, request field, default, type, owner, read time, and precedence.
* API and CLI produce identical normalized run preferences; omitted fields preserve behavior.
* Server max timeout, diff bounds, auth, required validation, egress allowlists, and secret isolation cannot be overridden by caller fields.
* Compose, setup wizard, service unit, container worker, package CLI and OpenAPI agree on supported names and defaults.
* Deprecated aliases warn without exposing values; removals follow a documented release window.
* Effective config diagnostics redact credentials and avoid echoing user secrets/task payloads.
* Counts in published documentation define the measured population and distinguish names, supported settings, aliases, process metadata and test-only variables.

## Assumptions and operator confirmation needed

This audit cannot inspect live deployment manifests, hosted secrets, user shell profiles, third-party wrappers or actual usage telemetry. Confirm whether `OPENROUTER_KEY*`, retired JEV aliases, separate API/worker images, custom path overrides, legacy provider settings and `KASEKI_ALLOW_EMPTY_DIFF` are used externally before implementation. These unknowns lower removal confidence; they do not prevent the low-risk docs/precedence work.
