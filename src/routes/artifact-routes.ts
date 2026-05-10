import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { ResultCache } from '../result-cache';
import { KasekiApiConfig } from '../kaseki-api-config';
import { ArtifactResponse, RunArtifactsResponse, ArtifactAvailability } from '../kaseki-api-types';
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
      const fileExists = fs.existsSync(filePath);
      const fileSize = fileExists ? fs.statSync(filePath).size : 0;
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

      const stat = fs.statSync(filePath);

      const response: ArtifactResponse = {
        file: fileName,
        contentType,
        size: stat.size,
        content,
      };

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
