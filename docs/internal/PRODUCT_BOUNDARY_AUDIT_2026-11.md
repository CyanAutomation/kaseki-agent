# Kaseki Agent product boundary audit

**Initial assessment:** 2026-11-12

- Kaseki origin/main: `5557fffcf1daa063624cb5950165ecc4acd05f88`
- Soyuz origin/main: `df74f5937aa34cf93d84b1f24dcb234ae6153a2a`
- Senku origin/main: `92f1ff0c65b1866df791f92fe63040515d74cb29`

**Source refresh:** 2026-11-16

- Kaseki origin/main: `a25e249dfda35388aa5b98e0fb7c8d10137d0ebc`
- Soyuz main: `7ed33efc2d5d57001b7be691e174df7f24de9ab3`
- Senku main: `acf9dce400e971d5d7eb2f7eeac4bcd78c15f7d5`

**Scope:** Current product surface, execution/runtime ownership, API/UI, integration contracts, decision/evaluation code, operator documentation, and repository size indicators.

The original assessment was based on the initial revisions above. The source refresh checked its recommendations against the newer Kaseki, Soyuz, and Senku source and documentation. This follow-up adds an opt-in Kaseki required-submission mode and records focused Kaseki verification below. No live deployment probes or production usage telemetry were available, so no production routing or retention changes were made.

The current source still supports the central boundary recommendation:

- Kaseki's UI explicitly offers **Submit directly to this Kaseki host**. Its `POST /api/v1/runs/local` route forces local scheduling, retains local authentication, validation, task admission, and idempotency, and does not activate automatically after an uncertain Soyuz response. Keep this UI and API path permanently.
- Kaseki now has `SOYUZ_SUBMISSION_MODE=required` for a staged canonical-control-plane rollout. It requires the existing Soyuz submission setting, fails normal create/retry closed instead of silently using the local scheduler, rejects retries of Kaseki-only history, and leaves the explicit local create endpoint available. The default remains compatible with existing deployments until operators opt in.
- Soyuz-routed create requests now validate the request contract at the API, then leave host readiness, publish configuration, template compatibility, and task safety to the Kaseki execution host. Admission rejection becomes a canonical terminal outcome; `/api/v1/validate` remains the synchronous preflight route, and explicit local submission keeps immediate checks.
- Soyuz main owns `POST /v1/runs`, canonical run records, queue admission, cancellation, cross-host history and outcomes. Its authenticated dashboard remains read-only and its shared outcome view covers the newest 30 retained runs; this is not retention parity with Kaseki's local history.
- Senku main exposes five Kaseki profiles and three Soyuz profiles. Its README still marks deployment readiness incomplete until production secrets are configured, so source availability does not establish live service readiness.
- The Kaseki CLI's `--local-direct` option is rejected; its `run` command uses the regular submission route. The requested outage fallback is present in the UI and API, but not as a dedicated CLI selection. Add that only if terminal-based forced-local submission is also required.
- Focused Kaseki verification passed: the Soyuz config, API config, and API route suites passed (156 tests), and TypeScript type-checking passed. No cross-repository source change was required in Senku; its registered Kaseki profiles are already present.

## Implementation follow-through

The repository follow-through now implements the actionable migrations from this audit:

- Task Admission, Goal Check, Run Evaluation, and Validation Recovery use versioned Senku-owned profiles. Kaseki retains evidence extraction, local thresholds, retry authorization, validation requirements, and fail-open/fail-closed behavior.
- Tool-output routing, scouting/context handoff, and Kaseki's synthetic gateway smoke use Senku-owned profiles. Kaseki has no caller-defined question types or generic client method. Senku's public `/v1/decisions` route, permission branch, OpenAPI schema, and generic-only performance smoke were removed; unknown route requests return 404.
- Retired caller-owned JEV settings are rejected through one shared shell primitive, and the source guard prevents reintroducing the direct classifier shim or OpenRouter JEV transport.
- Soyuz already accepts a strict, text-free terminal `outcomeSummary`, exposes aggregate reporting over the newest 30 retained runs, and presents the same bounded window on its authenticated dashboard. No Soyuz code change was needed in this follow-up. The Kaseki local scorecard/history and proxy remain because retention parity and complete caller migration are not established.
- The local direct submission API and UI remain available regardless of Soyuz routing. POST `/api/v1/runs/local` remains an unconditional local scheduler route with its UI choice; the Soyuz dashboard remains read-only with respect to task submission.

