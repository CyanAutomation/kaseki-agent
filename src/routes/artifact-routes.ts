import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { ResultCache } from '../result-cache';
import { KasekiApiConfig } from '../kaseki-api-config';
import { ArtifactResponse, RunArtifactsResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';
import { getJobOrRespond } from '../utils/route-helpers';
import { getRunArtifactMetadata } from '../run-artifact-metadata-cache';
import { ARTIFACT_METADATA_REGISTRY } from '../artifact-metadata';
import { isTerminalJobStatus, isArtifactAvailable, getArtifactStatus, getArtifactUnavailableReason, getSafeFileStats } from '../lib/artifact-availability';
import { renderRunEvaluationPayload, getArtifactContentType } from './artifact-content-helpers';

// All artifacts from the metadata registry
const ALL_ARTIFACT_NAMES = Object.keys(ARTIFACT_METADATA_REGISTRY);

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
   * Serves all artifacts in ARTIFACT_METADATA_REGISTRY.
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

    try {
      // Determine artifact availability
      const filePath = path.join(config.resultsDir, job.id, fileName);
      const fileStats = getSafeFileStats(filePath);
      const status = getArtifactStatus(fileName, job.status, fileStats.exists, fileStats.size);

      // Handle non-available artifacts
      if (status !== 'available') {
        if (
          job.status === 'running' &&
          fileName === 'stdout.log' &&
          typeof scheduler.getLiveDockerLogTail === 'function'
        ) {
          const liveContent = scheduler.getLiveDockerLogTail(job.id, 300);
          if (liveContent) {
            const contentType = getArtifactContentType(fileName);
            const response: ArtifactResponse = {
              file: fileName,
              contentType,
              size: Buffer.byteLength(liveContent, 'utf-8'),
              content: liveContent,
            };
            res.setHeader('Content-Type', contentType);
            return res.json(response);
          }
        }
        const reason = getArtifactUnavailableReason(status, fileName);
        const statusCode = status === 'pending' ? 202 : 400;
        return sendErrorResponse(res, statusCode, 'Bad Request', reason);
      }

      const contentType = getArtifactContentType(fileName);

      // Read from disk for non-terminal jobs; cache only terminal artifacts.
      const content = readArtifactContent(filePath, job.status, cache);
      if (content === null) {
        return sendErrorResponse(res, 500, 'Internal Server Error', `Failed to read artifact: ${fileName}`);
      }

      const response: ArtifactResponse = {
        file: fileName,
        contentType,
        size: fileStats.size,
        content,
      };

      // Handle format transformation (rendered JSON)
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

      // Return raw artifact response
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
    const artifactMetadata = getRunArtifactMetadata(job.id, runDir, ALL_ARTIFACT_NAMES, isTerminalJobStatus(job.status));

    // Build comprehensive artifact list with metadata
    const artifacts = ALL_ARTIFACT_NAMES.map((fileName) => {
      const artifactMeta = ARTIFACT_METADATA_REGISTRY[fileName];
      const fileMeta = artifactMetadata[fileName] ?? { exists: false, size: 0 };
      const liveStdout =
        job.status === 'running' &&
        fileName === 'stdout.log' &&
        !fileMeta.exists &&
        typeof scheduler.getLiveDockerLogTail === 'function'
          ? scheduler.getLiveDockerLogTail(job.id, 300)
          : '';
      const effectiveSize = liveStdout ? Buffer.byteLength(liveStdout, 'utf-8') : fileMeta.size;
      const available = liveStdout
        ? true
        : isArtifactAvailable(fileName, job.status, fileMeta.exists, fileMeta.size);

      return {
        name: fileName,
        size: effectiveSize,
        contentType: artifactMeta?.contentType || 'application/octet-stream',
        available,
        description: artifactMeta?.description,
        availability: artifactMeta?.availability,
        triageOrder: artifactMeta?.triageOrder,
      };
    });

    const runMetadata = readArtifactMetadata(runDir);
    const preAgentValidationFailed =
      String(runMetadata?.failed_command ?? '').includes('pre-agent validation') ||
      Number(runMetadata?.pre_validation_exit_code ?? 0) !== 0;

    const triageRank = (artifactName: string, fallback: number | undefined): number => {
      if (preAgentValidationFailed) {
        if (artifactName === 'test-baseline-comparison.json') return 0;
        if (artifactName === 'pre-validation.log') return 1;
        if (artifactName === 'failure.json') return 2;
        if (artifactName === 'result-summary.md') return 3;
      }
      return fallback ?? 999;
    };

    // Determine recommended triage order (failure-aware triageOrder, then availability)
    const recommended = artifacts
      .filter((a) => a.available)
      .sort((a, b) => triageRank(a.name, a.triageOrder) - triageRank(b.name, b.triageOrder))
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

function readArtifactMetadata(runDir: string): Record<string, unknown> {
  try {
    const metadataPath = path.join(runDir, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
    }
  } catch {
    // Keep artifact listing resilient when metadata is malformed.
  }
  return {};
}
