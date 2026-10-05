# Kaseki Agent API Assessment and Implementation Report

**Assessment date:** 2026-10-03  
**Scope:** Express route implementations, both service entry points, OpenAPI generation, API documentation, and in-repository CLI/UI callers. No production traffic or consumer telemetry was available.  
**Implementation:** Recommendations from the source review were implemented on a clean checkout of `origin/main` (`adb830d3`). Breaking route and contract changes were applied directly as authorized.

## Executive summary

The API keeps its core run lifecycle and diagnostics, with a versioned `/api/v1` namespace. The principal changes are in place: unsafe webhook egress is constrained; bearer-key authentication and per-key quotas are enforced; run creation is caller-idempotent; persisted run history is cursor-paginated; artifact downloads return bytes; webhook deliveries are inspectable/retryable; and OpenAPI/docs match the new contract.

Removed routes and aliases are listed below. Root `/health` and `/ready` remain for probes. API consumers should move to `/api/v1` and use the routes in the updated [API guide](API.md).

## Endpoint-by-endpoint decisions

| Endpoint | Decision | Evaluation and implementation |
|---|---|---|
| `GET /health`, `GET /api/v1/health` | Keep | Minimal unauthenticated liveness response; no queue, filesystem, or cache details. |
| `GET /ready`, `GET /api/v1/ready` | Keep | Unauthenticated readiness probe returns stable reason codes, not host paths or exception details. |
| `GET /api/v1/metrics` | Keep; update | Authenticated Prometheus metrics now include bounded route-template request counts and latency summaries alongside existing queue/cache metrics. |
| `GET /api/v1/capabilities` | Keep | Provides API version, supported modes/limits, and event reconnect contract. |
| `GET /api/v1/preflight` | Keep; update | Diagnostic detail remains authenticated. Token-consuming `agentCapability=true` is explicit and rate limited. Public readiness uses `/ready`. |
| `GET /api/v1/startup-health` | Keep | Clearly marked cached boot history; current readiness points to preflight or `/ready`. |
| `GET /api/v1/gateway-test` | Keep; update | Connectivity is the default. Inference, Pi adapter, and evaluation checks require `inference=true` and are rate limited. Errors use Problem Details. |
| `GET /api/v1/runs` | Keep; update | Reads persisted history, supports opaque cursor pagination and status/repository/time filters, and omits internal result paths. |
| `POST /api/v1/runs` | Keep; update | Requires a UUID v4 `Idempotency-Key` header or body field; conflicting copies are rejected. Admission and template/publish checks remain enforced. |
| `GET /api/v1/runs/{id}` | Keep; add | Canonical run resource with lifecycle identity and links to status, events, artifacts, scorecard, and analysis. Resolves persisted history. |
| `GET /api/v1/runs/{id}/status` | Keep; update | Resolves persisted history and omits `resultDir` host paths. |
| `POST /api/v1/runs/{id}/retry` | Keep; update | Reuses submission admission, template readiness, and GitHub publish-credential checks before queueing. |
| `POST /api/v1/runs/{id}/cancel` | Keep; update | Response reports whether cancellation was accepted or the run was already terminal. |
| `POST /api/v1/validate` | Keep | Dry-run validation remains separate from queue submission and has a documented schema. |
| `GET /api/v1/runs/{id}/events` | Keep | Preferred sanitized event snapshot; supports cursor-based recovery. |
| `GET /api/v1/runs/{id}/events/stream` | Keep | SSE for live updates, with documented reconnect behavior. |
| `GET /api/v1/runs/{id}/logs/{logtype}` | Keep; update | Logs are redacted, typed, and bounded; tail returns text content. |
| `GET /api/v1/runs/{id}/analysis` | Keep | Assembled analysis resolves historical runs and avoids exposing result directory paths. |
| `GET /api/v1/runs/{id}/artifacts` | Keep | Artifact discovery remains the way to enumerate available files and metadata. |
| `GET /api/v1/results/{id}/{file}` | Keep; update | Returns raw bytes with content type and attachment headers. Sensitive text is redacted and downloads are capped at 64 MiB. |
| `GET /api/v1/runs/{id}/scorecard` | Keep | Canonical validated scorecard with JSON or Markdown representation. |
| `GET /api/v1/scorecards` | Keep; update | Uses durable history and opaque cursor pagination; returns compact summaries. |
| `GET /api/v1/improvements` | Keep; update | Uses durable cursor-paginated terminal history. Counts and aggregates describe the returned page; `totalRuns` describes all terminal runs. |
| `POST /api/v1/github-issues` | Keep; update | Strict whole-body validation, bounded limits/labels, and normalized errors; privileged lookups are rate limited. |
| `POST /api/v1/webhooks/test` | Keep; update | Uses shared SSRF-resistant egress: HTTPS by default, public DNS/IP validation and connection pinning, no redirects, timeout, and an exact-origin allowlist for trusted private/HTTP receivers. Rate limited. |
| `GET /api/v1/runs/{id}/webhook-deliveries` | Keep; add | Lists durable attempt/status history without exposing webhook secrets. |
| `POST /api/v1/runs/{id}/webhook-deliveries/{deliveryId}/retry` | Keep; add | Requeues only failed deliveries, returns `202`, and is rate limited. |
| `GET /api/v1/usage` | Keep; add | Reports current process usage counters and configured limits for the authenticated key. Cost is `null` because gateway spend is unavailable. |
| `GET /api/v1/openapi.json`, `GET /docs` | Keep; update | OpenAPI and Swagger UI are available from both service entry points; contract tests check the published paths, methods, schemas, and statuses. |

