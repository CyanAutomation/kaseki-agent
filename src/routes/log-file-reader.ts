// Re-export public API from specialized modules for backward compatibility
export { logFileForType, isPathInsideDirectory, readLogContent } from './log-reader';
export { redactLogContent } from './log-redaction';
export { readCombinedLogs, collectDiagnostics } from './log-combiner';

// Backward-compatibility: VALID_LOG_TYPES exported for existing consumers
export const VALID_LOG_TYPES = [
  'stdout', 'stderr', 'validation', 'progress', 'quality', 'secret-scan', 'combined',
  'goal-setting-stderr', 'scouting-stderr', 'goal-check-stderr', 'run-evaluation-stderr',
] as const;
