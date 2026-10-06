---
name: cost-optimization
description: Cost analysis, budgeting, and optimization strategies for kaseki-agent deployments
tags: [kaseki, cost, budget, optimization, token-usage, roi]
relatedSkills: [prompt-engineering, quality-gate-config, dependency-cache-optimization, performance-tuning, environment-configuration]
---

# Cost Optimization for Kaseki Agent

Use this guide to budget and reduce Kaseki operating costs. Do not quote fixed
per-run prices without checking current provider rates and representative usage.

## Cost components

- **Coding inference:** The configured OpenAI-compatible gateway uses
  `LLM_GATEWAY_URL` and `LLM_GATEWAY_MODEL`. The default model route is
  `dynamic/kaseki-agent`; the actual route and price are controlled by the
  gateway.
- **Optional evaluation:** OpenRouter credentials are used only by configured
  evaluation stages. This is separate from coding inference and is not a
  fallback when the gateway fails.
- **Infrastructure:** Docker host compute, image storage/transfer, run data,
  network traffic, and any paid gateway or registry services.

## Estimate from measured usage

For a model with per-million-token prices, use:

```text
inference cost = (input tokens × input rate + output tokens × output rate) / 1,000,000
```

Record the selected model, input/output tokens, cached tokens, and provider
rates from gateway reports. Track optional OpenRouter evaluation usage
separately. Dynamic routing can change the model and rate, so confirm which
model served the request before calculating costs.

Build a budget from a representative sample of small, medium, and large tasks.
Use provider spending alerts and a monthly run limit; recalculate after changes
to model routing, validation scope, or evaluation stages. Pricing and free
tiers change, so old example tables should not be treated as current quotes.

## Reduce spend using observed bottlenecks

1. **Narrow task scope.** Give the agent a clear goal and relevant paths so it
   spends less time exploring unrelated code.
2. **Review validation work.** Keep tests meaningful and bounded; avoid
   repeatedly running expensive whole-repository checks when a focused check
   provides sufficient feedback.
3. **Use dependency caches.** Preserve the image's npm cache layers and
   workspace dependency cache to reduce repeated install work.
4. **Limit concurrency intentionally.** The Pi Compose default is one active
   run. Increase it only after measuring RAM, CPU, disk, and provider usage.
5. **Disable unused evaluations.** Keep OpenRouter evaluation stages off when
   their analysis does not justify the added token use and data transfer.

For provider variables, evaluation data handling, and performance metrics, see
`docs/ENV_VARS.md` and `docs/PERFORMANCE_TUNING.md`.
