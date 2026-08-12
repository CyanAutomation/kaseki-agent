import type { EfficiencyPolicy } from './types';

export function renderEfficiencyMarkdown(policy: EfficiencyPolicy): string {
  const selected = Object.entries(policy.selected).sort(([a], [b]) => a.localeCompare(b)).map(([phase, value]) => `| ${phase} | ${value.enabled ? 'enabled' : 'skipped'} | ${value.model ?? 'unchanged'} |`).join('\n');
  return `## Efficiency policy\n\nAggregate key: \`${policy.key}\` (${policy.sampleSize} samples). Explicit operator settings take precedence.\n\n| Phase | Selection | Model |\n|---|---:|---|\n${selected}\n\nCounterfactual per run: ${policy.counterfactual.callsAvoided} calls, ${policy.counterfactual.tokensAvoided} tokens, ${policy.counterfactual.latencyMsAvoided} ms latency, and $${policy.counterfactual.estimatedCostUsdAvoided} estimated cost avoided.\n`;
}
