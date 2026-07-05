/**
 * Diagnostic Extractor
 *
 * Orchestrates the extraction of diagnostic information from validation errors and cache messages.
 * Delegates specialized extraction logic to helper modules.
 */

import { StatusResponse } from '../kaseki-api-types';
import {
  phaseDiagnosticsFromErrors,
  filterPhaseDiagnostics,
  resolvePrimaryDiagnosticReason,
} from './phase-diagnostic-extractor';
import { readDependencyCacheDiagnostics } from './dependency-cache-diagnostic-extractor';

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export class DiagnosticExtractor {
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
      (val) => this.formatStructuredProviderError(val),
      (failureJson) => this.formatProviderError(failureJson),
      (failureJson) => this.extractTerminalRuntimeError(failureJson),
      (val) => this.cleanDiagnosticText(val)
    );
    const recoveryFailure = this.formatStructuredProviderError(
      response.failureJsonContent?.provider_error_recovery
    );
    const phaseDiagnostics = filterPhaseDiagnostics(rawPhaseDiagnostics, primaryReason);

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

  private formatStructuredProviderError(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const error = value as Record<string, unknown>;
    const message = this.stringField(error, 'message');
    if (!message) return undefined;
    const type = this.stringField(error, 'type') ?? 'provider_error';
    const phase = this.stringField(error, 'phase');
    const provider = this.stringField(error, 'provider');
    const model = this.stringField(error, 'model');
    const context = [phase && `phase: ${phase}`, provider && `provider: ${provider}`, model && `model: ${model}`]
      .filter(Boolean);
    return this.cleanDiagnosticText(`${type}: ${message}${context.length ? ` (${context.join(', ')})` : ''}`);
  }

  private extractTerminalRuntimeError(failureJson: Record<string, unknown>): string | undefined {
    const stderrTail = this.stringField(failureJson, 'stderr_tail');
    if (!stderrTail) return undefined;

    const lines = stderrTail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const runtimeError = lines.find((line) =>
      /^Error(?:\s+\[[A-Z0-9_]+\])?:/.test(line) || /(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)/.test(line)
    );
    const wrapperError = lines.find((line) => /^ERROR:\s+/.test(line));
    const error = runtimeError ?? wrapperError;
    if (!error) return undefined;

    const failedCommand = this.stringField(failureJson, 'failed_command');
    return failedCommand ? `${failedCommand}: ${error}` : error;
  }

  private formatProviderError(failureJson: Record<string, unknown>): string | undefined {
    const message = this.stringField(failureJson, 'provider_error_message');
    if (!message) {
      return undefined;
    }

    const type = this.stringField(failureJson, 'provider_error_type') ?? 'provider_error';
    const phase = this.stringField(failureJson, 'provider_error_phase');
    const model = this.stringField(failureJson, 'provider_error_model');
    const context = [
      phase ? `phase: ${phase}` : undefined,
      model ? `model: ${model}` : undefined,
    ].filter(Boolean);
    return this.cleanDiagnosticText(`${type}: ${message}${context.length ? ` (${context.join(', ')})` : ''}`);
  }

  /**
   * Extract string field from error object
   */
  private stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.trim().length > 0 ? this.cleanDiagnosticText(value) : undefined;
  }

  /**
   * Clean diagnostic text by removing ANSI codes and normalizing whitespace
   */
  private cleanDiagnosticText(value: string): string {
    return value.replace(ANSI_ESCAPE_PATTERN, '').replace(/\s+/g, ' ').trim();
  }
}
