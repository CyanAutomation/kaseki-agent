Warning: truncated output (original token count: 6179)
Total output lines: 181

# Soyuz host integration

This document describes Kaseki's opt-in Soyuz Queue adapter and API submission path. `SOYUZ_ENABLED=true` starts Queue consumption. `SOYUZ_SUBMISSION_ENABLED=true` routes normal Kaseki API create/retry/cancel operations through Soyuz. These can be enabled independently during rollout. `SOYUZ_SUBMISSION_MODE=required` makes missing submission configuration a startup error and prevents normal create/retry requests from using the local scheduler. The explicit `/api/v1/runs/local` outage path remains available. The current observed deployment state and Phase 2C.2 gates are recorded in the [Soyuz Phase 2C.1 readiness snapshot](https://github.com/CyanAutomation/soyuz/blob/codex/phase-2c1-publication-reliability/docs/PHASE-2C1-READINESS.md); this guide documents source behavior and configuration, not proof that a host feature flag is enabled.

## Host configuration

Use a persistent `KASEKI_RESULTS_DIR` volume so the job index and callback outbox survive controller and host restarts. Give each execution host a stable, unique `SOYUZ_WORKER_ID`; do not run two independent Kaseki hosts with the same ID. Keep Kaseki's normal template, Docker, repository, publication, and safety configuration in place.

The jobs index also stores short-lived Soyuz claim intents. Kaseki writes an intent before requesting a claim, then removes it after the local run mapping is durable. If the claim response is lost and the controller restarts, the canonical claim ID can be matched to the saved intent before a local job is created. Keep the existing results volume mounted during controller replacement; losing it removes this recovery proof and the callback outbox.

| Setting | Default | Accepted values / purpose |
| --- | --- | --- |
| `SOYUZ_ENABLED` | `false` | `true` or `false`; turns the adapter on. |
| `SOYUZ_KIRISAME_PRODUCER_ENABLED` | `false` | `true` or `false`; opt-in claim-bound producer for patch PRs to `CyanAutomation/somatic` on `main`. Requires `SOYUZ_ENABLED=true`. The host pins the base commit, disables Kaseki's direct publisher for that run, and keeps the workspace available for host-side manifest construction. Other destinations keep their legacy route. |
| `SOYUZ_SUBMISSION_ENABLED` | `false` | `true` or `false`; routes Kaseki API run creation and retry through Soyuz. Requires a scoped submission token and worker read token. |
| `SOYUZ_SUBMISSION_MODE` | `optional` | `optional` preserves the current opt-in behavior. `required` requires `SOYUZ_SUBMISSION_ENABLED=true`; normal submissions and canonical retries must use Soyuz. |
| `SOYUZ_API_URL` | — | Required when either feature is enabled; HTTPS URL (HTTP is allowed only for localhost), without a query or fragment. |
| `SOYUZ_SUBMISSION_API_TOKEN` | host secret | Scoped credential for create, retry, and cancel only. Keep distinct from the worker token. |
| `SOYUZ_WORKER_API_TOKEN` | host secret | Soyuz Worker API bearer token used by the adapter and canonical status reads. |
| `CLOUDFLARE_ACCOUNT_ID` | — | 32-character hexadecimal account ID. |
| `CLOUDFLARE_QUEUE_ID` | — | Queue ID returned by Cloudflare. |
| `CLOUDFLARE_QUEUE_API_TOKEN` | host secret | Separate Queue Read+Write API token for HTTP pull and ack/retry. |
| `SOYUZ_WORKER_ID` | — | Stable unique host identifier, 1–200 letters, digits, `_`, `.`, `:`, or `-`. |
| `SOYUZ_POLL_INTERVAL_MS` | `5000` | 250–60000 ms. |
| `SOYUZ_VISIBILITY_TIMEOUT_MS` | `120000` | 1000 ms–12 hours. This covers the short handoff, not the coding run. |
| `SOYUZ_REQUEST_TIMEOUT_MS` | `20000` | 1000–120000 ms for each API request. |
| `SOYUZ_CANCELLATION_POLL_INTERVAL_MS` | `60000` | 1000–300000 ms between periodic canonical status reads for each tracked run; reads are capped at 60/minute per adapter instance and jittered, and cancellation is applied as soon as a read observes it. |
| `SOYUZ_HEARTBEAT_INTERVAL_MS` | `60000` | 10000–900000 ms between active-run heartbeat events. |

