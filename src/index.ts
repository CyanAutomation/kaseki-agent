// Kaseki Agent TypeScript Entry Point
// Public API exports for library users and service consumers

// Services
export { JobScheduler } from './job-scheduler';
export { ResultCache } from './result-cache';
export { WebhookManager } from './webhook-manager';

// Configuration & Utilities
export { KasekiApiConfig, validateApiKey, loadConfig } from './kaseki-api-config';
export { createGracefulShutdown, assertSupportedNodeVersion } from './kaseki-api-service';

// Types
export type {
  Job,
  RunRequest,
  RunResponse,
  StatusResponse,
  LogResponse,
  ArtifactResponse,
  RunsListResponse,
  ErrorResponse,
  ValidationResponse,
  PreflightCheck,
  PreflightResponse,
  AnalysisResponse,
  WebhookPayload,
  WebhookEventType,
} from './kaseki-api-types';

// Client
export { KasekiApiClient } from './kaseki-api-client';

// Utilities (Phase 1 extractions)
export { sendErrorResponse, buildStatusResponse, detectContentType, isNonEmptyFile } from './utils/response-helpers';
export {
  isNonEmptyFile as fileIsNonEmpty,
  readFirstLine,
  readTailLines,
  commandOutput,
  fileExists,
  readFileContent,
  getFileStats,
} from './utils/file-helpers';
export { jobLookupMiddleware } from './middleware/job-lookup';

// Utilities (Phase 2 consolidations)
export {
  createJobSubmittedEvent,
  createJobStartedEvent,
  createJobCompletedEvent,
  createJobCancelledEvent,
  createJobFailedEvent,
} from './utils/webhook-event-builder';
export { HttpClientFactory } from './utils/http-client-factory';
export type { HttpRequestOptions, RetryConfig } from './utils/http-client-factory';

// Route modules (Phase 3 refactoring)
export { createStatusRoutes } from './routes/status-routes';
export { createLogRoutes } from './routes/log-routes';
export { createArtifactRoutes, readArtifactContent } from './routes/artifact-routes';
export { createWebhookRoutes } from './routes/webhook-routes';
