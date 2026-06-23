/**
 * Gateway Request Normalization Diagnostics
 *
 * Utility to capture diagnostic information about gateway request normalization
 * from the global context (set by .pi-extensions.js during Pi CLI invocation).
 *
 * Emitted by:
 * - recordGatewayDiagnostic() in .pi-extensions.js
 *
 * Captured by:
 * - This module when reading Pi CLI process artifacts
 *
 * Used in:
 * - metadata.json.phases.gateway_diagnostics[]
 * - result-summary.md gateway normalization status
 */

export interface GatewayDiagnosticEvent {
  timestamp: string;
  transport: 'fetch' | 'undici';
  action: 'normalized' | 'passthrough' | 'error';
  details: Record<string, any>;
}

export interface GatewayNormalizationSummary {
  enabled: boolean;
  events: GatewayDiagnosticEvent[];
  normalizationCount: number;
  passthroughCount: number;
  errorCount: number;
  undiciBypassed: boolean;
  recommendation?: string;
}

/**
 * Analyze gateway diagnostic events to determine normalization status
 *
 * @param events - Diagnostic events captured from .pi-extensions.js
 * @returns Summary with recommendations
 */
export function analyzeSomething(
  events: GatewayDiagnosticEvent[],
): GatewayNormalizationSummary {
  const normalized = events.filter(e => e.action === 'normalized').length;
  const passthrough = events.filter(e => e.action === 'passthrough').length;
  const errors = events.filter(e => e.action === 'error').length;

  // If undici was used but fetch wasn't, that indicates undici bypass worked
  const undiciBypassed = events.some(e => e.transport === 'undici') &&
    !events.some(e => e.transport === 'fetch');

  let recommendation: string | undefined;
  if (errors > 0) {
    recommendation = `${errors} normalization error(s) detected. Check Pi CLI logs for details.`;
  } else if (!undiciBypassed && events.length > 0) {
    recommendation = 'Using fetch transport (undici bypass may not have activated).';
  }

  return {
    enabled: events.length > 0,
    events,
    normalizationCount: normalized,
    passthroughCount: passthrough,
    errorCount: errors,
    undiciBypassed,
    recommendation,
  };
}

/**
 * Format gateway diagnostics for human-readable output
 *
 * @param summary - Summary from analyzeSomething()
 * @returns Markdown text
 */
export function formatGatewayDiagnosticsForMarkdown(
  summary: GatewayNormalizationSummary,
): string {
  if (!summary.enabled) {
    return '**Gateway Normalization**: Not active (no diagnostic events captured)';
  }

  const lines = [
    '**Gateway Request Normalization Diagnostics**:',
    `- Events captured: ${summary.events.length}`,
    `- Normalizations: ${summary.normalizationCount}`,
    `- Passthroughs: ${summary.passthroughCount}`,
    `- Errors: ${summary.errorCount}`,
    `- Undici bypass active: ${summary.undiciBypassed ? '✓ Yes' : '✗ No'}`,
  ];

  if (summary.recommendation) {
    lines.push(`- ℹ ${summary.recommendation}`);
  }

  return lines.join('\n');
}
