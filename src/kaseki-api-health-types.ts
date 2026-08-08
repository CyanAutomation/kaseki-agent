export const TEMPLATE_REMEDIATION =
  'Run scripts/kaseki-activate.sh --controller bootstrap.';
export const DEFAULT_TEMPLATE_DOCTOR_TIMEOUT_MS = 15000;
export const DEFAULT_TEMPLATE_HEALTH_CACHE_TTL_MS = 60_000;
export const TEMPLATE_DOCTOR_STDERR_TAIL_LINES = 25;
export const TEMPLATE_DOCTOR_STDOUT_TAIL_LINES = 25;
export const REQUIRED_TEMPLATE_FILES = [
  'run-kaseki.sh', 'kaseki-agent.sh', 'scripts/kaseki-activate.sh',
  'scripts/kaseki-preflight.sh', 'lib/pi-event-filter.js', 'lib/pi-progress-stream.js',
  'lib/kaseki-report.js', 'lib/github-app-token.js', 'lib/github-app-private-key.js',
  'lib/github-utils.js', 'lib/logger.js', 'lib/secrets/host-secrets-reader.js',
] as const;

export interface TemplateHealthStatus {
  ok: boolean;
  templateDir: string;
  runScript: string;
  checkoutDir: string;
  checkoutRef?: string;
  doctorCommand?: string;
  doctorExitCode?: number | null;
  doctorSignal?: NodeJS.Signals | null;
  doctorStderrTail?: string;
  doctorStdoutTail?: string;
  detail: string;
  remediation?: string;
}

export interface FreshnessStatus {
  ok: boolean;
  stale: boolean;
  checkoutDir: string;
  localRef?: string;
  remoteRef?: string;
  remoteUrl?: string;
  detail: string;
  remediation?: string;
}

export interface TemplatePublishModeCompatibility {
  ok: boolean;
  metadataPath: string;
  supportedPublishModes?: string[];
  detail?: string;
  remediation?: string;
}
