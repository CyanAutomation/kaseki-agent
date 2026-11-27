# Senku integration

Kaseki uses the Senku profile API for approved JEV decisions. Senku owns the profile questions and contract; Kaseki owns its task state, workflow decisions, and user-facing behavior.

## Endpoint and credential

Set the Senku API origin in the target environment's configuration. This guide intentionally contains no live hostname or deployment-specific endpoint.

Provide the Kaseki client credential through the runtime's secret manager or an explicitly configured secret-file location. Do not rely on a repository-specific filesystem path. Keep credential values out of source control, task inputs, logs, and result artifacts. The configured identity must have only the profile permissions required by Kaseki and must remain distinct from other consumer and provider credentials.

Rotate credentials through the environment's managed rotation process. Verify the new credential using synthetic input before retiring the previous value.

## REST contract

Kaseki sends an approved profile identifier and the structured input required by that profile to the Senku evaluate route. It propagates a correlation ID and a bounded caller deadline. The profile definitions and response shapes are derived from the pinned Senku contract artifact.

The client validates the response fields it depends on, including profile identity, answer identities, labels, and score scales. Unknown top-level fields are ignored for additive compatibility. Request and response sizes are bounded before results are accepted.

Kaseki does not send raw task prompts, repository URLs, validation logs, artifacts, generated UI messages, caller-defined questions, model selections, or provider credentials. Senku constructs the profile-specific questions and validates provider output.

## Error mapping

| Senku result | Kaseki category |
| --- | --- |
| Missing credential or unavailable service | unavailable |
| Provider timeout | timeout |
| Provider unavailable | provider failure |
| Provider rate limited | rate limited, preserving only a bounded retry hint |
| Invalid response | invalid response |
| Invalid local configuration | configuration |

## Stage-specific degradation

The workflow preserves its existing admission and recovery boundaries. A transient rate limit may use the bounded retry hint; timeouts and permanent configuration errors do not trigger unbounded retries.

## Telemetry

Record operational metadata such as stage, outcome, duration, correlation ID, and safe error category. Do not log credentials, prompts, evidence, answers, provider diagnostics, or stack traces in user-facing responses.

## Tests and smoke checks

Routine tests use synthetic data and mocked provider responses. Cross-worker checks exercise the contract locally with a mock binding. A live smoke test requires an approved credential and a confirmed provider allowance; do not include environment-specific results in this document.

## Host rollout and obsolete credentials

Configure the API origin, Service Binding or route, and client credential using the target environment's deployment and secret-management systems. Verify health, readiness, and a synthetic decision before routing traffic. Keep hostnames, filesystem layouts, version identifiers, and rollout status in the approved operations system.
