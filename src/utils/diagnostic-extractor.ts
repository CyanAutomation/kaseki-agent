/**
 * Diagnostic Extractor
 *
 * Orchestrates the extraction of diagnostic information from validation errors and cache messages.
 * Delegates specialized extraction logic to helper classes:
 * - ProviderErrorFormatter: Formats structured and legacy provider errors
 * - RuntimeErrorExtractor: Extracts terminal runtime errors from stderr
 */

import { StatusResponse } from '../kaseki-api-types';
import {
  phaseDiagnosticsFromErrors,
  filterPhaseDiagnostics,
  resolvePrimaryDiagnosticReason,
} from './phase-diagnostic-extractor';
import { readDependencyCacheDiagnostics } from './dependency-cache-diagnostic-extractor';
import { ProviderErrorFormatter } from './provider-error-formatter';
import { RuntimeErrorExtractor } from './runtime-error-extractor';

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export class DiagnosticExtractor {
  private providerErrorFormatter: ProviderErrorFormatter;
  private runtimeErrorExtractor: RuntimeErrorExtractor;

  constructor() {
    this.providerErrorFormatter = new ProviderErrorFormatter();
    this.runtimeErrorExtractor = new RuntimeErrorExtractor();
  }

  /**
   * Extract diagnostic summary from response and run directory
   */
  extractDiagnosticSummary(
    response: StatusResponse,
    runDir: string,
    readSmallArtifact: (filePath: string) => string | null
  ): void {
    if (!(response.status === 'completed' || response.status === 'failed')) {
      return;
    }

    const activeErrors = (entries: Array<Record<string, unknown>> | undefined) =>
      entries?.filter((entry) => {
        if (entry.recovered !== true) return true;
        const reason = String(entry.reason_code ?? '');
        // Preserve recovered diagnostics that still describe a real issue, but
        // hide the bookkeeping records for a successfully validated fallback.
        return !(
          typeof entry.recovery_reason_code === 'string' ||
          reason === 'missing_file' ||
          reason.includes('fallback')
        );
      });
    const rawPhaseDiagnostics = [
      ...phaseDiagnosticsFromErrors('goal-setting', activeErrors(response.goalSettingValidationErrorsContent), ANSI_ESCAPE_PATTERN),
      // Recovered fallback attempts are historical context, not current
      // critical diagnostics. Keeping them out of the primary summary avoids
      // contradicting a successful fallback handoff.
      ...phaseDiagnosticsFromErrors('scouting', activeErrors(response.scoutingValidationErrorsContent), ANSI_ESCAPE_PATTERN),
      ...phaseDiagnosticsFromErrors('goal-check', activeErrors(response.goalCheckValidationErrorsContent), ANSI_ESCAPE_PATTERN),
    ];
    const dependencyCache = readDependencyCacheDiagnostics(runDir, readSmallArtifact, ANSI_ESCAPE_PATTERN);
    const primaryReason = resolvePrimaryDiagnosticReason(
      response,
      rawPhaseDiagnostics,
      (val) => this.providerErrorFormatter.formatStructuredProviderError(val),
      (failureJson) => this.providerErrorFormatter.formatProviderError(failureJson),
      (failureJson) => this.runtimeErrorExtractor.extractTerminalRuntimeError(failureJson),
      (val) => this.cleanDiagnosticText(val)
    );
    const terminalPrimaryReason = resolvePrimaryDiagnosticReason(
      response,
      [],
      (val) => this.providerErrorFormatter.formatStructuredProviderError(val),
      (failureJson) => this.providerErrorFormatter.formatProviderError(failureJson),
      (failureJson) => this.runtimeErrorExtractor.extractTerminalRuntimeError(failureJson),
      (val) => this.cleanDiagnosticText(val)
    );
    const recoveryFailure = this.providerErrorFormatter.formatStructuredProviderError(
      response.failureJsonContent?.provider_error_recovery
    );
    const phaseDiagnostics = filterPhaseDiagnostics(rawPhaseDiagnostics, primaryReason, Boolean(terminalPrimaryReason));

    if (!primaryReason && phaseDiagnostics.length === 0 && !dependencyCache) {
      return;
    }

    response.diagnosticSummary = {
      ...(primaryReason ? { primaryReason } : {}),
      ...(recoveryFailure ? { recoveryFailure } : {}),
      ...(response.diagnosticEntryPoint ? { recommendedEntryPoint: response.diagnosticEntryPoint } : {}),
      ...(phaseDiagnostics.length > 0 ? { phaseDiagnostics } : {}),
      ...(dependencyCache ? { dependencyCache } : {}),
    };
  }

  /**
   * Clean diagnostic text by removing ANSI codes and normalizing whitespace
   */
  private cleanDiagnosticText(value: string): string {
    return value.replace(ANSI_ESCAPE_PATTERN, '').replace(/\s+/g, ' ').trim();
  }
}
