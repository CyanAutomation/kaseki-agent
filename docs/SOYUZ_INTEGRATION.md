# Soyuz host integration

This document describes Kaseki's opt-in Soyuz Queue adapter. Direct Kaseki API and CLI runs remain available. The adapter is disabled by default and is started by the Kaseki API service when `SOYUZ_ENABLED=true`.

## Host configuration

Use a persistent `KASEKI_RESULTS_DIR` volume so the job index and callback outbox survive controller and host restarts. Give each execution host a stable, unique `SOYUZ_WORKER_ID`; do not run two independent Kaseki hosts with the same ID. Keep Kaseki's normal template, Docker, repository, publication, and safety configuration in place.

The jobs index also stores short-lived Soyuz claim intents. Kaseki writes an intent before requesting a claim, then removes it after the local run mapping is durable. If the claim response is lost and the controller restarts, the canonical claim ID can be matched to the saved intent before a local job is created. Keep the existing results volume mounted during controller replacement; losing it removes this recovery proof and the callback outbox.

| Setting | Default | Accepted values / purpose |
| --- | --- | --- |
| `SOYUZ_ENABLED` | `false` | `true` or `false`; turns the adapter on. |
| `SOYUZ_API_URL` | — | Required when enabled; HTTPS URL (HTTP is allowed only for localhost), without a query or fragment. |
| `SOYUZ_WORKER_API_TOKEN` | host secret | Soyuz Worker API bearer token. |
| `CLOUDFLARE_ACCOUNT_ID` | — | 32-character hexadecimal account ID. |
| `CLOUDFLARE_QUEUE_ID` | — | Queue ID returned by Cloudflare. |
| `CLOUDFLARE_QUEUE_API_TOKEN` | host secret | Separate Queue Read+Write API token for HTTP pull and ack/retry. |
| `SOYUZ_WORKER_ID` | — | Stable unique host identifier, 1–200 letters, digits, `_`, `.`, `:`, or `-`. |
| `SOYUZ_POLL_INTERVAL_MS` | `5000` | 250–60000 ms. |
| `SOYUZ_BATCH_SIZE` | `1` | 1–100; adapter further limits pulls to available local capacity. |
| `SOYUZ_VISIBILITY_TIMEOUT_MS` | `120000` | 1000 ms–12 hours. This covers the short handoff, not the coding run. |
| `SOYUZ_REQUEST_TIMEOUT_MS` | `20000` | 1000–120000 ms for each API request. |
| `SOYUZ_CANCELLATION_POLL_INTERVAL_MS` | `15000` | 1000–300000 ms. |
| `SOYUZ_HEARTBEAT_INTERVAL_MS` | `60000` | 10000–900000 ms between active-run heartbeat events. |

The two tokens may be supplied through environment variables or Kaseki's host secret reader. Secret file names are `soyuz_worker_api_token` and `cloudflare_queue_api_token`, searched under `$KASEKI_SECRETS_DIR` (default `/run/secrets/kaseki`) and then `~/.kaseki/secrets`. Never put either value in the job index or logs. Configure the Queue token with Cloudflare Queues read and write permissions only.

