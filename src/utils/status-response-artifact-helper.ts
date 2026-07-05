/**
 * Artifact handling and diagnostic file management for StatusResponseBuilder
 */

import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import type { StatusResponse, DiagnosticEntryPoint } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { getRunArtifactMetadata } from '../run-artifact-metadata-cache';
import { ArtifactContentLoader } from './artifact-content-loader';
import { TaskProgressCalculator } from './task-progress-calculator';
import { DiagnosticExtractor } from './diagnostic-extractor';

const STATUS_KEY_FILES = ['metadata.json', 'analysis.md', 'result-summary.md', 'failure.json', 'stderr.log', 'stdout.log'] as const;
const PRE_VALIDATION_DIAGNOSTIC_FILES = ['pre-validation.log', 'test-baseline-comparison.json'] as const;
const GOAL_CHECK_DIAGNOSTIC_FILES = [
  'goal-check-validation-errors.jsonl',
  'goal-check-stderr.log',
  'goal-check.json',
  'goal-check-attempts.jsonl',
] as const;
const PI_AGENT_DIAGNOSTIC_FILES = [
  '.gateway-diagnostics.jsonl',
  'pi-agent-diagnostics.jsonl',
  'pi-events.jsonl',
  'pi-summary.json',
] as const;
const GOAL_SETTING_DIAGNOSTIC_FILES = [
  'goal-setting-validation-errors.jsonl',
  'goal-setting-stderr.log',
  'goal-setting.json',
  'progress-stream-diagnostics.log',
] as const;
const SCOUTING_DIAGNOSTIC_FILES = [
  'scouting-validation-errors.jsonl',
  'scouting-stderr.log',
  'scouting.json',
  'prompt-diagnostics.jsonl',
] as const;

const INLINE_ARTIFACT_LIMIT_BYTES = 65536;
const GOAL_CHECK_ARTIFACT_INVALID_REASON = 'goal_check_artifact_invalid';

export class StatusArtifactHelper {
  constructor(
    private config: KasekiApiConfig,
    private taskProgressCalculator: TaskProgressCalculator,
    private diagnosticExtractor: DiagnosticExtractor,
    private artifactContentLoader: ArtifactContentLoader,
    private readSmallTerminalArtifact: (filePath: string) => string | null,
    private readMetadata: (runDir: string) => any,
    private progressHighWater: Map<string, number>,
    private stringField: (record: Record<string, unknown>, key: string) => string | undefined,
    private isRecord: (value: unknown) => value is Record<string, unknown>
  ) {}

  addArtifactInfo(response: StatusResponse, job: Job): void {
    if (!(job.status === 'completed' || job.status === 'failed')) {
      return;
    }

    const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
    const metadata = this.readMetadata(runDir);

    const diagnosticInclusionFlags = this.deriveDiagnosticInclusionFlags(job, response, metadata, runDir);
    const artifactFiles = this.buildArtifactFileList(diagnosticInclusionFlags);
    const artifactMetadata = getRunArtifactMetadata(job.id, runDir, artifactFiles, true);
    const isAvailable = (fileName: string): boolean =>
      artifactMetadata[fileName]?.exists === true && artifactMetadata[fileName].size > 0;
    const isSmallAvailable = (fileName: string): boolean =>
      isAvailable(fileName) && artifactMetadata[fileName].size <= INLINE_ARTIFACT_LIMIT_BYTES;

    this.populateArtifactAvailability(response, artifactFiles, isAvailable);

    if (job.status === 'completed' || job.status === 'failed') {
      this.inlineSmallArtifacts(response, job, runDir, diagnosticInclusionFlags, isSmallAvailable);
    }

    if (job.status === 'failed') {
      this.setDiagnosticEntryPoint(response, diagnosticInclusionFlags, isAvailable);
    }
  }

