# Cost Estimation and Budgets

Kaseki does not set a universal per-run price. Coding inference uses the
OpenAI-compatible gateway configured by `LLM_GATEWAY_URL` and
`LLM_GATEWAY_MODEL`; the gateway's routing and pricing determine the charge.
OpenRouter is a separate, optional credential for evaluation stages and is not
the coding-agent fallback provider.

## Cost components

### Coding-agent inference

The model may process repository context, task instructions, code changes,
validation output, and follow-up turns. Estimate costs using the current model
pricing and usage reports from the configured gateway. When the default
`dynamic/kaseki-agent` route selects models dynamically, confirm the selected
model and rate with that gateway before estimating a run.

### Optional evaluation stages

When enabled and configured with an OpenRouter key, evaluation stages may send
task and run artifacts to OpenRouter. Their cost depends on the stages enabled,
payload size, and current model rates. See [ENV_VARS.md](ENV_VARS.md) for the
stages and data handling details. Disable stages you do not need and review
provider data policies before sending proprietary source or task content.

### Host and image costs

For a Raspberry Pi deployment, Docker image transfer and local storage are the
main setup costs. The setup script reports the image's local unpacked size and
Docker shows pull progress. The local image size is not the compressed
registry transfer size; transfer time varies by network and cached layers.
Hardware, electricity, storage, and any remote registry or gateway charges are
provider- and location-specific.

## Build a budget from actual usage

1. Record the selected gateway model and current input/output rates.
2. Run representative tasks and use gateway usage reports to measure input,
   output, and any cached-token charges.
3. Separately record evaluation-stage usage if OpenRouter stages are enabled.
4. Set a monthly run limit and provider spending alerts based on the observed
   workload; repeat the estimate after changing models or validation scope.

Do not treat example prices from old documentation as current quotes. For
optimization methods, see [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) and
[COST_OPTIMIZATION.md](COST_OPTIMIZATION.md).