Tokens may be supplied through environment variables or Kaseki's host secret reader. Secret file names are `soyuz_submission_api_token`, `soyuz_worker_api_token`, and `cloudflare_queue_api_token`, searched under `$KASEKI_SECRETS_DIR` (default `/run/secrets/kaseki`) and then `~/.kaseki/secrets`. Never put their values in the job index or logs. Configure the Queue token with Cloudflare Queues read and write permissions only.

Example environment (fill secrets using the host's secret manager):

```sh
SOYUZ_ENABLED=true
SOYUZ_SUBMISSION_MODE=optional
SOYUZ_SUBMISSION_ENABLED=true
SOYUZ_API_URL=https://soyuz.example.workers.dev
CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef
CLOUDFLARE_QUEUE_ID=<queue-id>
SOYUZ_WORKER_ID=kaseki-host-eu-01
SOYUZ_POLL_INTERVAL_MS=5000
SOYUZ_VISIBILITY_TIMEOUT_MS=120000
```

Keep the mode `optional` while validating the deployment. Change it to `required` only after caller inventory and a canary pass.

## Kaseki submission contract

Soyuz remains the shared control plane for cross-host run intake and canonical run history. New cross-host integrations should submit to Soyuz directly when it is available. Kaseki's submission proxy remains for existing Kaseki API clients during migration; `/api/v1/runs/local` is the standalone host path.

Each Kaseki agent consumes at most one queue message at a time and pulls one
message only while its run slot is free. Add independent Kaseki agents when
the Soyuz queue needs more concurrent execution capacity.

With submission routing enabled, `POST /api/v1/runs` validates the request contract, persists the caller's idempotency key and request fingerprint, then sends the same UUID as the Soyuz `Idempotency-Key` header and body field. Host readiness, template/publish compatibility, credentials, and task safety are checked by the Kaseki execution host before work starts. If that host rejects an accepted run, Kaseki records a canonical terminal admission failure. Use `POST /api/v1/validate` for synchronous preflight. On a timeout …3179 tokens truncated…ep `publishMode: none` for recovery validation. Any manual state repair or new run for work that could publish needs separate operator approval; do not force-requeue a running run.

A pre-agent validation command such as `tsc -p tsconfig.api.json` exiting with code 127 means the executable was not available to the shell; it is not a TypeScript diagnostic. Check `pre-validation.log`, dependency installation, the project lockfile, and that the repository's `node_modules/.bin` is on `PATH`. Kaseki's command preflight records a missing direct executable explicitly; fix the project or worker toolchain before retrying.

Disabling the adapter with `SOYUZ_ENABLED=false` stops new Queue polling. Keep the results volume and let the callback outbox drain before removing its credentials or host; direct Kaseki API/CLI operation is unaffected.

## Monitoring and operator response

Kaseki exposes integration metrics on its existing `/api/v1/metrics` endpoint:

- `soyuz_queue_pull_success_total`, `soyuz_queue_pull_failure_total`
- `soyuz_claim_success_total`, `soyuz_claim_conflict_total`
- `soyuz_runs_started_total`, `soyuz_runs_completed_total`, `soyuz_runs_failed_total`
- `soyuz_callbacks_pending`, `soyuz_callbacks_oldest_pending_seconds`, `soyuz_callbacks_blocked`, `soyuz_callbacks_retry_total`, `soyuz_callbacks_blocked_total`
- `soyuz_tracked_runs`, `soyuz_canonical_run_read_total`, `soyuz_canonical_read_throttled_total`
- `soyuz_execution_handoff_duration_seconds`

Use existing Kaseki log collection and Cloudflare Worker observability to alert on repeated Queue 401/403 responses, sustained pull failures, growing `soyuz_callbacks_pending`, repeated claim conflicts, unsupported contract errors, `soyuz_run_executor_lost`, and `soyuz_run_suspected_stalled`. Logs include run and correlation IDs; metrics intentionally have no run-ID labels. The stalled-run event is emitted once per stale heartbeat timestamp. There is no external paging provider configured by this integration.

Blocked callback details are available from `GET /api/v1/soyuz/callbacks/blocked`. After resolving the cause, retry a specific callback with `POST /api/v1/soyuz/callbacks/{callbackId}/retry`; the endpoint reuses the persisted payload and only accepts callbacks in the blocked state. Retry traffic has its own per-key hourly limit, configured with `KASEKI_API_SOYUZ_CALLBACK_RETRIES_PER_HOUR` (default 100).

If a locally running Soyuz job no longer has a live executor, Kaseki marks it failed with `failureClass: executor_lost` and sends its terminal callback without continuing canonical status reads. Kaseki restart recovery also terminalizes persisted running jobs before reconciliation.

Suggested alert rules for an existing Prometheus/log alerting destination:

| Severity | Trigger | Operator action |
| --- | --- | --- |
| Critical | `increase(soyuz_queue_pull_failure_total[5m]) > 5` while Cloudflare Queue backlog is nonzero, or structured logs show repeated Queue 401/403 | Check Queue token expiry/scope and host egress; leave polling enabled only after credentials are corrected. |
| Critical | `min_over_time(soyuz_callbacks_pending[10m]) > 0` with `increase(soyuz_callbacks_retry_total[10m]) > 0` | Restore Soyuz API connectivity; preserve the results volume until the durable outbox drains. |
| Warning | `soyuz_callbacks_oldest_pending_seconds > 300` for 5 minutes | Inspect pending and blocked callback details; restore delivery or correct the permanent error before retrying the callback. |
| Critical | Queue backlog is nonzero and there is no `soyuz_queue_pull_success_total` increase for 5 minutes | Check controller health, adapter config, and host reachability before changing queue consumers. |
| Warning | Cloudflare DLQ backlog increases, `increase(soyuz_claim_conflict_total[10m]) > 3`, or a `run.suspected_stalled` event appears | Review malformed/unsupported messages, host identity collisions, or stalled execution ownership; do not force-requeue. |
| Critical | `soyuz_callbacks_blocked > 0` | Inspect the blocked callback details, correct the contract or configuration issue, then retry the callback by ID. |

Wire these rules to the existing alert destination; this integration does not configure an external paging service. Cloudflare's deployed Queue currently needs an operator review for the DLQ setting before unattended consumption.

## Compatibility and rollout

| Kaseki host | Soyuz Worker | Behavior |
| --- | --- | --- |
| Before claim fencing | Before claim fencing | Contract-v1 baseline; stable worker IDs and lease checks only. |
| Before claim fencing | Claim-fenced Worker | Compatible because the new callback field is optional; old hosts do not get stale-callback fencing. |
| Claim-fenced Kaseki | Before claim-fenced Worker | Incompatible: the older strict callback schemas reject the new field. |
| Claim-fenced Kaseki | Claim-fenced Worker | Per-attempt claim fencing is active. Apply required D1 migrations before deploying the Worker. |

Roll out the compatible Worker first, after the D1 migration and production compatibility check, then deploy the Kaseki image containing claim fencing. Confirm the host image digest and restart time from the execution host; a source branch or published image tag alone does not prove the host is running it.

## Controlled smoke test and rollback

Before enabling continuous polling, use a non-production Soyuz Queue and a test repository. Submit one `publishMode: none` run, then verify the run ID in Soyuz, the matching `externalRunId` in Kaseki's persisted job index, one authorized local execution, bounded progress/heartbeat events, and a terminal callback. Repeat with a controlled failure and with a cancellation. Check the DLQ and callback backlog before moving traffic.

To roll back, set `SOYUZ_ENABLED=false` and restart Kaseki. Direct Kaseki API and CLI jobs remain usable. Keep pending outbox records and the persistent results volume until callbacks have been delivered or explicitly resolved.