  addTaskProgressInfo(response: StatusResponse, job: Job): void {
    if (job.status === 'completed') {
      response.taskProgressPercent = 100;
      this.progressHighWater.delete(job.id);
      return;
    }
    const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
    const metadata = this.readMetadata(runDir);
    const calculated = this.taskProgressCalculator.calculateProgressPercent(response, job, runDir, metadata);
    if (typeof calculated !== 'number') {
      return;
    }

    const previous = this.progressHighWater.get(job.id) ?? 0;
    response.taskProgressPercent = Math.max(previous, calculated);
    if (job.status === 'running') {
      this.progressHighWater.set(job.id, response.taskProgressPercent);
    } else {
      this.progressHighWater.delete(job.id);
    }
  }

  addDiagnosticSummary(response: StatusResponse, job: Job): void {
    const runDir = job.resultDir || path.join(this.config.resultsDir, job.id);
    this.diagnosticExtractor.extractDiagnosticSummary(response, runDir, (filePath: string) => this.readSmallTerminalArtifact(filePath));
    if (job.status === 'failed') {
      this.addTestFailureSummary(response, runDir);
    }
  }

  private deriveDiagnosticInclusionFlags(
    job: Job,
    response: StatusResponse,
    metadata: any,
    runDir: string
  ): {
    includePiAgent: boolean;
    includePreValidation: boolean;
    includeGoalSetting: boolean;
    includeScouting: boolean;
    includeGoalCheck: boolean;
  } {
    return {
      includePiAgent: job.status === 'failed' && this.shouldIncludePiAgentDiagnostics(metadata, runDir),
      includePreValidation: job.status === 'failed' && this.shouldIncludePreValidationDiagnostics(metadata, runDir),
      includeGoalSetting:
        job.status === 'failed' &&
        this.shouldIncludePhaseDiagnostics(metadata, 'goal-setting', GOAL_SETTING_DIAGNOSTIC_FILES, runDir),
      includeScouting:
        job.status === 'failed' &&
        this.shouldIncludePhaseDiagnostics(metadata, 'scouting', SCOUTING_DIAGNOSTIC_FILES, runDir),
      includeGoalCheck: job.status === 'failed' && response.goalCheckFailureReason === GOAL_CHECK_ARTIFACT_INVALID_REASON,
    };
  }

  private buildArtifactFileList(flags: {
    includePiAgent: boolean;
    includePreValidation: boolean;
    includeGoalSetting: boolean;
    includeScouting: boolean;
    includeGoalCheck: boolean;
  }): string[] {
    return [
      ...STATUS_KEY_FILES,
      ...(flags.includePiAgent ? PI_AGENT_DIAGNOSTIC_FILES : []),
      ...(flags.includePreValidation ? PRE_VALIDATION_DIAGNOSTIC_FILES : []),
      ...(flags.includeGoalSetting ? GOAL_SETTING_DIAGNOSTIC_FILES : []),
      ...(flags.includeScouting ? SCOUTING_DIAGNOSTIC_FILES : []),
      ...(flags.includeGoalCheck ? GOAL_CHECK_DIAGNOSTIC_FILES : []),
    ];
  }

  private populateArtifactAvailability(
    response: StatusResponse,
    artifactFiles: string[],
    isAvailable: (fileName: string) => boolean
  ): void {
    const keyFileAvailability = STATUS_KEY_FILES.reduce(
      (acc, fileName) => {
        acc[fileName] = isAvailable(fileName);
        return acc;
      },
      {} as Record<(typeof STATUS_KEY_FILES)[number], boolean>
    );
    const diagnosticFiles = [
      ...PI_AGENT_DIAGNOSTIC_FILES,
      ...GOAL_SETTING_DIAGNOSTIC_FILES,
      ...SCOUTING_DIAGNOSTIC_FILES,
      ...PRE_VALIDATION_DIAGNOSTIC_FILES,
      ...GOAL_CHECK_DIAGNOSTIC_FILES,
    ].filter((fileName) => isAvailable(fileName));

    response.artifacts = {
      metadataJson: keyFileAvailability['metadata.json'],
      analysisMd: keyFileAvailability['analysis.md'],
      resultSummaryMd: keyFileAvailability['result-summary.md'],
      failureJson: keyFileAvailability['failure.json'],
      stderrLog: keyFileAvailability['stderr.log'],
      stdoutLog: keyFileAvailability['stdout.log'],
      availableFiles: artifactFiles.filter((fileName) => isAvailable(fileName)),
      ...(diagnosticFiles.length > 0 ? { diagnosticFiles } : {}),
    };
  }

