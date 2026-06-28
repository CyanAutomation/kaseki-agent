# Stress and nightly tests

This directory contains long-running or resource-sensitive tests that are not part
of routine CI.

## Validation output filter large-output stress

Run explicitly:

```bash
npm run build
RUN_VALIDATION_OUTPUT_STRESS_TESTS=1 bash tests/stress/validation-large-output-stress.test.sh
```

Expected runtime is typically 10-30 seconds on a developer workstation and up to
2 minutes on constrained Raspberry Pi-class hardware. The script exercises real
pipeline backpressure and large-output behavior, so it should remain gated behind
`RUN_VALIDATION_OUTPUT_STRESS_TESTS=1` rather than being added to `test:ci`.
