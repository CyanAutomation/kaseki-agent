# Senku integration

Kaseki owns workflow and deterministic execution policy. Senku owns remote
decision inference. Kaseki calls Senku's public authenticated REST API over
HTTPS; Cloudflare Service Bindings are only for Worker-to-Worker consumers.

## Endpoint and token

The default endpoint is `https://senku.scheimann.workers.dev`. Set
`SENKU_URL` to a trusted HTTPS origin when using another deployment. The client
uses fixed paths: Task Admission calls
`/v1/profiles/task_admission_v1/evaluate`, Goal Check calls
`/v1/profiles/kaseki_goal_check_v1/evaluate`, Run Evaluation calls
`/v1/profiles/kaseki_run_evaluation_v1/evaluate`, Validation Recovery calls
`/v1/profiles/validation_recovery_v1/evaluate`, and Caveman/tool handoff calls
`/v1/profiles/kaseki_context_routing_v1/evaluate`. It rejects embedded URL credentials,
paths, query strings, fragments, and redirects. Explicit
`http://localhost`, `http://127.x.x.x`, and `http://[::1]` origins are allowed
outside production for local contract tests.

Kaseki authenticates with the Senku Kaseki machine identity:

```http
Authorization: Bearer <SENKU_KASEKI_API_TOKEN>
```

Use the file-based setting where possible. The worker checks
`SENKU_KASEKI_API_TOKEN_FILE`, then `/run/secrets/kaseki/senku_kaseki_api_token`
and `~/.kaseki/secrets/senku_kaseki_api_token`. The inline
`SENKU_KASEKI_API_TOKEN` setting is supported for local/manual use. Tokens
must match Senku's 32–1,024 printable ASCII character format without
whitespace.

For Docker Compose on Raspberry Pi or Debian, place the Kaseki machine token in
the host secret directory mounted as `/run/secrets/kaseki`:

```bash
install -d -m 0700 "$HOME/secrets"
sudo chgrp 10000 "$HOME/secrets"
sudo chmod 0750 "$HOME/secrets"
install -m 0600 /path/to/approved/kaseki-senku-token \
  "$HOME/secrets/senku_kaseki_api_token"
sudo chgrp 10000 "$HOME/secrets/senku_kaseki_api_token"
sudo chmod 0640 "$HOME/secrets/senku_kaseki_api_token"
```

The token must be issued for the existing Kaseki identity by the Senku
operator. Do not use the Senku OpenRouter provider key or a Soyuz token. Kaseki
workers mount their staged copy read-only at
`/run/secrets/kaseki/senku_kaseki_api_token`; the token is not passed as a
process argument, task input, Pi provider credential, or result artifact. For
local CLI runs outside the Docker host setup, use a mode-600 file in
`~/.kaseki/secrets/` instead. Docker Compose runs as GID 10000 and needs the
host file group-readable (`0640`) so the API can stage its own worker copy.

Do not put token values in `.env`, repository configuration, task prompts,
generated prompts, or logs. Missing or unreadable tokens do not block coding
startup; decision stages follow their stage-specific degradation policy.

## REST contract

All workflow decisions use versioned Senku profiles. Callers send bounded input
evidence; Senku owns question wording, criteria, and response schemas. Kaseki
validates the expected profile ID and version, answer IDs and labels, and the
canonical `result` mirror before consuming answers. Task Admission receives
redacted repository/task fields, Goal Check receives bounded run evidence and
success criteria, Run Evaluation receives bounded outcome evidence, Validation
Recovery receives the failed command and bounded output, and Context Routing
receives output metadata or bounded scouting facts. Context Routing never
receives raw tool output, source code, or shell command text. All profile
answers remain advisory.

Only the opt-in API gateway Evaluation smoke check still uses the Kaseki-only
generic endpoint, with a fixed synthetic scenario. Workflow question definitions
are no longer supplied by Kaseki callers:

```http
POST /v1/decisions
Content-Type: application/json
Authorization: Bearer <Kaseki machine token>
```

The request envelope is `{ "schemaVersion": "1", "state": ..., "questions": ... }`.
For example:

```json
{
  "schemaVersion": "1",
  "state": { "status": "failed", "exitCode": 1 },
  "questions": {
    "likely_transient": {
      "type": "noul",
      "instructions": "Does the evidence indicate a transient failure?"
    }
  }
}
```

Question types are `noul`, `choice`, and `score`. Kaseki validates the state,
question identifiers, content tree, and serialized size before sending. The
client sends no `model`, provider endpoint, or provider key. Senku owns question
validation, permission enforcement, JEV selection, and upstream response
validation.

The success envelope includes `schemaVersion`, `requestId`, `status`,
`provider: "jev"`, resolved `model`, exact `answers`, optional `usage`,
`durationMs`, and `attemptCount: 1`. Kaseki maps the local provider identity to
`provider: "senku"` in its `DecisionResult` and telemetry while preserving the
resolved model and reported usage. Missing usage is represented as an empty
object for existing Kaseki callers.

Senku supports nullable confidence for choice and score answers. Kaseki
preserves null and treats it as zero in confidence gates. Probability maps
must contain exactly the expected labels and sum to one within a 0.03
tolerance. Missing, extra, or malformed answers are rejected.

