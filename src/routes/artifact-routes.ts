import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { ResultCache } from '../result-cache';
import { KasekiApiConfig } from '../kaseki-api-config';
import { ArtifactResponse, RunArtifactsResponse } from '../kaseki-api-types';
import { sendErrorResponse } from '../utils/response-helpers';
import { getJobOrRespond } from '../utils/route-helpers';

const ALWAYS_SAFE_SUMMARY_ARTIFACTS = [
  'git.diff',
  'metadata.json',
  'analysis.md',
  'result-summary.md',
  'pi-events.jsonl',
  'pi-summary.json',
  'progress.log',
] as const;

const FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS = [
  'failure.json',
  'stderr.log',
  'stdout.log',
  'validation.log',
  'quality.log',
] as const;

function isTerminalJobStatus(status: 'queued' | 'running' | 'completed' | 'failed'): boolean {
  return status === 'completed' || status === 'failed';
}

function artifactContentType(fileName: string): string {
  if (fileName.endsWith('.json')) return 'application/json';
  if (fileName.endsWith('.md')) return 'text/markdown';
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
export function createArtifactRoutes(scheduler: JobScheduler, config: KasekiApiConfig): Router {
  const router = Router();
  const cache = new ResultCache();

  /**
   * GET /api/results/:id/:file - Download artifact.
   */
  router.get('/results/:id/:file', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const fileName = req.params.file;
    const allowedFiles = [...ALWAYS_SAFE_SUMMARY_ARTIFACTS, ...FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS];

    if (!allowedFiles.some((allowedFile) => allowedFile === fileName)) {
      return sendErrorResponse(
        res,
        400,
        'Bad Request',
        `Artifact not allowed: ${fileName}. Allowed: ${allowedFiles.join(', ')}`
      );
    }

    if (FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS.some((artifact) => artifact === fileName) && job.status !== 'failed') {
      return sendErrorResponse(
        res,
        400,
        'Bad Request',
        `Artifact only available for failed runs: ${fileName}`
      );
    }

    try {
      const filePath = path.join(config.resultsDir, job.id, fileName);

      if (!fs.existsSync(filePath)) {
        return sendErrorResponse(res, 404, 'Not Found', `Artifact not found: ${fileName}`);
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
   * GET /api/runs/:id/artifacts - Enumerate allowlisted artifacts and availability.
   */
  router.get('/runs/:id/artifacts', (req: Request, res: Response) => {
    const job = getJobOrRespond(scheduler, req.params.id, res);
    if (!job) {
      return;
    }

    const runDir = job.resultDir || path.join(config.resultsDir, job.id);
    const allowedFiles = [...ALWAYS_SAFE_SUMMARY_ARTIFACTS, ...FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS];

    const artifacts = allowedFiles.map((fileName) => {
      const filePath = path.join(runDir, fileName);
      const exists = fs.existsSync(filePath);
      const stat = exists ? fs.statSync(filePath) : undefined;
      const isFailureOnly = FAILURE_ONLY_DIAGNOSTICS_ARTIFACTS.some((artifact) => artifact === fileName);
      const hasContent = exists && (stat?.size ?? 0) > 0;
      const available = hasContent && (!isFailureOnly || job.status === 'failed');

      return {
        name: fileName,
        size: stat?.size ?? 0,
        contentType: artifactContentType(fileName),
        available,
      };
    });

    const response: RunArtifactsResponse = {
      id: job.id,
      runStatus: job.status,
      exitCode: job.exitCode,
      artifacts,
      recommended:
        job.status === 'failed'
          ? ['failure.json', 'stderr.log', 'stdout.log', 'validation.log', 'quality.log']
          : ['result-summary.md', 'metadata.json', 'pi-summary.json', 'git.diff'],
    };

    res.json(response);
  });

  return router;
}
