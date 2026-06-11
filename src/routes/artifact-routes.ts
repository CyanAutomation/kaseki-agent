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
import { getDeprecationInfo, extractPhaseFromConsolidated } from '../lib/artifact-consolidation-aliases';

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
   * Now supports all artifacts in ARTIFACT_METADATA_REGISTRY.
   * For deprecated artifacts, serves from consolidated targets with deprecation notice.
   */
  router.get('/results/:id/:file', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    let fileName = req.params.file;
    const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : undefined;
    const includeMarkdown = req.query.markdown === 'true' || req.query.markdown === '1';
    const deprecationInfo = getDeprecationInfo(fileName);

    // If requesting a deprecated artifact, serve from consolidated target instead
    if (deprecationInfo) {
      const consolidatedTarget = deprecationInfo.consolidatedTarget;
      const phase = deprecationInfo.phase;

      // Add deprecation header
      res.setHeader('X-Artifact-Deprecated', 'true');
      res.setHeader('X-Artifact-Consolidation-Target', consolidatedTarget);
      if (phase) {
        res.setHeader('X-Artifact-Phase', phase);
      }
      res.setHeader(
        'Deprecation',
        'true; rel="https://docs.kaseki.dev/artifact-consolidation"'
      );

      // Serve from consolidated target
      fileName = consolidatedTarget;
    }

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
        const reason = getArtifactUnavailableReason(status, fileName);
        const statusCode = status === 'pending' ? 202 : 400;
        return sendErrorResponse(res, statusCode, 'Bad Request', reason);
      }

      const contentType = getArtifactContentType(fileName);

      // Read from disk for non-terminal jobs; cache only terminal artifacts.
      let content = readArtifactContent(filePath, job.status, cache);
      if (content === null) {
        return sendErrorResponse(res, 500, 'Internal Server Error', `Failed to read artifact: ${fileName}`);
      }

      // If original request was for a deprecated artifact with a phase, extract that phase from consolidated
      if (deprecationInfo && deprecationInfo.phase) {
        const extractedContent = extractPhaseFromConsolidated(content, fileName, deprecationInfo.phase);
        if (extractedContent) {
          content = extractedContent;
        }
      }

      const response: ArtifactResponse = {
        file: req.params.file, // Return original filename requested
        contentType,
        size: content.length,
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
    const metadata = getRunArtifactMetadata(job.id, runDir, ALL_ARTIFACT_NAMES, isTerminalJobStatus(job.status));

    // Build comprehensive artifact list with metadata
    const artifacts = ALL_ARTIFACT_NAMES.map((fileName) => {
      const artifactMeta = ARTIFACT_METADATA_REGISTRY[fileName];
      const fileMeta = metadata[fileName] ?? { exists: false, size: 0 };
      const available = isArtifactAvailable(fileName, job.status, fileMeta.exists, fileMeta.size);
      const deprecationInfo = getDeprecationInfo(fileName);

      const artifact: any = {
        name: fileName,
        size: fileMeta.size,
        contentType: artifactMeta?.contentType || 'application/octet-stream',
        available,
        description: artifactMeta?.description,
        availability: artifactMeta?.availability,
        triageOrder: artifactMeta?.triageOrder,
      };

      // Add consolidation info for deprecated artifacts
      if (deprecationInfo) {
        artifact.deprecated = true;
        artifact.consolidationTarget = deprecationInfo.consolidatedTarget;
        artifact.consolidationPhase = deprecationInfo.phase;
        artifact.migrationPath = deprecationInfo.migrationPath;
      }

      return artifact;
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
