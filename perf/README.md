# Pi event filter benchmark

The 200k-event `pi-event-filter` scenario is intentionally kept outside `src/`
so it is not discovered by the normal Jest unit/integration configuration. Treat
it as an explicit nightly or ad-hoc benchmark check, not as regular CI coverage.

## Required build artifact

Build before running the benchmark:

```sh
npm run build
```

The benchmark launches Node against the compiled artifact at:

```text
dist/pi-event-filter.js
```

If that file is missing or stale, run `npm run build` again before collecting
benchmark data.

## Required environment variables

Run through the package script for the standard setup:

```sh
npm run benchmark:pi-event-filter
```

The script sets `RUN_PI_EVENT_FILTER_PERF=1`, which enables the otherwise skipped
benchmark suite. Equivalent enablement variables accepted by the benchmark are:

- `RUN_PI_EVENT_FILTER_PERF=1` for manual benchmark runs.
- `CI_NIGHTLY=1` for scheduled nightly workers.
- `PERF_TESTS=1` for generic performance-test jobs.

The benchmark process also sets `PI_EVENT_FILTER_TRACK_RSS=1` for the child
`dist/pi-event-filter.js` process so the worker prints `MAX_RSS_BYTES=<bytes>` to
stderr for assertion and trend collection.

## Expected worker memory profile

`pi-event-filter` is expected to stream JSONL without retaining the 200k-event
input in memory. The benchmark asserts the maximum worker RSS reported by the
child process:

- Nightly workers (`CI_NIGHTLY=1`): less than 450 MiB.
- Manual/ad-hoc runs: less than 800 MiB to allow for unknown local host overhead
  while still catching large regressions.

Use the stderr `MAX_RSS_BYTES` value as the benchmark datapoint when tracking
memory drift across nightly runs.
