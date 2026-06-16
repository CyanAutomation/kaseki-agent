/**
 * Artifact Content Loader
 *
 * Encapsulates the logic for loading and parsing validation error content
 * from artifact files (JSONL format with fallback to raw content).
 */

import * as path from 'path';
import { StatusResponse } from '../kaseki-api-types';
import { ResultCache } from '../result-cache';
import * as fs from 'fs';

const INLINE_ARTIFACT_LIMIT_BYTES = 65536;

export class ArtifactContentLoader {
  constructor(private artifactCache?: Pick<ResultCache, 'getOrLoad'>) {}

  /**
   * Load and add validation error content from a JSONL file
   */
  addValidationErrorsContent(
    response: StatusResponse,
    runDir: string,
    fileName: 'goal-setting-validation-errors.jsonl' | 'scouting-validation-errors.jsonl' | 'goal-check-validation-errors.jsonl',
    phase: 'goalSetting' | 'scouting' | 'goalCheck',
    isSmallAvailable: (fileName: string) => boolean
  ): void {
    if (!isSmallAvailable(fileName)) {
      return;
    }
    const validationErrorsPath = path.join(runDir, fileName);
    const validationErrorsContent = this.readSmallTerminalArtifact(validationErrorsPath);
    if (!validationErrorsContent || validationErrorsContent.length > INLINE_ARTIFACT_LIMIT_BYTES) {
      return;
    }
    this.addValidationErrorsContentFields(response, validationErrorsContent, phase);
  }

  /**
   * Parse JSONL validation error content and populate response fields
   */
  private addValidationErrorsContentFields(
    response: StatusResponse,
    content: string,
    phase: 'goalSetting' | 'scouting' | 'goalCheck'
  ): void {
    try {
      const parsedErrors = content
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line) as unknown);

      if (parsedErrors.every(this.isRecord)) {
        if (phase === 'goalSetting') {
          response.goalSettingValidationErrorsContent = parsedErrors;
        } else if (phase === 'scouting') {
          response.scoutingValidationErrorsContent = parsedErrors;
        } else {
          response.goalCheckValidationErrorsContent = parsedErrors;
        }
        return;
      }
    } catch {
      // Fall through to bounded raw content fallback.
    }

    const rawContent = content.slice(0, INLINE_ARTIFACT_LIMIT_BYTES);
    if (phase === 'goalSetting') {
      response.goalSettingValidationErrorsRawContent = rawContent;
    } else if (phase === 'scouting') {
      response.scoutingValidationErrorsRawContent = rawContent;
    } else {
      response.goalCheckValidationErrorsRawContent = rawContent;
    }
  }

  /**
   * Check if a value is a plain object (not array or null)
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Read small artifact from cache or disk
   */
  readSmallTerminalArtifact(filePath: string): string | null {
    if (this.artifactCache) {
      return this.artifactCache.getOrLoad(filePath);
    }

    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
