import path from 'node:path';
import { collectEvidence } from './run-scorecard-evidence';
import { normalizeConfig } from './run-scorecard-config';
import { buildScorecard } from './run-scorecard-scoring';
import { readArtifactSnapshot, writeAtomic } from './run-scorecard-io';

export function main(): void {
  const dir = process.env.KASEKI_RESULTS_DIR ?? process.argv[2];
  if (!dir) throw new Error('KASEKI_RESULTS_DIR or results directory argument is required');
  const snapshot = readArtifactSnapshot(dir);
  if (!snapshot.json['metadata.json'] && !snapshot.text['stage-timings.tsv']) throw new Error('insufficient metadata or timing evidence');
  writeAtomic(path.join(dir, 'run-scorecard.json'), buildScorecard(collectEvidence(snapshot), normalizeConfig(process.env)));
}
