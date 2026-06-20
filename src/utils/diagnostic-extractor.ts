/**
 * Diagnostic Extractor
 *
 * Encapsulates the complex logic for extracting and formatting
 * diagnostic information from validation errors and cache messages.
 */

import * as path from 'path';
import { StatusResponse } from '../kaseki-api-types';

type PhaseDiagnostic = {
  phase: 'goal-setting' | 'scouting' | 'goal-check';
  severity?: string;
  reason?: string;
  field?: string;
  detail?: string;
  suggestion?: string;
  recovered?: boolean;
};

type DependencyCacheDiagnostic = NonNullable<StatusResponse['diagnosticSummary']>['dependencyCache'];

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const DEPENDENCY_CACHE_MESSAGE_PATTERN = /^Dependency cache status:\s*(.+)$/;

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
      ...this.phaseDiagnosticsFromErrors('goal-setting', response.goalSettingValidationErrorsContent),
      ...this.phaseDiagnosticsFromErrors('scouting', response.scoutingValidationErrorsContent),
      ...this.phaseDiagnosticsFromErrors('goal-check', response.goalCheckValidationErrorsContent),
    ];
    const dependencyCache = this.readDependencyCacheDiagnostics(runDir, readSmallArtifact);
    const primaryReason = this.resolvePrimaryDiagnosticReason(response, rawPhaseDiagnostics);
    const phaseDiagnostics = this.filterPhaseDiagnostics(rawPhaseDiagnostics, primaryReason);

    if (!primaryReason && phaseDiagnostics.length === 0 && !dependencyCache) {
      return;
    }

    response.diagnosticSummary = {
      ...(primaryReason ? { primaryReason } : {}),
      ...(response.diagnosticEntryPoint ? { recommendedEntryPoint: response.diagnosticEntryPoint } : {}),
      ...(phaseDiagnostics.length > 0 ? { phaseDiagnostics } : {}),
      ...(dependencyCache ? { dependencyCache } : {}),
    };
  }

  /**
   * Resolve primary diagnostic reason from multiple sources
   */
  private resolvePrimaryDiagnosticReason(
    response: StatusResponse,
    phaseDiagnostics: PhaseDiagnostic[]
  ): string | undefined {
    const failureJson = response.failureJsonContent ?? {};
    const candidates = [
      this.formatProviderError(failureJson),
      response.goalCheckFailureReason,
      response.validationAllowlistFailureReason,
      response.validationFailureReason,
      response.qualityFailureReason,
      typeof failureJson.goal_check_failure_reason === 'string' ? failureJson.goal_check_failure_reason : undefined,
      typeof failureJson.diagnostic_reason === 'string' ? failureJson.diagnostic_reason : undefined,
      typeof failureJson.failed_command === 'string' ? failureJson.failed_command : undefined,
      response.error,
      phaseDiagnostics[0]?.detail,
    ];

    return candidates
      .map((candidate) => typeof candidate === 'string' ? this.cleanDiagnosticText(candidate) : undefined)
      .find((candidate): candidate is string => Boolean(candidate));
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
   * Extract phase diagnostics from validation errors
   */
  private phaseDiagnosticsFromErrors(
    phase: PhaseDiagnostic['phase'],
    errors: Array<Record<string, unknown>> | undefined
  ): PhaseDiagnostic[] {
    if (!errors || errors.length === 0) {
      return [];
    }

    return errors.slice(0, 5).map((error) => {
      const reason = this.stringField(error, 'reason_code') ?? this.stringField(error, 'reason');
      const actual = this.stringField(error, 'actual');
      const expected = this.stringField(error, 'expected');
      const detail = [reason, actual ? `actual: ${actual}` : undefined, expected ? `expected: ${expected}` : undefined]
        .filter(Boolean)
        .join('; ');
      return {
        phase,
        ...(this.stringField(error, 'severity') ? { severity: this.stringField(error, 'severity') } : {}),
        ...(reason ? { reason } : {}),
        ...(this.stringField(error, 'field') ? { field: this.stringField(error, 'field') } : {}),
        ...(detail ? { detail: this.cleanDiagnosticText(detail) } : {}),
        ...(this.stringField(error, 'suggestion') ? { suggestion: this.cleanDiagnosticText(this.stringField(error, 'suggestion') as string) } : {}),
        ...(error.recovered === true || error.recovered === 'true' ? { recovered: true } : {}),
      };
    });
  }

  private filterPhaseDiagnostics(
    phaseDiagnostics: PhaseDiagnostic[],
    primaryReason: string | undefined
  ): PhaseDiagnostic[] {
    if (!primaryReason || !this.isProviderPrimaryReason(primaryReason)) {
      return phaseDiagnostics;
    }

    return phaseDiagnostics.filter((diagnostic) => {
      if (diagnostic.recovered) {
        return false;
      }

      const reason = diagnostic.reason ?? '';
      return ![
        'placeholder_content',
        'patch_fallback',
        'patch_fallback_recovered',
      ].includes(reason);
    });
  }

  private isProviderPrimaryReason(primaryReason: string): boolean {
    return /provider_error|model_unavailable|OpenAI API error|Bad Gateway|gateway/i.test(primaryReason);
  }

  /**
   * Read dependency cache diagnostics from stdout
   */
  private readDependencyCacheDiagnostics(
    runDir: string,
    readSmallArtifact: (filePath: string) => string | null
  ): DependencyCacheDiagnostic | undefined {
    const stdoutPath = path.join(runDir, 'stdout.log');
    const stdout = readSmallArtifact(stdoutPath);
    if (!stdout) {
      return undefined;
    }

    const messages = stdout
      .split(/\r?\n/)
      .map((line) => this.cleanDiagnosticText(line))
      .map((line) => line.match(DEPENDENCY_CACHE_MESSAGE_PATTERN)?.[1])
      .filter((message): message is string => Boolean(message))
      .slice(0, 8);
    if (messages.length === 0) {
      return undefined;
    }

    const validationFailed = messages.some((message) =>
      /failed npm ls validation|failed validation|validation_failed|restored dependency cache failed validation/.test(message)
    );

    return {
      restored: messages.some((message) => message.includes('restoring node_modules')),
      reinstallTriggered: messages.some((message) =>
        /failed npm ls validation|restored dependency cache failed validation|cache miss|running install/.test(message)
      ),
      ...(validationFailed ? { validationFailed } : {}),
      messages,
    };
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