  private inlineSmallArtifacts(
    response: StatusResponse,
    job: Job,
    runDir: string,
    flags: { includePiAgent: boolean; includePreValidation: boolean; includeGoalSetting: boolean; includeScouting: boolean; includeGoalCheck: boolean },
    isSmallAvailable: (fileName: string) => boolean
  ): void {
    try {
      this.inlineResultSummary(response, runDir);
      if (job.status === 'failed') {
        this.inlineFailureContent(response, runDir);
        this.inlinePhaseValidationErrors(response, runDir, flags, isSmallAvailable);
      }
    } catch {
      // Silently skip inlining if any error occurs
    }
  }

  private inlineResultSummary(response: StatusResponse, runDir: string): void {
    const summaryPath = path.join(runDir, 'result-summary.md');
    const summaryContent = this.readSmallTerminalArtifact(summaryPath);
    if (summaryContent && summaryContent.length <= INLINE_ARTIFACT_LIMIT_BYTES) {
      response.resultSummaryContent = summaryContent;
    }
  }

  private inlineFailureContent(response: StatusResponse, runDir: string): void {
    const failurePath = path.join(runDir, 'failure.json');
    const failureContent = this.readSmallTerminalArtifact(failurePath);
    if (failureContent && failureContent.length <= INLINE_ARTIFACT_LIMIT_BYTES) {
      try {
        response.failureJsonContent = JSON.parse(failureContent);
      } catch {
        // If JSON parse fails, skip inlining
      }
    }
  }

  private inlinePhaseValidationErrors(
    response: StatusResponse,
    runDir: string,
    flags: { includePiAgent: boolean; includePreValidation: boolean; includeGoalSetting: boolean; includeScouting: boolean; includeGoalCheck: boolean },
    isSmallAvailable: (fileName: string) => boolean
  ): void {
    if (flags.includeGoalSetting) {
      this.artifactContentLoader.addValidationErrorsContent(
        response,
        runDir,
        'goal-setting-validation-errors.jsonl',
        'goalSetting',
        isSmallAvailable
      );
    }
    if (flags.includeScouting) {
      this.artifactContentLoader.addValidationErrorsContent(
        response,
        runDir,
        'scouting-validation-errors.jsonl',
        'scouting',
        isSmallAvailable
      );
    }
    if (flags.includeGoalCheck) {
      this.artifactContentLoader.addValidationErrorsContent(
        response,
        runDir,
        'goal-check-validation-errors.jsonl',
        'goalCheck',
        isSmallAvailable
      );
    }
  }

