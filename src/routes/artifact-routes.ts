import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { ResultCache } from '../result-cache';
import { KasekiApiConfig } from '../kaseki-api-config';
import { ArtifactResponse, RunArtifactsResponse, ArtifactAvailability, RunEvaluationRenderedResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';
import { getJobOrRespond } from '../utils/route-helpers';
import { getRunArtifactMetadata } from '../run-artifact-metadata-cache';
import { ARTIFACT_METADATA_REGISTRY } from '../artifact-metadata';

// All artifacts from the metadata registry
const ALL_ARTIFACT_NAMES = Object.keys(ARTIFACT_METADATA_REGISTRY);

function isTerminalJobStatus(status: 'queued' | 'running' | 'completed' | 'failed'): boolean {
  return status === 'completed' || status === 'failed';
}

/**
 * Check if an artifact is available based on job status.
 * - ON_FAILURE artifacts only available if job.status === 'failed'
 * - ON_SUCCESS artifacts only available if job.status === 'completed'
 * - ALWAYS artifacts always available for terminal jobs
 * - CONDITIONAL artifacts require existence check on disk
 */
function isArtifactAvailable(
  artifactName: string,
  jobStatus: 'queued' | 'running' | 'completed' | 'failed',
  fileExists: boolean,
  fileSize: number
): boolean {
  if (!isTerminalJobStatus(jobStatus)) {
    return false;
  }

  const metadata = ARTIFACT_METADATA_REGISTRY[artifactName];
  if (!metadata) {
    return false;
  }

  // File must exist and have content
  if (!fileExists || fileSize === 0) {
    return false;
  }

  // Check availability rules
  switch (metadata.availability) {
  case ArtifactAvailability.ALWAYS:
    return true;
  case ArtifactAvailability.ON_FAILURE:
    return jobStatus === 'failed';
  case ArtifactAvailability.ON_SUCCESS:
    return jobStatus === 'completed';
  case ArtifactAvailability.CONDITIONAL:
    // For conditional artifacts, availability depends on file existence
    return true;
  default:
    return false;
  }
}

function artifactContentType(fileName: string): string {
  const metadata = ARTIFACT_METADATA_REGISTRY[fileName];
  if (metadata) {
    return metadata.contentType;
  }
  // Fallback
  if (fileName.endsWith('.json')) return 'application/json';
  if (fileName.endsWith('.md')) return 'text/markdown';
  if (fileName.endsWith('.jsonl')) return 'application/x-jsonl';
  if (fileName.endsWith('.tsv')) return 'text/tab-separated-values';
  return 'text/plain';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [String(value)];
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : { value: entry }));
}

function renderRunEvaluationPayload(parsed: Record<string, unknown>, includeMarkdown: boolean): RunEvaluationRenderedResponse {
  const sections = {
    overall: (parsed.overall ?? parsed.overall_assessment ?? parsed.overallAssessment)
      ? { assessment: parsed.overall ?? parsed.overall_assessment ?? parsed.overallAssessment }
      : undefined,
    summary: asStringArray(parsed.summary),
    problem: asStringArray(parsed.problem ?? parsed.issues ?? parsed.problems),
    solution: asStringArray(parsed.solution ?? parsed.what_was_fixed ?? parsed.whatWasFixed ?? parsed.fixes),
    humanReview: asStringArray(
      parsed.human_review_recommendations ?? parsed.humanReviewRecommendations ?? parsed.human_review_focus
    ),
    stages: asObjectArray(parsed.stages ?? parsed.stage_by_stage_evaluation ?? parsed.stageByStageEvaluation),
    efficiency: asObjectArray(parsed.efficiency ?? parsed.efficiency_findings ?? parsed.efficiencyFindings),
    validation: asObjectArray(parsed.validation ?? parsed.validation_outcome ?? parsed.validationOutcome),
    opportunities: asObjectArray(
      parsed.opportunities ?? parsed.kaseki_improvement_opportunities ?? parsed.improvement_opportunities ?? parsed.improvementOpportunities
    ),
    warnings: asObjectArray(parsed.warnings),
    metadata: parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata)
      ? parsed.metadata as Record<string, unknown>
      : undefined,
  };

  const markdown = includeMarkdown
    ? [
      sections.summary.length ? `## Summary\n${sections.summary.map((line) => `- ${line}`).join('\n')}` : '',
      sections.problem.length ? `## Problem\n${sections.problem.map((line) => `- ${line}`).join('\n')}` : '',
      sections.solution.length ? `## Solution\n${sections.solution.map((line) => `- ${line}`).join('\n')}` : '',
      sections.humanReview.length ? `## Human review\n${sections.humanReview.map((line) => `- ${line}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')
    : undefined;

  return {
    format: 'rendered',
    file: 'run-evaluation.json',
    sections,
    markdown,
    raw: parsed,
  };
}

