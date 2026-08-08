#!/usr/bin/env node
import path from 'node:path';
import { main } from './run-scorecard-cli';

export { DEFAULT_RUBRIC_VERSION, normalizeConfig } from './run-scorecard-config';
export type { ScorecardConfig } from './run-scorecard-config';
export { collectEvidence } from './run-scorecard-evidence';
export type { ArtifactSnapshot, Evidence } from './run-scorecard-evidence';
export { assignGrade, buildScorecard, calculateCoverage } from './run-scorecard-scoring';
export { readArtifactSnapshot, writeAtomic } from './run-scorecard-io';
export { main } from './run-scorecard-cli';

const entrypoint = process.argv[1] ? path.basename(process.argv[1]) : '';

if (['run-scorecard.js', 'run-scorecard.ts', 'kaseki-run-scorecard', 'kaseki-run-scorecard.js'].includes(entrypoint)) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ level: 'warning', code: 'scorecard_generation_failed', message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
