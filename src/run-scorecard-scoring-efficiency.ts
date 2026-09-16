import type { Evidence } from './run-scorecard-evidence';
import { ScorecardContext } from './run-scorecard-context';

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function efficiency(actual: number | undefined, target: number): number {
  return actual === undefined ? 50 : clamp(100 * Math.min(1, target / Math.max(1, actual)));
}

/**
 * Computes implementation quality score based on efficiency metrics.
 * Combines elapsed time, model tokens, and retry efficiency with a baseline score.
 */
export function computeImplementationQualityScore(evidence: Evidence): number {
  if (evidence.noChangeAccepted) return 100;
  if (evidence.diffBytes === 0) return 0;

  const config = ScorecardContext.getConfig();
  const modelTokens = evidence.tokenUsage.input_tokens + evidence.tokenUsage.output_tokens;
  const avgEfficiency = (
    efficiency(evidence.elapsedSeconds, config.targets.elapsedSeconds)
    + efficiency(modelTokens || undefined, config.targets.tokens)
    + efficiency(evidence.retries, config.targets.retries)
  ) / 3;

  return clamp(80 + 0.2 * avgEfficiency);
}
