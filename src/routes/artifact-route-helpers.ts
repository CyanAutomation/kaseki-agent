import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ARTIFACT_METADATA_REGISTRY } from '../artifact-metadata';
import { KasekiApiConfig } from '../kaseki-api-config';
import type { JobScheduler } from '../job-scheduler';
import {
  getArtifactStatus,
  getArtifactUnavailableReason,
  getSafeFileStats,
  isArtifactAvailable,
  isTerminalJobStatus,
} from '../lib/artifact-availability';
import type { ArtifactResponse, Job, RunArtifactsResponse } from '../kaseki-api-types';
import type { ResultCache } from '../result-cache';
import { sendErrorResponse } from '../utils/response-helpers';
import { getRunArtifactMetadata } from '../run-artifact-metadata-cache';
import { artifactContentType, renderRunEvaluationPayload } from './artifact-content-helpers';

export const ALL_ARTIFACT_NAMES = Object.keys(ARTIFACT_METADATA_REGISTRY);

type ArtifactDownloadRequest = {
  fileName: string;
  format?: string;
  includeMarkdown: boolean;
  tailRaw?: string;
  tailLines?: number;
};

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

export function parseArtifactDownloadRequest(
  fileName: string,
  query: Record<string, unknown>,
): ArtifactDownloadRequest {
  const tailRaw = typeof query.tail === 'string' ? query.tail : undefined;

  return {
    fileName,
    format: typeof query.format === 'string' ? query.format.toLowerCase() : undefined,
    includeMarkdown: query.markdown === 'true' || query.markdown === '1',
    tailRaw,
    tailLines: tailRaw !== undefined && /^\d+$/.test(tailRaw) ? Number.parseInt(tailRaw, 10) : undefined,
  };
}

export function validateRegisteredArtifact(fileName: string, res: Response): boolean {
  if (ALL_ARTIFACT_NAMES.includes(fileName)) {
    return true;
  }

  sendErrorResponse(
    res,
    400,
    'Bad Request',
    `Artifact not found in registry: ${fileName}. Available: ${ALL_ARTIFACT_NAMES.join(', ')}`
  );
  return false;
}