  private setDiagnosticEntryPoint(
    response: StatusResponse,
    flags: { includePiAgent: boolean; includePreValidation: boolean; includeGoalSetting: boolean; includeScouting: boolean; includeGoalCheck: boolean },
    isAvailable: (fileName: string) => boolean
  ): void {
    const phaseDiagnosticEntryPoints: DiagnosticEntryPoint[] = [
      ...(flags.includePiAgent
        ? (['.gateway-diagnostics.jsonl', 'gateway-summary.json', 'pi-agent-diagnostics.jsonl', 'pi-events.jsonl', 'pi-summary.json'] as DiagnosticEntryPoint[])
        : []),
      ...(flags.includePreValidation
        ? (['test-baseline-comparison.json', 'pre-validation.log'] as DiagnosticEntryPoint[])
        : []),
      ...(flags.includeGoalSetting
        ? (['goal-setting-validation-errors.jsonl', 'goal-setting-stderr.log'] as DiagnosticEntryPoint[])
        : []),
      ...(flags.includeScouting
        ? (['scouting-validation-errors.jsonl', 'scouting-stderr.log'] as DiagnosticEntryPoint[])
        : []),
      ...(flags.includeGoalCheck
        ? (['goal-check-validation-errors.jsonl', 'goal-check-stderr.log'] as DiagnosticEntryPoint[])
        : []),
    ];
    const diagnosticEntryPointCandidates: DiagnosticEntryPoint[] = [
      ...phaseDiagnosticEntryPoints,
      'failure.json',
      'analysis.md',
      'result-summary.md',
      'stderr.log',
      'stdout.log',
    ];

    response.diagnosticEntryPoint = diagnosticEntryPointCandidates.find((fileName) => isAvailable(fileName));
  }

  private shouldIncludePiAgentDiagnostics(metadata: any, runDir: string): boolean {
    const providerErrorType = String(metadata?.provider_error_type ?? '');
    const failedCommand = String(metadata?.failed_command ?? '');
    return (
      providerErrorType === 'provider_error' ||
      providerErrorType === 'model_unavailable' ||
      providerErrorType === 'provider_empty_assistant_turn' ||
      failedCommand.includes('pi provider empty assistant turn') ||
      failedCommand.includes('pi provider error') ||
      PI_AGENT_DIAGNOSTIC_FILES.some((fileName) => fs.existsSync(path.join(runDir, fileName)))
    );
  }

  private shouldIncludePreValidationDiagnostics(metadata: any, runDir: string): boolean {
    const failedCommand = String(metadata?.failed_command ?? '');
    const preValidationExitCode = Number(metadata?.pre_validation_exit_code ?? 0);
    return (
      failedCommand.includes('pre-agent validation') ||
      preValidationExitCode !== 0 ||
      PRE_VALIDATION_DIAGNOSTIC_FILES.some((fileName) => fs.existsSync(path.join(runDir, fileName)))
    );
  }

  private shouldIncludePhaseDiagnostics(
    metadata: any,
    phase: 'goal-setting' | 'scouting',
    files: readonly string[],
    runDir: string
  ): boolean {
    const failedCommand = String(metadata?.failed_command ?? '');
    if (failedCommand.includes(`pi ${phase} agent`)) {
      return true;
    }
    const phaseExitCode = metadata?.[phase === 'goal-setting' ? 'goal_setting_exit_code' : 'scouting_exit_code'];
    if (Number(phaseExitCode) === 86) {
      return true;
    }
    if (phase === 'scouting') {
      return this.hasUnrecoveredCriticalScoutingDiagnostics(runDir);
    }
    return files.some((fileName) => fs.existsSync(path.join(runDir, fileName)));
  }

  private hasUnrecoveredCriticalScoutingDiagnostics(runDir: string): boolean {
    const validationErrorsContent = this.readSmallTerminalArtifact(path.join(runDir, 'scouting-validation-errors.jsonl'));
    if (!validationErrorsContent || validationErrorsContent.length > INLINE_ARTIFACT_LIMIT_BYTES) {
      return false;
    }

    const errors = this.parseValidationErrorsJsonl(validationErrorsContent);
    if (errors.length === 0) {
      return false;
    }

    const hasRecoveryMarker = errors.some((error) => this.isScoutingRecoveredDiagnostic(error));
    return errors.some((error) => this.isUnrecoveredCriticalScoutingDiagnostic(error, hasRecoveryMarker));
  }

