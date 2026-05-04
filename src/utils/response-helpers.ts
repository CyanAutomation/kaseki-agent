import { Response } from 'express';
import * as fs from 'fs';
import { ErrorResponse, StatusResponse } from '../kaseki-api-types';

/**
 * Send a standardized error response.
 * Consolidates error response generation across all endpoints.
 */
export function sendErrorResponse(
  res: Response,
  status: number,
  title: string,
  detail: string
): void {
  const response: ErrorResponse = {
    type: 'https://api.kaseki.local/errors#' + title.toLowerCase().replace(/\s+/g, '-'),
    title,
    status,
    detail,
  };

  res.status(status).json(response);
}

/**
 * Build a StatusResponse from job metadata.
 * Consolidates StatusResponse construction logic used in multiple routes.
 */
export function buildStatusResponse(jobData: {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  exitCode?: number | null;
  failureClass?: string | null;
  correlationId?: string;
  requestId?: string;
  error?: string | null;
  resultDir?: string;
}): StatusResponse {
  const response: StatusResponse = {
    id: jobData.id,
    status: jobData.status,
    correlationId: jobData.correlationId,
    requestId: jobData.requestId,
    resultDir: jobData.resultDir,
  };

  // Only include optional fields if they are not null
  if (jobData.exitCode !== null && jobData.exitCode !== undefined) {
    response.exitCode = jobData.exitCode;
  }
  if (jobData.failureClass !== null && jobData.failureClass !== undefined) {
    response.failureClass = jobData.failureClass;
  }
  if (jobData.error !== null && jobData.error !== undefined) {
    response.error = jobData.error;
  }

  return response;
}

/**
 * Send a file response with appropriate headers for artifact delivery.
 * Handles Content-Type detection and streaming.
 */
export function sendFileResponse(
  res: Response,
  filePath: string,
  fileName: string,
  options?: { stream?: boolean }
): void {
  try {
    const stat = fs.statSync(filePath);
    const contentType = detectContentType(fileName);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);

    if (options?.stream) {
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.send(content);
    }
  } catch (error) {
    sendErrorResponse(res, 500, 'Internal Server Error', `Failed to read file: ${fileName}`);
  }
}

/**
 * Detect Content-Type based on file extension.
 * Used for artifact responses.
 */
export function detectContentType(fileName: string): string {
  if (fileName.endsWith('.json')) return 'application/json';
  if (fileName.endsWith('.md')) return 'text/markdown';
  if (fileName.endsWith('.jsonl')) return 'application/x-jsonl';
  if (fileName.endsWith('.diff')) return 'text/plain';
  return 'text/plain';
}

/**
 * Check if a file exists and is non-empty.
 * Used for artifact availability checks.
 */
export function isNonEmptyFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}