export function sendArtifactDownloadResponse(
  request: ArtifactDownloadRequest,
  job: Job,
  scheduler: JobScheduler,
  config: KasekiApiConfig,
  cache: ResultCache,
  res: Response,
): void {
  try {
    const filePath = path.join(config.resultsDir, job.id, request.fileName);
    const fileStats = getSafeFileStats(filePath);
    const status = getArtifactStatus(request.fileName, job.status, fileStats.exists, fileStats.size);

    if (status !== 'available') {
      if (sendLiveStdoutFallback(request.fileName, job, scheduler, res)) {
        return;
      }
      const reason = getArtifactUnavailableReason(status, request.fileName);
      const statusCode = status === 'pending' ? 202 : 400;
      sendErrorResponse(res, statusCode, 'Bad Request', reason);
      return;
    }

    const contentType = artifactContentType(request.fileName);
    const content = readArtifactContent(filePath, job.status, cache);
    if (content === null) {
      sendErrorResponse(res, 500, 'Internal Server Error', `Failed to read artifact: ${request.fileName}`);
      return;
    }

    if (!validateTailRequest(request, contentType, res)) {
      return;
    }

    if (request.format !== undefined) {
      sendRenderedArtifactResponse(request, content, res);
      return;
    }

    const response = buildArtifactResponse(request, contentType, content, fileStats.size);
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
}

export function buildRunArtifactsResponse(
  job: Job,
  scheduler: JobScheduler,
  config: KasekiApiConfig,
): RunArtifactsResponse {
  const runDir = job.resultDir || path.join(config.resultsDir, job.id);
  const artifactMetadata = getRunArtifactMetadata(job.id, runDir, ALL_ARTIFACT_NAMES, isTerminalJobStatus(job.status));
  const artifacts = ALL_ARTIFACT_NAMES.map((fileName) => {
    const artifactMeta = ARTIFACT_METADATA_REGISTRY[fileName];
    const fileMeta = artifactMetadata[fileName] ?? { exists: false, size: 0 };
    const liveStdout = getLiveStdoutContent(fileName, job, scheduler, !fileMeta.exists);
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
  const recommended = recommendedArtifactNames(artifacts, runMetadata);

  return {
    id: job.id,
    runStatus: job.status,
    exitCode: job.exitCode,
    artifacts,
    recommended,
    artifactCount: artifacts.filter((a) => a.available).length,
    downloadBaseUrl: `/api/results/${job.id}/`,
  };
}

function sendLiveStdoutFallback(
  fileName: string,
  job: Job,
  scheduler: JobScheduler,
  res: Response,
): boolean {
  const liveContent = getLiveStdoutContent(fileName, job, scheduler, true);
  if (!liveContent) {
    return false;
  }

  const contentType = artifactContentType(fileName);
  const response: ArtifactResponse = {
    file: fileName,
    contentType,
    size: Buffer.byteLength(liveContent, 'utf-8'),
    content: liveContent,
  };
  res.setHeader('Content-Type', contentType);
  res.json(response);
  return true;
}

function getLiveStdoutContent(
  fileName: string,
  job: Job,
  scheduler: JobScheduler,
  missingArtifact: boolean,
): string {
  if (
    job.status === 'running' &&
    fileName === 'stdout.log' &&
    missingArtifact &&
    typeof scheduler.getLiveDockerLogTail === 'function'
  ) {
    return scheduler.getLiveDockerLogTail(job.id, 300) || '';
  }
  return '';
}

function validateTailRequest(
  request: ArtifactDownloadRequest,
  contentType: string,
  res: Response,
): boolean {
  if (request.tailRaw !== undefined && (request.tailLines === undefined || request.tailLines < 1)) {
    sendErrorResponse(res, 400, 'Bad Request', 'tail must be a positive integer');
    return false;
  }

  if (request.tailRaw !== undefined && !isLineOrientedArtifact(contentType)) {
    sendErrorResponse(res, 400, 'Bad Request', `tail is only supported for line-oriented artifacts, got ${request.fileName}`);
    return false;
  }

  return true;
}

function buildArtifactResponse(
  request: ArtifactDownloadRequest,
  contentType: string,
  content: string,
  size: number,
): ArtifactResponse {
  const responseContent = request.tailLines !== undefined
    ? tailArtifactContentByLines(content, request.tailLines)
    : content;

  return {
    file: request.fileName,
    contentType,
    size,
    content: responseContent,
    ...(request.tailLines !== undefined ? { truncated: responseContent !== content, tailLines: request.tailLines } : {}),
  };
}

function sendRenderedArtifactResponse(
  request: ArtifactDownloadRequest,
  content: string,
  res: Response,
): void {
  if (request.format !== 'rendered') {
    sendErrorResponse(res, 400, 'Bad Request', `Unsupported format: ${request.format}. Supported: rendered`);
    return;
  }

  if (request.fileName !== 'run-evaluation.json') {
    sendErrorResponse(res, 400, 'Bad Request', 'Rendered format is only supported for run-evaluation.json');
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    sendErrorResponse(res, 422, 'Unprocessable Entity', 'Invalid JSON in run-evaluation.json artifact');
    return;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sendErrorResponse(res, 422, 'Unprocessable Entity', 'run-evaluation.json must contain a JSON object');
    return;
  }

  const rendered = renderRunEvaluationPayload(parsed as Record<string, unknown>, request.includeMarkdown);
  res.setHeader('Content-Type', 'application/json');
  res.json(rendered);
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

function recommendedArtifactNames(
  artifacts: RunArtifactsResponse['artifacts'],
  runMetadata: Record<string, unknown>,
): string[] {
  return artifacts
    .filter((artifact) => artifact.available)
    .sort((a, b) => triageRank(a.name, a.triageOrder, runMetadata) - triageRank(b.name, b.triageOrder, runMetadata))
    .slice(0, 5)
    .map((artifact) => artifact.name);
}

function triageRank(
  artifactName: string,
  fallback: number | undefined,
  runMetadata: Record<string, unknown>,
): number {
  const failedCommand = String(runMetadata.failed_command ?? '');
  const preAgentValidationFailed =
    failedCommand.includes('pre-agent validation') ||
    Number(runMetadata.pre_validation_exit_code ?? 0) !== 0;
  const providerFailure =
    String(runMetadata.provider_error_type ?? '').trim().length > 0 ||
    failedCommand.includes('pi provider');

  if (providerFailure) {
    return providerFailureTriageRank(artifactName, fallback);
  }
  if (preAgentValidationFailed) {
    return preAgentValidationTriageRank(artifactName, fallback);
  }
  return fallback ?? 999;
}

function providerFailureTriageRank(artifactName: string, fallback: number | undefined): number {
  const ranks: Record<string, number> = {
    '.gateway-diagnostics.jsonl': 0,
    'provider-attempts.jsonl': 1,
    'gateway-summary.json': 2,
    'git.diff': 3,
    'failure.json': 4,
    'result-summary.md': 5,
    'pi-agent-diagnostics.jsonl': 6,
    'pi-events.jsonl': 7,
  };
  return ranks[artifactName] ?? fallback ?? 999;
}

function preAgentValidationTriageRank(artifactName: string, fallback: number | undefined): number {
  const ranks: Record<string, number> = {
    'test-baseline-comparison.json': 0,
    'pre-validation.log': 1,
    'failure.json': 2,
    'result-summary.md': 3,
  };
  return ranks[artifactName] ?? fallback ?? 999;
}

function isLineOrientedArtifact(contentType: string): boolean {
  return contentType.startsWith('text/') || contentType === 'application/x-jsonl' || contentType === 'application/jsonl';
}

function tailArtifactContentByLines(content: string, maxLines: number): string {
  if (maxLines <= 0) {
    return '';
  }
  const hadTrailingNewline = /\r?\n$/.test(content);
  const normalized = hadTrailingNewline ? content.replace(/\r?\n$/, '') : content;
  const lines = normalized.split(/\r?\n/);
  const tailed = lines.length > maxLines ? lines.slice(-maxLines).join('\n') : normalized;
  return hadTrailingNewline && tailed.length > 0 ? `${tailed}\n` : tailed;
}
