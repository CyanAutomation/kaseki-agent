/**
 * Type definitions for kaseki metadata.json structure
 */

export interface KasekiMetadata {
  schema_version?: string;
  instance?: string;
  instance_name?: string;
  repo_url?: string;
  repo?: string;
  git_ref?: string;
  ref?: string;
  provider?: string;
  model?: string;
  actual_model?: string;
  started_at?: string;
  start_time?: string;
  ended_at?: string;
  end_time?: string;
  duration_seconds?: number;
  pi_duration_seconds?: number;
  exit_code?: number | string;
  status?: string;
  current_stage?: string;
  pi_exit_code?: number | string;
  failed_command?: string;
  validation_exit_code?: number | string;
  validation_failed_command?: string;
  validation_fail_fast_mode?: boolean;
  validation_stopped_early?: boolean;
  validation_commands_attempted?: number;
  quality_exit_code?: number | string;
  secret_scan_exit_code?: number | string;
  pi_version?: string;
  diff_nonempty?: boolean;

  // Phase consolidation (schema v2.0)
  phases?: {
    validation?: ValidationPhase;
    quality_gates?: QualityGatesPhase;
    secret_scan?: SecretScanPhase;
  };

  [key: string]: any;
}

export interface ValidationPhase {
  exit_code: number;
  commands_attempted?: number;
  stopped_early?: boolean;
  results?: Array<{
    command: string;
    exit_code: number;
    duration_seconds: number;
    status: string;
  }>;
}

export interface QualityGatesPhase {
  exit_code: number;
  violations?: Array<{
    type: string;
    detail: string;
    severity: string;
    timestamp: string;
  }>;
}

export interface SecretScanPhase {
  exit_code: number;
  matches?: Array<{
    file: string;
    pattern: string;
    status: string;
    timestamp: string;
  }>;
}
