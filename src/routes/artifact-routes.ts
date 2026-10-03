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
   * GET /api/v1/results/:id/:file - Download artifact.
   * Serves all artifacts in ARTIFACT_METADATA_REGISTRY.
   */
  router.get('/results/:id/:file', async (req: Request, res: Response) => {
    const job = await getJobOrRespond(scheduler, req.params.id, res);
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
   * GET /api/v1/runs/:id/artifacts - List available artifacts.
   * Pass ?manifest=true to include unavailable registry entries as well.
   */
  router.get('/runs/:id/artifacts', async (req: Request, res: Response) => {
    const job = await getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const includeManifest = req.query.manifest === 'true' || req.query.manifest === '1';
    res.json(buildRunArtifactsResponse(job, scheduler, config, includeManifest));
  });

  return router;
}
