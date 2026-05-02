import { z } from 'zod';

/**
 * Request to trigger a new kaseki run.
 */
export const RunRequestSchema = z.object({
  repoUrl: z.string().url('Repository URL must be valid').describe('Git repository URL'),
  ref: z.string().min(1).default('main').describe('Git branch/tag/commit'),
  taskPrompt: z.string().min(10).optional().describe('Task prompt for Pi agent'),
  changedFilesAllowlist: z.array(z.string()).optional().describe('Space-separated file patterns'),
  maxDiffBytes: z.number().int().positive().optional().describe('Max diff size in bytes'),
  validationCommands: z.array(z.string()).optional().describe('Validation commands to run'),
  taskMode: z.enum(['patch', 'inspect']).optional().describe('Task mode: patch or inspect'),
});

export type RunRequest = z.infer<typeof RunRequestSchema>;

/**
 * Response after triggering a run.
 */
export interface RunResponse {
  id: string; // kaseki-<uuidv4> instance ID
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string; // ISO 8601
  error?: string;
}

/**
 * Status poll response.
 */
export interface StatusResponse {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: string;
  elapsedSeconds?: number;
  timeoutRiskPercent?: number;
  exitCode?: number;
  failureClass?: string;
  error?: string;
}

/**
 * Log retrieval response.
 */
export interface LogResponse {
  logType: 'stdout' | 'stderr' | 'validation' | 'progress' | 'quality' | 'secret-scan';
  content: string;
  size: number;
}

/**
 * Artifact download response.
 */
export interface ArtifactResponse {
  file: string;
  contentType: string;
  size: number;
  content?: string; // For text artifacts
  url?: string; // For large artifacts, provide signed URL
}

/**
 * Run analysis response (comprehensive summary).
 */
export interface AnalysisResponse {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  elapsedSeconds?: number;
  exitCode?: number;
  failureClass?: string;
  metadata?: {
    model?: string;
    instance?: string;
    repo?: string;
    ref?: string;
  };
  changes?: {
    changedFiles: string[];
    diffSize: number;
  };
  validation?: {
    passed: boolean;
    commandResults: Array<{
      command: string;
      exitCode: number;
      elapsed: number;
    }>;
  };
  errors?: string[];
}

/**
 * List runs response.
 */
export interface RunsListResponse {
  runs: Array<{
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    createdAt: string;
    completedAt?: string;
  }>;
  total: number;
}

/**
 * Error response (RFC 7807 Problem Details).
 */
export interface ErrorResponse {
  type: string; // e.g., 'https://api.kaseki.local/errors#unauthorized'
  title: string; // e.g., 'Unauthorized'
  status: number;
  detail: string;
  instance?: string; // Run ID if applicable
}

/**
 * Internal job representation.
 */
export interface Job {
  id: string; // kaseki-<uuidv4> instance ID
  status: 'queued' | 'running' | 'completed' | 'failed';
  request: RunRequest;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  exitCode?: number;
  failureClass?: string;
  error?: string;
  processId?: number;
  timeout?: NodeJS.Timeout;
  finalized?: boolean;
}
