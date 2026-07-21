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

    const rawPhaseDiagnostics = [
      ...phaseDiagnosticsFromErrors('goal-setting', response.goalSettingValidationErrorsContent, ANSI_ESCAPE_PATTERN),
      ...phaseDiagnosticsFromErrors('scouting', response.scoutingValidationErrorsContent, ANSI_ESCAPE_PATTERN),
      ...phaseDiagnosticsFromErrors('goal-check', response.goalCheckValidationErrorsContent, ANSI_ESCAPE_PATTERN),
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
