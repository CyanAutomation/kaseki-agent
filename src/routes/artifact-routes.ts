import { Router, Request, Response } from 'express';
import { JobScheduler } from '../job-scheduler';
import { ResultCache } from '../result-cache';
import { KasekiApiConfig } from '../kaseki-api-config';
import { getJobOrRespond } from '../utils/route-helpers';
import {
  buildRunArtifactsResponse,
  parseArtifactDownloadRequest,
  readArtifactContent,
  sendArtifactDownloadResponse,
  validateRegisteredArtifact,
} from './artifact-route-helpers';

export { readArtifactContent };

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

    const request = parseArtifactDownloadRequest(req.params.file, req.query);
    if (!validateRegisteredArtifact(request.fileName, res)) {
      return;
    }

    sendArtifactDownloadResponse(request, job, scheduler, config, cache, res);
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

    res.json(buildRunArtifactsResponse(job, scheduler, config));
  });

  return router;
}