## Routes to remove

These legacy or duplicate routes are removed:

- `GET /api/v1/readiness` and root `GET /readiness`; use `/ready` or `/api/v1/ready`.
- `GET /api/v1/runs/{id}/progress`; use `/events` or `/events/stream`.
- `GET /api/v1/gateway-test/stage1`; use `/gateway-test` for the connectivity-only default, or `?stage=1`.
- Root aliases for API routes other than `/health` and `/ready`.
- The duplicate inline webhook-test registration; one route module now owns the handler and egress policy.

There was no production route-usage data to identify consumers before removal. Consumers of those paths need to migrate.

## Cross-cutting improvements implemented

- Versioned API namespace and regenerated OpenAPI contracts.
- All valid bearer keys have equal route access. Fixed-window per-key limits cover general traffic, diagnostics, GitHub lookups, and webhook test/retry calls.
- RFC 9457-style `application/problem+json` errors with request IDs and `X-Request-ID` response headers.
- Request-template counters/latency metrics with no unbounded labels.
- Durable history lookup and cursor pagination for run, scorecard, and improvement listings.
- Shared webhook egress controls covering both manual tests and automatic background delivery.
- Updated CLI, browser UI, examples, and operator documentation for the changed routes and request contracts.

## Remaining opportunities

1. Replace process-local rate windows and usage counters with a configured shared store before running multiple API replicas. The repository has no shared API-state backend today. Add durable usage retention and actual gateway cost attribution when the provider exposes token cost.
2. Stream large artifact files instead of buffering them up to the 64 MiB limit. Sensitive log and evaluation artifacts currently require whole-content redaction or structured sanitization before sending.
3. Add production access-log monitoring and an announced migration window before future breaking route removals; production traffic was not available during this implementation.
4. Expand end-to-end coverage across both service entry points and deployment proxies; repository tests cannot prove external proxy behavior or live provider egress.

## Validation and limits

Focused Jest coverage, TypeScript checks, and environment-documentation checks cover the changed route, persistence, egress, access-control, pagination, and OpenAPI behavior. No live production API, external consumer, or deployment was available for verification. Rate limits and usage snapshots remain in-process, and reported cost remains unavailable.
