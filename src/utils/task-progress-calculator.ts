/**
 * Task Progress Calculator
 *
 * Encapsulates the complex logic for calculating task progress percentage
 * from orchestrator stages and progress events.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Job, StatusResponse } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';
import { deriveOrchestratorStages } from './orchestrator-stages';

type ProgressEventLike = {
  stage?: unknown;
  status?: unknown;
  detail?: unknown;
};

const PI_STREAM_ONLY_STAGES = new Set(['pi agent', 'pi tool batch']);

export class TaskProgressCalculator {
  constructor(
    private scheduler: JobScheduler,
    private config: KasekiApiConfig
  ) {}

  /**
   * Calculate task progress percentage for a job
   * Returns undefined if calculation fails or job is queued
   */
  calculateProgressPercent(
    response: StatusResponse,
    job: Job,
    runDir: string,
    metadata: any
  ): number | undefined {
    if (job.status === 'queued') {
      return undefined;
    }

    try {
      const progressFile = path.join(runDir, 'progress.jsonl');
      const orchestratorStages = deriveOrchestratorStages(job, this.config);
      const { denominatorStages, totalStages } = this.determineStageDenominator(metadata, orchestratorStages);

      const { finishedStages, currentStage } = this.processProgressEvents(
        progressFile,
        job,
        response,
        denominatorStages
      );

      if (totalStages <= 0) {
        return undefined;
      }

      const completedStages = this.calculateCompletedStages(
        finishedStages,
        denominatorStages,
        currentStage,
        metadata,
        totalStages
      );

      return this.normalizeProgressPercent(completedStages, totalStages, job.id);
    } catch (error) {
      if (process.env.KASEKI_DEBUG_PROGRESS === '1') {
        console.error(`[TaskProgressInfo] Error calculating progress for ${job.id}:`, error);
      }
      return undefined;
    }
  }

  /**
   * Normalize stage name (trim whitespace)
   */
  private normalizeStageName(stage: unknown): string | undefined {
    return typeof stage === 'string' && stage.trim().length > 0 ? stage.trim() : undefined;
  }

  /**
   * Normalize progress-only Pi stream stages to denominator stages for task progress.
   */
  private normalizeTaskProgressStage(
    stage: unknown,
    jobCurrentStage?: unknown,
    denominatorStages: readonly string[] = []
  ): string | undefined {
    const normalizedStage = this.normalizeStageName(stage);
    if (!normalizedStage) {
      return undefined;
    }

    if (!PI_STREAM_ONLY_STAGES.has(normalizedStage)) {
      return normalizedStage;
    }

    const normalizedJobCurrentStage = this.normalizeStageName(jobCurrentStage);
    if (normalizedJobCurrentStage && denominatorStages.includes(normalizedJobCurrentStage)) {
      return normalizedJobCurrentStage;
    }

    return 'pi coding agent';
  }

  /**
   * Check if a progress event is finished
   */
  private isFinishedProgressEvent(event: ProgressEventLike): boolean {
    return event.status === 'finished' || (typeof event.detail === 'string' && event.detail.includes('finished'));
  }

  /**
   * Process progress events from file or live scheduler
   */
  private processProgressEvents(
    progressFile: string,
    job: Job,
    response: StatusResponse,
    denominatorStages: readonly string[]
  ): { finishedStages: Set<string>; currentStage: string | undefined } {
    const finishedStages = new Set<string>();
    let currentStage: string | undefined = this.normalizeTaskProgressStage(
      job.currentStage,
      undefined,
      denominatorStages
    ) ?? this.normalizeTaskProgressStage(response.progress?.stage, job.currentStage, denominatorStages);

    // Track the furthest stage index seen so far to prevent currentStage from going backward.
    // Pi streaming events (e.g. "pi agent") can arrive after later stages have started and
    // would otherwise reset currentStage to an earlier position, causing the percentage to drop.
    let highWaterStageIndex = currentStage ? denominatorStages.indexOf(currentStage) : -1;

    const ingestEvent = (event: ProgressEventLike): void => {
      const progressStage = this.normalizeTaskProgressStage(event.stage, job.currentStage, denominatorStages);
      if (!progressStage) {
        return;
      }

      // Only advance currentStage monotonically. Unknown stages (index -1) are skipped for
      // currentStage tracking but still recorded in finishedStages below.
      const stageIndex = denominatorStages.indexOf(progressStage);
      if (stageIndex >= 0 && stageIndex >= highWaterStageIndex) {
        currentStage = progressStage;
        highWaterStageIndex = stageIndex;
      }

      if (this.isFinishedProgressEvent(event)) {
        finishedStages.add(progressStage);
      }
    };

    if (fs.existsSync(progressFile)) {
      try {
        const content = fs.readFileSync(progressFile, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            ingestEvent(JSON.parse(line) as ProgressEventLike);
          } catch {
            // Skip malformed JSON lines
          }
        }
      } catch {
        // Ignore file read errors
      }
    }

    if (!fs.existsSync(progressFile) && typeof this.scheduler.getLiveProgressEvents === 'function') {
      try {
        const liveEvents = this.scheduler.getLiveProgressEvents(job.id, 100);
        for (const event of liveEvents) {
          ingestEvent(event);
        }
      } catch {
        // Ignore live event errors
      }
    }

    return { finishedStages, currentStage };
  }

  /**
   * Determine stage denominator from metadata or orchestrator stages
   */
  private determineStageDenominator(
    metadata: any,
    orchestratorStages: string[]
  ): { denominatorStages: readonly string[]; totalStages: number } {
    // Prefer stages from metadata if available
    if (metadata?.stages && Array.isArray(metadata.stages) && metadata.stages.length > 0) {
      return {
        denominatorStages: metadata.stages,
        totalStages: metadata.stages.length,
      };
    }

    return {
      denominatorStages: orchestratorStages,
      totalStages: orchestratorStages.length,
    };
  }

  /**
   * Calculate number of completed stages
   */
  private calculateCompletedStages(
    finishedStages: Set<string>,
    denominatorStages: readonly string[],
    currentStage: string | undefined,
    metadata: any,
    totalStages: number
  ): number {
    // Count stage index if current stage is found
    const stageList = metadata?.stages || denominatorStages;

    // Use max finished stage POSITION instead of count so this signal is in the same units
    // as currentStageIndex. finishedStages.size would count names regardless of position,
    // which can disagree with currentStageIndex when names don't appear in stageList.
    let maxFinishedIndex = -1;
    for (const stage of finishedStages) {
      const idx = stageList.indexOf(stage);
      if (idx > maxFinishedIndex) maxFinishedIndex = idx;
    }
    let completedStages = maxFinishedIndex >= 0 ? maxFinishedIndex + 1 : 0;
    const currentStageIndex = currentStage && stageList.length > 0 ? stageList.indexOf(currentStage) : -1;

    if (currentStageIndex >= 0) {
      completedStages = Math.max(completedStages, currentStageIndex);
      if (currentStage && finishedStages.has(currentStage)) {
        completedStages = Math.max(completedStages, currentStageIndex + 1);
      } else {
        completedStages = Math.max(completedStages, currentStageIndex + 0.5);
      }
    }

    // Cap at totalStages to handle over-completion
    return Math.min(completedStages, totalStages);
  }

  /**
   * Normalize progress percent to 0-100 integer
   */
  private normalizeProgressPercent(completedStages: number, totalStages: number, jobId: string): number {
    if (totalStages <= 0) {
      return 0;
    }

    const percent = (completedStages / totalStages) * 100;
    const rounded = Math.round(percent);

    if (process.env.KASEKI_DEBUG_PROGRESS === '1') {
      console.log(`[TaskProgressInfo] ${jobId}: ${completedStages}/${totalStages} = ${percent.toFixed(2)}% → ${rounded}%`);
    }

    return Math.min(Math.max(rounded, 0), 100);
  }
}
