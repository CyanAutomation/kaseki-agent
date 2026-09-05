import type { RunScorecard } from './types/run-scorecard';

export interface ArtifactSnapshot {
  json: Record<string, unknown>;
  text: Record<string, string>;
  summaries: unknown[];
}

export interface Evidence {
  metadata: Record<string, unknown>;
  status: RunScorecard['lifecycle_status'];
  elapsedSeconds?: number;
  tokens?: number;
  tokenUsage: RunScorecard['token_totals'];
  phaseTokens: Record<string, RunScorecard['token_totals']>;
  unknownTokenRequests: number;
  retries: number;
  phaseRetries: Record<string, number>;
  phaseDurationsMs: Record<string, number>;
  validation: 'passed' | 'failed' | 'unknown';
  quality: 'passed' | 'failed' | 'unknown';
  goalMet?: boolean;
  goalCheckAvailable: boolean;
  goalCheckFailed: boolean;
  changedFiles: number;
  diffBytes: number;
  evaluation?: Record<string, unknown>;
  evaluatorAvailable: boolean;
  present: string[];
}
