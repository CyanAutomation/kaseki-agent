# Decision models in Kaseki

Kaseki owns workflow policy and deterministic execution safeguards. Senku owns
remote JEV decision inference. Pi handles repository exploration, planning,
coding, and synthesis through the configured LLM Gateway.

```text
Kaseki workflow and deterministic policy
  ├─ SenkuDecisionService ── HTTPS POST /v1/decisions ── Senku ── JEV
  └─ Pi coding agent ─────── configured LLM Gateway
```

Kaseki uses Senku's authenticated generic REST endpoint as its only remote JEV
transport. The `DecisionService` interface remains provider-neutral for
workflow callers, but there is no provider-selection setting or local JEV
fallback. Senku selects `~typesafe/jev-latest` and returns the resolved model
identifier. Kaseki never sends a model, provider endpoint, or provider API key.

## Decision call inventory

| Caller | Purpose and input | Time budget | Request/retry behavior | Failure policy |
|---|---|---:|---|---|
| Task Admission | Redacted task request fields; typed credential, permission, security, risk, task-type, and validation-focus answers | 5 seconds by default | One Senku request | Deterministic local credential screening runs first and remains a rejection. Missing or failed classification is degraded fail-open; it does not create a confident low-risk result or routing hint. |
| Goal Check | Bounded run evidence, validated goal criteria, and required implementation evidence | 15 seconds by default | One Senku request | Invalid contracts, required-diff rules, retry ceilings, validation, and publication gates remain deterministic. Unavailable classification is recorded and cannot create success. Any existing explicitly configured Pi evaluation path remains separate from JEV. |
| Run Evaluation | Bounded run metadata, goal-check outcome, diff, validation, and retained evidence | 15 seconds by default | One Senku request | No high score or success is manufactured when classification is missing. Existing score arithmetic and failure artifacts remain authoritative. |
| Validation Recovery | Failed command, exit code, and bounded redacted output | 15 seconds by default | One Senku request | Unavailable classification writes the diagnostic artifact and authorizes no retry. Auto mode still requires an exact allowlisted command, a supported transient cause, a retry recommendation, sufficient non-null confidence, and an unused retry. |
| Caveman tool-output routing | Bounded routing metadata and a redacted goal summary | 1.2 seconds by default | One Senku request | Preserve original tool output, error evidence, and protected information on timeout, missing credentials, or invalid answers. Coding continues. |
| Scouting/context handoff | Compact goal and bounded scouting facts | 1.2 seconds by default | One Senku request | Preserve required, protected, and unclassified facts when Senku is unavailable. |
| Gateway classification smoke | Synthetic bounded sample questions | 15 seconds | One request, only when explicitly requested | It is an inference check and can incur provider usage. Routine health checks do not invoke it. |

Timeout values are per stage and cover the complete HTTP operation, including
response-body reading. Senku requests use `AbortController`; Kaseki does not
retry, switch providers, run shadow inference, or probe Senku before decisions.

## Answer and confidence handling

Answers are typed as NouL probabilities, choices with probability
distributions, or zero-based scores with probability distributions. Choice and
score confidence is `number | null`; null means confidence is unavailable and
is treated as zero for every threshold. NouL confidence is null and its `noul`
probability remains separately validated. Zero is a valid value.

Kaseki validates the request before sending it and validates the full Senku
response. It requires exactly the requested answer keys, validates answer
types and normalized distributions, rejects unsupported schema versions, and
accepts omitted usage while preserving valid reported usage. Requests are
capped at 128 KiB and streamed responses at 64 KiB.

## Security and evidence boundaries

Task prompts, diffs, validation output, and repository evidence are untrusted
data. Kaseki bounds and redacts evidence before evaluation; that redaction is
not a complete secret detector. The Senku bearer token is used only for
decision-service authentication. It is mounted as a read-only file for worker
containers and is not copied into prompts, task metadata, artifacts, or
structured telemetry.

Decision telemetry records the stage, `provider: "senku"`, resolved model,
outcome, confidence summary, duration, one-attempt count, usage when supplied,
safe failure category, and request ID when available. It does not record
prompts, evidence, full HTTP bodies, or credentials.

For endpoint configuration, secret mounting, safe error mapping, testing, and
rollout steps, see [Senku integration](SENKU-INTEGRATION.md).