export function readArtifactContent(
  filePath: string,
  jobStatus: 'queued' | 'running' | 'completed' | 'failed',
  cache: ResultCache
): string | null {
  if (!isTerminalJobStatus(jobStatus)) {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
  return cache.getOrLoad(filePath);
}

/**
 * Create artifact-related routes (list artifacts, download artifacts).
 */
export function createArtifactRoutes(scheduler: JobScheduler, config: KasekiApiConfig, cache: ResultCache): Router {
  const router = Router();

  /**
   * GET /api/results/:id/:file - Download artifact.
   * Now supports all artifacts in ARTIFACT_METADATA_REGISTRY.
   */
  router.get('/results/:id/:file', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const fileName = req.params.file;
    const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : undefined;
    const includeMarkdown = req.query.markdown === 'true' || req.query.markdown === '1';

    // Validate that the artifact is in the registry
    if (!ALL_ARTIFACT_NAMES.includes(fileName)) {
      return sendErrorResponse(
        res,
        400,
        'Bad Request',
        `Artifact not found in registry: ${fileName}. Available: ${ALL_ARTIFACT_NAMES.join(', ')}`
      );
    }

    const metadata = ARTIFACT_METADATA_REGISTRY[fileName];
    if (!metadata) {
      return sendErrorResponse(res, 400, 'Bad Request', `Unknown artifact: ${fileName}`);
    }

    // Check availability based on job status
    try {
      const filePath = path.join(config.resultsDir, job.id, fileName);
      let fileExists = false;
      let fileSize = 0;
      let fileStat: fs.Stats | undefined;
      try {
        fileStat = fs.statSync(filePath);
        fileExists = fileStat.isFile();
        fileSize = fileExists ? fileStat.size : 0;
      } catch {
        // Availability handling below returns a client-facing not-available response.
      }
      const available = isArtifactAvailable(fileName, job.status, fileExists, fileSize);

      if (!available) {
        const reason =
          metadata.availability === ArtifactAvailability.ON_FAILURE
            ? `Artifact only available for failed runs: ${fileName}`
            : `Artifact not available in current state: ${fileName}`;
        return sendErrorResponse(res, 400, 'Bad Request', reason);
      }

      if (!fileExists || fileSize === 0) {
        return sendErrorResponse(res, 404, 'Not Found', `Artifact not found or empty: ${fileName}`);
      }

      const contentType = artifactContentType(fileName);

      // Read from disk for non-terminal jobs; cache only terminal artifacts.
      const content = readArtifactContent(filePath, job.status, cache);
      if (content === null) {
        return sendErrorResponse(res, 500, 'Internal Server Error', `Failed to read artifact: ${fileName}`);
      }

      const response: ArtifactResponse = {
        file: fileName,
        contentType,
        size: fileStat?.size ?? fileSize,
        content,
      };

      if (format !== undefined) {
        if (format !== 'rendered') {
          return sendErrorResponse(res, 400, 'Bad Request', `Unsupported format: ${format}. Supported: rendered`);
        }

        if (fileName !== 'run-evaluation.json') {
          return sendErrorResponse(res, 400, 'Bad Request', 'Rendered format is only supported for run-evaluation.json');
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          return sendErrorResponse(res, 422, 'Unprocessable Entity', 'Invalid JSON in run-evaluation.json artifact');
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return sendErrorResponse(res, 422, 'Unprocessable Entity', 'run-evaluation.json must contain a JSON object');
        }

        const rendered = renderRunEvaluationPayload(parsed as Record<string, unknown>, includeMarkdown);
        res.setHeader('Content-Type', 'application/json');
        return res.json(rendered);
      }

      res.setHeader('Content-Type', contentType);
      res.json(response);
    } catch (err) {
      sendErrorResponse(
        res,
        500,
        'Internal Server Error',
        `Failed to read artifact: ${(err as Error).message}`
      );
    }
  });

  /**
   * GET /api/runs/:id/artifacts - Enumerate all artifacts with availability info.
   * Returns comprehensive artifact list with descriptions, triage order, and availability.
   */
  router.get('/runs/:id/artifacts', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const runDir = job.resultDir || path.join(config.resultsDir, job.id);
    const metadata = getRunArtifactMetadata(job.id, runDir, ALL_ARTIFACT_NAMES, isTerminalJobStatus(job.status));

    // Build comprehensive artifact list with metadata
    const artifacts = ALL_ARTIFACT_NAMES.map((fileName) => {
      const artifactMeta = ARTIFACT_METADATA_REGISTRY[fileName];
      const fileMeta = metadata[fileName] ?? { exists: false, size: 0 };
      const available = isArtifactAvailable(fileName, job.status, fileMeta.exists, fileMeta.size);

      return {
        name: fileName,
        size: fileMeta.size,
        contentType: artifactMeta?.contentType || 'application/octet-stream',
        available,
        description: artifactMeta?.description,
        availability: artifactMeta?.availability,
        triageOrder: artifactMeta?.triageOrder,
      };
    });

    // Determine recommended triage order (by triageOrder, then by availability)
    const recommended = artifacts
      .filter((a) => a.available)
      .sort((a, b) => (a.triageOrder ?? 999) - (b.triageOrder ?? 999))
      .slice(0, 5) // Top 5 for quick triage
      .map((a) => a.name);

    const response: RunArtifactsResponse = {
      id: job.id,
      runStatus: job.status,
      exitCode: job.exitCode,
      artifacts,
      recommended,
      artifactCount: artifacts.filter((a) => a.available).length,
      downloadBaseUrl: `/api/results/${job.id}/`,
    };

    res.json(response);
  });

  return router;
}