Senku currently bounds request bodies to 128 KiB and provider responses to
64 KiB. Kaseki enforces the same request limit and reads response bodies as a
bounded stream. Each Kaseki evaluation makes at most one Senku HTTP request;
there is no automatic retry or provider failover.

## Error mapping

Kaseki maps Senku errors into a safe allowlist. It retains only a validated
request ID and HTTP status; it never forwards an error body, prompt, token,
provider diagnostic, or stack trace to a user or artifact.

| Senku result | Kaseki category |
|---|---|
| 401 or 403 | `credentials` |
| 400 or 413 | `invalid_request` |
| 502 `INVALID_PROVIDER_RESPONSE` | `invalid_response` |
| 502 `PROVIDER_UNAVAILABLE` | `provider_failure` |
| 503 or other service errors | `service_unavailable` |
| 504 or `PROVIDER_TIMEOUT` | `timeout` |
| Invalid JSON, oversized/malformed response, or redirect | `invalid_response` |
| DNS, connection, or network error | `network` |
| Invalid local URL or retired model/provider setting | `configuration` |

## Stage-specific degradation

| Stage | Behavior when Senku is unavailable |
|---|---|
| Task Admission | Deterministic credential screening still rejects matching content. Otherwise the advisory classification is `degraded` under the existing fail-open policy; uncertain results do not create a risk score or routing hint. |
| Goal Check | Preserve invalid-contract and required-diff rules. Unavailable classification is recorded and cannot produce success. Existing coding retry limits and publication gates remain authoritative. |
| Run Evaluation | Do not turn a missing decision into a success or high score. Preserve deterministic score calculations and failure artifacts. |
| Validation Recovery | Write an unavailable diagnostic artifact and authorize no retry. Do not skip the failed validation or change its result. |
| Caveman routing | Preserve original tool output, error evidence, and protected context. Do not block Pi initialization or coding. |
| Context handoff | Preserve required, protected, and unclassified scouting facts. Uncertainty never authorizes dropping information. |

## Telemetry

`decisions.jsonl` records stage, provider, resolved model, outcome, confidence
summary, duration, attempt count, usage when available, safe error category,
and request ID when available. It excludes task prompts, decision state,
tool output, raw HTTP bodies, and credentials. Task Admission runs before a
result directory exists, so its degraded status and safe warning are returned
through the admission result.

## Tests and smoke checks

The unit tests use synthetic credentials and mocked responses. They do not
contact production Senku or OpenRouter. With Kaseki dependencies installed,
run the focused transport tests with:

```bash
npm exec jest -- --runInBand src/decision-service/senku-client.test.ts
```

The cross-repository contract test uses Senku's actual `createWorker`
implementation with a local HTTP harness and a mocked upstream provider. Set
`SENKU_REPO_PATH` to a local checkout of Senku `main`, install dependencies in
both repositories, and use Node.js 26 (Senku's supported runtime) before
running:

```bash
SENKU_REPO_PATH=/path/to/senku npm run test:senku-contract
```

This exercises profile authentication, input and response validation, and
Senku's safe error envelopes without a paid inference call. The opt-in gateway
smoke separately covers the narrow generic-decision contract.
The provider fetch is mocked and the test asserts exactly one upstream
attempt. The script exits with a setup error if the checkout or Node.js 26 is
unavailable; the transport unit tests remain independently runnable.

The gateway classification smoke is opt-in (`?evaluation=true`) and does make
a real Senku decision request. Use it only after the token and network
configuration are installed and when provider usage is acceptable. Routine
health checks do not call Senku. Do not use production inference to test
connectivity, and do not deploy changes as part of this implementation.

## Host rollout and obsolete credentials

Before a controlled rollout, install the approved Kaseki Senku machine token
on each host as `senku_kaseki_api_token`, confirm the secret directory is
mounted read-only, and set `SENKU_URL` only if the default origin is not used.
The smoke can verify the narrow generic gateway-probe contract. Before
enabling migrated workflows on a host, confirm the deployed Senku Worker
exposes all five Kaseki profiles and grants the Kaseki identity access to them.
The profile implementations and permission changes require a Senku deployment;
do not assume a live service has them until its deployment is verified. Roll
out Senku's profile contracts first, Soyuz's optional outcome-summary callback
and read routes second, then Kaseki hosts that call the new profiles and send
the summary. This order keeps strict version-1 callback validators compatible
through the rollout.

Kaseki no longer reads `OPENROUTER_API_KEY` or `OPENROUTER_API_KEY_FILE` for
decision inference. Existing host OpenRouter files are left untouched; remove
them only through the host's normal credential-management process after
confirming no unrelated coding integration uses them. The LLM Gateway key
remains separate and continues to power Pi coding inference.

Goal Check, Run Evaluation, Task Admission, Validation Recovery, context
routing, and scouting handoff now use versioned, Senku-owned profiles. The
generic endpoint remains only for the explicit synthetic gateway Evaluation
smoke. Kaseki keeps evidence extraction, confidence thresholds, retry
authorization, and execution safety in local deterministic policy.