The follow-up first added failing regressions for the public generic Senku route and the Kaseki profile smoke. Kaseki `test:unit` then passed (247 suites, 4,536 tests); Senku `npm test` passed (74 tests, OpenAPI validation, and Wrangler config checks), and Senku TypeScript checking passed. The cross-repository worker harness passed against the Senku worktree with a mocked provider. The live Senku and Soyuz services were not changed.

The required-mode and managed-admission changes were added test first: the new Soyuz submission test initially returned `422` because Kaseki ran task safety before remote acceptance, then passed after host checks moved to execution time. Focused Kaseki verification passed (3 suites, 156 tests), along with TypeScript checking, JavaScript lint, Markdown-link checking, and environment-document consistency. No source changes were needed in Soyuz or Senku.

The live Senku deployment was not probed. Before enabling these workflows on production hosts, deploy and verify the five Kaseki profiles and Kaseki identity permissions. Deploy Soyuz's compatible callback/read contract next, then update Kaseki hosts. Soyuz retains only the newest 30 run records, so removal of Kaseki's historical aggregation and normal submission proxy remains gated on retention parity and caller migration. The permanent direct-local form and route are not candidates for removal.

## Recommendation

Keep Kaseki focused on executing one repository task safely on a host, with a local execution API, host-operator CLI, and standalone console. Make Soyuz the primary shared control plane and team run history. Make Senku the owner of typed JEV questions and inference. Keep the console/API's explicit direct-local task path available when Soyuz is down. Remove duplicate control-plane and evaluation surfaces from Kaseki only after their replacements are in production and callers have migrated.

The direct Kaseki submission path is already implemented and should remain a permanent capability:

- The web console has a “Submit directly to this Kaseki host” choice.
- The API provides POST /api/v1/runs/local, which always uses the local scheduler, even when Soyuz routing is enabled.
- The direct route keeps Kaseki authentication, validation, task admission, and idempotency.
- Neither the UI nor API silently changes a request from Soyuz to local execution after an ambiguous timeout. Keep that explicit choice: the two systems cannot deduplicate uncertain acceptance.