  private parseValidationErrorsJsonl(content: string): Array<Record<string, unknown>> {
    try {
      return content
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown)
        .filter(this.isRecord);
    } catch {
      return [];
    }
  }

  private isScoutingRecoveryDiagnostic(error: Record<string, unknown>): boolean {
    const reason = this.stringField(error, 'reason_code') ?? this.stringField(error, 'reason');
    if (!reason) {
      return false;
    }
    return reason === 'patch_fallback'
      || reason === 'inspect_fallback'
      || this.isRecoveredReason(reason);
  }

  private isScoutingRecoveredDiagnostic(error: Record<string, unknown>): boolean {
    const reason = this.stringField(error, 'reason_code') ?? this.stringField(error, 'reason');
    return reason ? this.isRecoveredReason(reason) : false;
  }

  private isRecoveredReason(reason: string): boolean {
    return reason === 'patch_fallback_recovered'
      || reason === 'inspect_fallback_recovered'
      || reason.endsWith('_recovered');
  }

  private isUnrecoveredCriticalScoutingDiagnostic(error: Record<string, unknown>, hasRecoveryMarker: boolean): boolean {
    const severity = this.stringField(error, 'severity')?.toLowerCase();
    if (severity !== 'critical') {
      return false;
    }
    if (this.isScoutingRecoveryDiagnostic(error)) {
      return false;
    }
    return !hasRecoveryMarker;
  }

  private addTestFailureSummary(response: StatusResponse, runDir: string): void {
    const comparisonContent = this.readSmallTerminalArtifact(path.join(runDir, 'test-baseline-comparison.json'));
    const preValidationLog = this.readSmallTerminalArtifact(path.join(runDir, 'pre-validation.log'));
    const summary = {
      ...this.extractTestFailureFromLog(preValidationLog ?? ''),
      ...(comparisonContent ? this.extractBaselineComparisonSummary(comparisonContent) : {}),
    };
    if (Object.keys(summary).length === 0) {
      return;
    }
    response.diagnosticSummary = {
      ...response.diagnosticSummary,
      testFailure: summary,
    };
  }

  private extractTestFailureFromLog(content: string): NonNullable<NonNullable<StatusResponse['diagnosticSummary']>['testFailure']> {
    if (!content) {
      return {};
    }
    const summaryStart = content.lastIndexOf('Summary of all failing tests');
    const relevant = summaryStart >= 0 ? content.slice(summaryStart) : content;
    const failedSuite = relevant.match(/^\s*FAIL\s+(.+)$/m)?.[1]?.trim();
    const failedTest = relevant.match(/^\s*●\s+(.+)$/m)?.[1]?.trim();
    const assertionSummary = relevant.match(/^\s*(expect\([^)]+\)\.[^\n]+)$/m)?.[1]?.trim();
    return {
      ...(failedSuite ? { failedSuite } : {}),
      ...(failedTest ? { failedTest } : {}),
      ...(assertionSummary ? { assertionSummary } : {}),
    };
  }

  private extractBaselineComparisonSummary(content: string): NonNullable<NonNullable<StatusResponse['diagnosticSummary']>['testFailure']> {
    try {
      const parsed = JSON.parse(content) as any;
      const baselineValidationExitCode = typeof parsed.baseline_validation_exit_code === 'number'
        ? parsed.baseline_validation_exit_code
        : undefined;
      const baselineComparisonReliable = baselineValidationExitCode === undefined || baselineValidationExitCode === 0 || baselineValidationExitCode === 1;
      const baselineComparisonWarning = baselineComparisonReliable
        ? undefined
        : `Baseline validation exited ${baselineValidationExitCode}; failure classification may be incomplete.`;
      return {
        baselineComparison: {
          totalNewlyIntroduced: this.optionalNumber(parsed.summary?.total_newly_introduced),
          totalPreExisting: this.optionalNumber(parsed.summary?.total_pre_existing),
          totalFixed: this.optionalNumber(parsed.summary?.total_fixed),
          ...(baselineValidationExitCode !== undefined ? { baselineValidationExitCode } : {}),
          baselineComparisonReliable,
          ...(baselineComparisonWarning ? { baselineComparisonWarning } : {}),
        },
      };
    } catch {
      return {};
    }
  }

  private optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
}
