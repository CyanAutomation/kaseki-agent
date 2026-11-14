import * as path from 'node:path';

/** Resolve a run's canonical artifact directory, including restored jobs. */
export function runResultDir(
  job: { id: string; resultDir?: string },
  resultsDir: string,
): string {
  return job.resultDir || path.join(resultsDir, job.id);
}