Example environment (fill secrets using the host's secret manager):

```sh
SOYUZ_ENABLED=true
SOYUZ_API_URL=https://soyuz.example.workers.dev
CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef
CLOUDFLARE_QUEUE_ID=<queue-id>
SOYUZ_WORKER_ID=kaseki-host-eu-01
SOYUZ_POLL_INTERVAL_MS=5000
SOYUZ_BATCH_SIZE=1
SOYUZ_VISIBILITY_TIMEOUT_MS=120000
```

## Queue setup and poison messages

Create the Cloudflare HTTP pull consumer for the existing Soyuz Queue. Configure a finite retry count and a dead-letter queue (DLQ). If no DLQ is configured, Cloudflare deletes a message after the consumer's `max_retries` limit, so an unsupported contract version or malformed payload could otherwise be discarded. Review and replay DLQ messages only after correcting the host/configuration cause; replaying is safe because Soyuz run IDs are durable deduplication keys.

The adapter retries malformed or unsupported messages with capped exponential delay and never executes them. Queue pull uses `visibility_timeout_ms` and `batch_size`; leases only identify ack/retry operations. They are not stored as run identity. See Cloudflare's current [HTTP pull consumer](https://developers.cloudflare.com/queues/configuration/pull-consumers/) and [dead-letter queue](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/) documentation for retry and DLQ setup.

## Handoff, execution and recovery

The adapter validates contract version 1 and Kaseki's `RunRequestSchema`, checks host readiness, template/publish compatibility, GitHub App credentials when required, and existing task admission, then persists a per-attempt claim intent and claims the canonical Soyuz run. After the claim succeeds, it writes the local job and external run ID mapping to Kaseki's existing jobs index before it sends `started`. Soyuz `started` must succeed, and Kaseki must durably persist that authorization, before the scheduler may launch Docker. The Queue message is acknowledged after this handoff succeeds; the Queue lease is not held for the full execution.

Each claim has a `claimCallbackId` fencing token. The token is saved with the local job and echoed on `started`, progress/heartbeat, and terminal callbacks. Soyuz rejects callbacks from a prior claim even when a host accidentally reuses the same `workerId`. Old contract-v1 hosts may omit the optional field, so they remain readable during rollout but do not receive this fencing protection.

| Failure point | Result and recovery |
| --- | --- |
| Before claim | No local job or Docker process. Retry the lease. |
| Claim accepted, local mapping write fails | No `started` callback and no execution. The pre-claim intent survives a controller restart on the same results volume and lets Kaseki reconcile the accepted claim without creating a speculative job. If that volume is lost, follow the operator recovery procedure; do not force-requeue. |
| Local job persisted, `started` fails | Job stays queued and gated. Retry; the external ID finds that same job. A claim owned by another host is never executed locally. |
| `started` succeeds, Queue ack response is lost | The local mapping and start authorization are durable. Redelivery reuses the mapping and acknowledges without creating another job. Execution may already be underway. |
| Controller restarts with an authorised queued job | Startup closes the local gate, checks canonical Soyuz status, and replays the stable `started` callback before reopening it. A pending cancellation is applied first. |
| Controller restarts with a running job | Existing Kaseki recovery marks it `api_restart`; the durable terminal callback outbox reports this after restart. Kaseki does not automatically rerun it. |
| Terminal callback request fails | The same callback ID and payload stay in the local outbox and retry with bounded exponential backoff plus jitter. |

Queue delivery and callback delivery are at least once. Kaseki deduplicates by Soyuz `runId`; this is not an exactly-once guarantee. Keep the results volume persistent and monitor the callback outbox before allowing it to approach its 5,000-entry intake pause limit.

During execution, the adapter polls canonical run state for cancellation, sends one heartbeat per configured interval, and sends stage changes from Kaseki's sanitized progress events. It sends compact lifecycle metadata only; prompts, raw logs, source files, and artifacts remain on the Kaseki host. A Soyuz cancellation signals the existing Kaseki process and waits for exit before reporting a terminal outcome. If that process exits successfully during the race, Soyuz receives `completed`; if cancellation stops it, Soyuz receives `cancelled`. Direct Kaseki API cancellation keeps its existing behavior.

## Stalled runs and safe recovery

Soyuz records a separate `operationalHealth` classification. After five minutes without a heartbeat, a still-active run becomes `suspect_stalled`; its lifecycle remains `running` or `cancel_requested`, and it is not requeued. A heartbeat restores health to `healthy`. This is deliberately conservative: a missing heartbeat can mean a network partition or a reporting/controller failure while Docker continues to run.

When a run is suspected stalled, inspect the Kaseki host logs, its persisted job mapping, and Docker/container state before retrying anything. Confirm the original execution has stopped and let Kaseki restart recovery send a terminal callback when the persistent host is available. If the host and its state volume are permanently lost, v1 has no safe automatic takeover or fencing workflow; leave the canonical run suspect until an operator verifies the original execution is stopped and applies the separately approved recovery procedure. Do not create a second run just because heartbeats stopped.

### Operator recovery steps

1. Read canonical state with the Worker read token. This does not pull or lease Queue messages:

   ```sh
   curl --fail-with-body --silent --show-error \
     "$SOYUZ_API_URL/v1/worker/runs/$RUN_ID" \
     --header "Authorization: Bearer $SOYUZ_WORKER_API_TOKEN"
   ```

2. Confirm the run's `workerId`, `status`, `claimExpiresAt`, `lastHeartbeatAt`, and `operationalHealth`. A `running` or `cancel_requested` run marked `suspect_stalled` is still owned by its original execution; do not claim or resubmit it.
3. On that host, inspect only the matching local metadata and outbox records. Avoid printing request prompts or secrets:

   ```sh
   jq --arg run "$RUN_ID" '{jobs: [.jobs[]? | select(.soyuz.externalRunId == $run) | {id, status, workerId: .soyuz.workerId, claimCallbackId: .soyuz.claimCallbackId, startAuthorized: .soyuz.startAuthorized}], claimIntents: [.soyuzClaimIntents[]? | select(.externalRunId == $run) | {workerId, claimCallbackId, createdAt}], callbacks: [.soyuzOutbox[]? | select(.externalRunId == $run) | {callbackId, eventType, attemptCount, deliveryState}]}' \
     "$KASEKI_RESULTS_DIR/.kaseki-api-jobs.json"
   ```

4. Inspect Docker on the owner host using the local job ID and container names recorded in Kaseki logs. Confirm whether the process is still active before restarting Kaseki or moving the volume. If active, preserve it and restore connectivity/callback delivery. If exited, restart the controller with the same persistent volume and credentials; the outbox retries the same terminal callback IDs and payloads.
5. If the host is permanently gone, verify its Docker host is unavailable or stop the execution through the normal host procedure, then inspect the repository for an already-created branch/PR before retrying. Keep `publishMode: none` for recovery validation. Any manual state repair or new run for work that could publish needs separate operator approval; do not force-requeue a running run.

Disabling the adapter with `SOYUZ_ENABLED=false` stops new Queue polling. Keep the results volume and let the callback outbox drain before removing its credentials or host; direct Kaseki API/CLI operation is unaffected.

## Monitoring and operator response

Kaseki exposes integration metrics on its existing `/api/v1/metrics` endpoint:

- `soyuz_queue_pull_success_total`, `soyuz_queue_pull_failure_total`
- `soyuz_claim_success_total`, `soyuz_claim_conflict_total`
- `soyuz_runs_started_total`, `soyuz_runs_completed_total`, `soyuz_runs_failed_total`
- `soyuz_callbacks_pending`, `soyuz_callbacks_retry_total`
- `soyuz_execution_handoff_duration_seconds`

Use existing Kaseki log collection and Cloudflare Worker observability to alert on repeated Queue 401/403 responses, sustained pull failures, growing `soyuz_callbacks_pending`, repeated claim conflicts, unsupported contract errors, and `soyuz_run_suspected_stalled`. Logs include run and correlation IDs; metrics intentionally have no run-ID labels. The stalled-run event is emitted once per stale heartbeat timestamp. There is no external paging provider configured by this integration.

Suggested alert rules for an existing Prometheus/log alerting destination:

| Severity | Trigger | Operator action |
| --- | --- | --- |
| Critical | `increase(soyuz_queue_pull_failure_total[5m]) > 5` while Cloudflare Queue backlog is nonzero, or structured logs show repeated Queue 401/403 | Check Queue token expiry/scope and host egress; leave polling enabled only after credentials are corrected. |
| Critical | `min_over_time(soyuz_callbacks_pending[10m]) > 0` with `increase(soyuz_callbacks_retry_total[10m]) > 0` | Restore Soyuz API connectivity; preserve the results volume until the durable outbox drains. |
| Critical | Queue backlog is nonzero and there is no `soyuz_queue_pull_success_total` increase for 5 minutes | Check controller health, adapter config, and host reachability before changing queue consumers. |
| Warning | Cloudflare DLQ backlog increases, `increase(soyuz_claim_conflict_total[10m]) > 3`, or a `run.suspected_stalled` event appears | Review malformed/unsupported messages, host identity collisions, or stalled execution ownership; do not force-requeue. |

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
