# Metrics Audit: Usage Verification

**Date**: 2026-09-16  
**Scope**: Verification of all `metricsRegistry` methods in `src/metrics.ts`

## Summary

✅ **All 11 flagged methods are actively used in the codebase.**

No metrics methods are unused. All metrics are properly called during normal job execution and collected by the Prometheus exporter.

---

## Detailed Audit

### Methods Used for Job Lifecycle Tracking

| Method | Used In | Purpose | Status |
| -------- | --------- | --------- | -------- |
| `setQueuePending(count)` | job-scheduler.ts:209,1218,1430,1520 | Track queue size changes | ✅ Active |
| `setRunningJobs(count)` | job-scheduler.ts:676,1200,1431 | Track running job count | ✅ Active |
| `incRunSuccess()` | job-scheduler.ts:1194 | Increment successful run counter | ✅ Active |
| `incRunFailure()` | job-scheduler.ts:1196 | Increment failed run counter | ✅ Active |
| `incTimeout()` | job-scheduler.ts:814 | Track timeout events | ✅ Active |
| `observeRunDuration(seconds)` | job-scheduler.ts:1189 | Record job duration histogram | ✅ Active |

### Methods Used for Quality Metrics

| Method | Used In | Purpose | Status |
| -------- | --------- | --------- | -------- |
| `incGoalCheckFailure(reason)` | job-scheduler.ts:1228 | Track goal-check evaluator failures (partitioned by reason) | ✅ Active |
| `incCriticalChangeFalseNegative()` | job-scheduler.ts:1229 | Track false negatives in critical-change detection | ✅ Active |
| `incScoutingFallback()` | job-scheduler.ts:1231 | Track scouting controller fallbacks | ✅ Active |
| `observeEvaluatorArtifact(available)` | job-scheduler.ts:1226 | Track evaluator artifact availability | ✅ Active |

### Methods Used for Admission Control

| Method | Used In | Purpose | Status |
|--------|---------|---------|--------|
| `incAdmissionRejection(reason)` | kaseki-api-routes.ts:425,431 | Track pre-scheduler admission rejections | ✅ Active |

### Other Methods

| Method | Used In | Purpose | Status |
|--------|---------|---------|--------|
| `configurePersistence(file)` | job-scheduler.ts:147 | Enable metrics persistence across restarts | ✅ Active |
| `renderPrometheus()` | health-routes.ts:108 | Expose metrics in Prometheus format | ✅ Active |

---

## Metrics Rendered to Prometheus

All metrics stored internally are rendered in `renderPrometheus()`:

- ✅ `kaseki_queue_pending` (gauge)
- ✅ `kaseki_running_jobs` (gauge)
- ✅ `kaseki_runs_total` (counter, partitioned by result)
- ✅ `kaseki_run_duration_seconds` (histogram with buckets)
- ✅ `kaseki_timeouts_total` (counter)
- ✅ `kaseki_timeout_rate` (gauge)
- ✅ `kaseki_evaluator_artifacts_total` (counter, partitioned by result)
- ✅ `kaseki_evaluator_artifact_completion_rate` (gauge)
- ✅ `kaseki_goal_check_failures_total` (counter, partitioned by reason)
- ✅ `kaseki_critical_change_false_negatives_total` (counter)
- ✅ `kaseki_scouting_fallbacks_total` (counter)
- ✅ `kaseki_admission_rejections_total` (counter, partitioned by reason)

---

## Recommendation

**Keep all metrics.** No cleanup is needed. All methods directly contribute to observability of:

- Job scheduling and lifecycle
- Quality gate pass/fail rates
- Performance characteristics (latency, timeouts)
- Admission control decisions
- Evaluator and critical-change detection reliability

These metrics are essential for production monitoring and dashboards.