Evidence: [Kaseki web console](../../src/kaseki-api-web.ts), [submission routes](../../src/kaseki-api-routes.ts), [API contract](../API.md#trigger-a-run), and [Soyuz integration contract](../SOYUZ_INTEGRATION.md#kaseki-submission-contract).

## Keep in Kaseki

| Element | Recommendation | Reason |
| --- | --- | --- |
| Disposable worker execution | Keep: Docker lifecycle, host capacity, repository checkout, dependency setup, Raspberry Pi support and the Pi adapter, coding inference, validation, patch creation, and GitHub publication. | This is Kaseki’s defining responsibility and requires host, filesystem, Docker, and repository access. Soyuz intentionally does not launch containers or perform host preflight. |
| Deterministic safety and execution policy | Keep: repository destination checks, task admission enforcement, validation requirements, retry limits, publication policy, and local confidence/outcome gates. | Senku answers are advisory. They must never authorize a task, retry, publish, queue transition, or other side effect. |
| Local direct API | Keep POST /api/v1/runs/local and local run list/status/cancel/report/artifact routes. Keep the local health and preflight endpoints. | A Kaseki host must still accept and manage work when the Soyuz control plane is unavailable. Local monitoring and diagnostics are part of making the fallback usable. |
| Direct Kaseki UI and local API | Keep the console's direct-submit choice and `POST /api/v1/runs/local`, plus the CLI paths for API submission and run inspection. Keep console host diagnostics and local run follow-through. The 4,332-line web source is a maintainability concern, but its health, preflight, run selection, status, logs, artifacts, cancel, and retry controls are not evidenced as duplicate product modes. The CLI currently has no forced-local selection (`--local-direct` is rejected), so it is not itself an outage submission path. | Soyuz's dashboard is read-only and has no task submission form. The Kaseki console provides host preflight and local run follow-through for standalone operation. There is no usage or feature-parity evidence that supports removing those local controls. |
| Execution-side Soyuz adapter | Keep Queue intake, claim fencing, callbacks, heartbeat/cancellation handling, durable callback outbox, and the local-to-canonical run mapping. | These are host-side execution responsibilities, not duplicate control-plane responsibilities. Keep the local job record and raw logs/artifacts for recovery and standalone operation. |
| Minimal per-run evidence | Keep bounded local results, diffs, validation results, raw execution logs, and diagnostic artifacts. | Soyuz intentionally receives a small sanitized set of artifacts; it is not a replacement for host-local debugging or recovery. |
| CLI host operations and preflight | Keep only the setup, diagnosis, and secret-management flows needed to operate a Kaseki execution host. | Operators need to recover the worker independently of Soyuz. Avoid adding a second general-purpose deployment manager. |

## Move to Soyuz

| Element | Destination and boundary |
| --- | --- |
| Primary shared run control plane | Soyuz owns cross-host admission, canonical run IDs, request idempotency, lifecycle state, retry/cancel intent, Queue publication/reconciliation, and the searchable event timeline. Kaseki should remain the execution host and callback producer. This is already the documented Soyuz boundary. |
| Team run history and dashboard | Use Soyuz for cross-host run lists, shared status, event summaries, selected artifacts, and user-facing analysis/ratings. Keep Kaseki local run lookup, raw logs, and recovery data for fallback and operator diagnosis. |
| Historical aggregation | Move host-wide or team-wide aggregates from Kaseki’s local job index to Soyuz once the canonical run/event/artifact contract contains the required evidence. This includes the [/improvements aggregation](../../src/routes/improvement-routes.ts) and the historical scorecard listing. Soyuz currently retains only a bounded run history, so retention and data sufficiency need an explicit decision before removing Kaseki history. |
| Submission proxy compatibility | Direct new cross-host clients to Soyuz. Treat Kaseki’s regular POST /api/v1/runs Soyuz proxy as a migration bridge, not a second permanent public control plane. Retire the proxy only after callers have moved. Keep POST /api/v1/runs/local permanently, including its UI entry point. |
| Primary analysis presentation | Soyuz already has an optional read-only run-analysis page that uses bounded run data and Senku. Move shared analysis presentation there; do not send raw task prompts or unbounded logs merely to reproduce Kaseki-local analysis. |

### Scorecard boundary

Do not move the entire Kaseki scorecard package into either companion by name alone. The scorecard implementation currently spans 53 TypeScript files and about 5,156 lines including tests. Split responsibilities:

- Kaseki may continue to emit a compact deterministic per-run evidence artifact for local reports and fallback.
- Soyuz should own shared retention, history, filtering, and team-level views of run outcomes.
- Senku should own the model-based review questions and typed answers.
- Keep scorecards advisory. They cannot bypass required validation or become merge authorization.

Soyuz’s current output-review profiles assess bounded summaries and recorded outcomes; they are not a drop-in replacement for every phase, token, timing, and evidence calculation in Kaseki’s scorecard.

## Move to Senku

| Element | Recommendation |
| --- | --- |
| JEV question definitions and inference | Move question wording, criteria, profile schemas, provider/model selection, and response validation to Senku’s versioned profile API. Senku now has five Kaseki profiles and three Soyuz profiles for operations triage and output review. |
| Goal Check and Run Evaluation | These workflows now use `kaseki_goal_check_v1` and `kaseki_run_evaluation_v1`. Keep Kaseki evidence extraction and local policy evaluation around the response. |
| Provider-specific JEV implementation | Keep JEV provider credentials and model selection in Senku. Kaseki retains a small authenticated client and safe telemetry, not a second JEV provider implementation or per-stage model routing surface. This does not move Kaseki’s coding gateway or unrelated evaluation credentials. |

At the original assessment baseline, several workflows used caller-defined generic questions. They now use server-owned profiles through the authenticated Senku client. The public generic endpoint has been removed; the explicit synthetic gateway smoke now exercises `kaseki_run_evaluation_v1`. Senku still owns the private question/answer contract used internally when it translates an approved profile into provider input.

Senku must remain advisory and stateless. Kaseki keeps deterministic admission, confidence thresholds, retry authorization, validation outcomes, and publication gates. Soyuz keeps canonical run records, user ratings, and dashboard presentation; those do not belong in Senku.

## Remove or retire from Kaseki

1. **Duplicate shared control-plane behavior:** after client migration, retire the Kaseki submission proxy and its remote idempotency bridge. Keep local direct submission and local run APIs.
2. **Duplicate cross-run presentation:** after Soyuz can query the required canonical data, remove the Kaseki /improvements aggregate and any shared-history dashboard views that only cover one host. Preserve per-run local diagnostic routes.
3. **Caller-defined JEV contracts:** removed from Kaseki's public client and Senku's public API. Kaseki retains a small profile-only HTTP adapter and deterministic local policy; Senku retains internal question validation for its registered profiles.
4. **Obsolete configuration and documentation:** continue the existing configuration rationalization work. Remove no-op and retired names from current templates/docs after their compatibility window; collapse overlapping current setup guidance. The existing configuration audit already calls out alias precedence, worker-internal fields, and retired JEV settings. Keep historical reports archived where they remain useful; the archive is not deployed runtime.
5. **Redundant product modes:** remove an execution mode only when it is unused, not needed for a supported host, and covered by a simpler supported path. This review did not find enough usage evidence to recommend deleting Pi support, CLI setup, host diagnostics, webhook delivery, or optional workflow stages outright.

Do not delete tests to reduce reported size. At the source refresh, tracked `src` TypeScript totals 125,636 lines: 62,802 non-test lines and 62,834 test lines. Tests exercise high-risk Docker, task-admission, API, and callback behavior; the volume is not evidence that the tests are redundant. The repository has 167 tracked Markdown files, including 56 under `docs/archive`, so the total overstates the current operator surface.

## Suggested migration order

1. **Lock the boundary:** document the permanent local route and the explicit UI choice; label normal Kaseki submission as Soyuz-routed only when configured. Keep uncertain-submit recovery explicit and idempotent.
2. **Use Soyuz directly:** migrate new cross-host clients and team-facing workflows to Soyuz. Retain the Kaseki proxy for existing callers during a measured compatibility period.
3. **Move JEV callers to profiles:** source migration is complete for Kaseki's five profiles and profile-only decision client. Confirm Senku deployment readiness and permissions before enabling them on production hosts. Keep existing fail-open/fail-closed stage behavior and deterministic safeguards.
4. **Centralize shared history:** Soyuz now accepts a text-free outcome projection and aggregates score, category, assessment, and phase timing over its newest 30 runs. Keep raw logs, local diagnostics, and Kaseki history until retention and evidence parity are established.
5. **Retire duplicate surfaces:** the generic Senku route is removed. Retire the Kaseki proxy and local cross-run aggregate only after caller inventory, retention/data parity checks, and a rollback window.

## Readiness and limitations

- Soyuz already owns canonical run state, queues, callbacks, and a read-only dashboard. Its current README lists the dashboard as read-only, so a Soyuz submission form is not currently available. Keep the Kaseki direct form regardless; do not make the outage path depend on Soyuz UI work.
- Senku has the needed profile code, but its current README says production readiness is incomplete until three secrets are configured and Soyuz Phase 3A integration is still in progress. Do not make the Kaseki decision path depend on an unverified deployment.
- Soyuz retains a bounded history and curated artifacts; Kaseki retains local execution artifacts and raw logs. Moving analytics requires explicit data contracts and retention parity.
- No repository or deployment usage telemetry was available. Removal recommendations are conditional where external callers or host configurations may exist.
- Moving functionality between repositories can shift code and contract maintenance rather than reduce total system complexity. The clearest net reduction comes from removing duplicate control-plane and question-definition paths, not from transferring code unchanged.

## Evidence reviewed

- Kaseki README, API and Soyuz integration docs; task console and route code; decision client and JEV workflow evaluator; scorecard and improvement routes; documentation/configuration audits.
- Soyuz README and architecture/API docs at [7ed33ef](https://github.com/CyanAutomation/soyuz/tree/7ed33efc2d5d57001b7be691e174df7f24de9ab3), especially its [ownership boundary](https://github.com/CyanAutomation/soyuz/blob/7ed33efc2d5d57001b7be691e174df7f24de9ab3/docs/ARCHITECTURE.md) and [API/dashboard overview](https://github.com/CyanAutomation/soyuz/blob/7ed33efc2d5d57001b7be691e174df7f24de9ab3/README.md).
- Senku README and profile contracts at [acf9dce](https://github.com/CyanAutomation/senku/tree/acf9dce400e971d5d7eb2f7eeac4bcd78c15f7d5), especially the [registered profiles](https://github.com/CyanAutomation/senku/blob/acf9dce400e971d5d7eb2f7eeac4bcd78c15f7d5/docs/PROFILES.md) and [deployment readiness](https://github.com/CyanAutomation/senku/blob/acf9dce400e971d5d7eb2f7eeac4bcd78c15f7d5/README.md).
