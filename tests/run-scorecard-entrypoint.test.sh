#!/usr/bin/env bash
# Packaging contract regression test for the executable alias (GitHub issue #1178).
# Scoring permutations belong in src/run-scorecard*.test.ts; this test only proves
# that the packaged alias executes and turns representative metadata into JSON.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-run-scorecard.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/metadata.json" <<'JSON'
{
  "instance": "packaged-alias-fixture",
  "started_at": "2026-08-11T10:00:00.000Z",
  "ended_at": "2026-08-11T10:02:03.000Z",
  "exit_code": 0,
  "quality_exit_code": 0,
  "validation_exit_code": 0,
  "total_duration_seconds": 123
}
JSON
ln -s "$ROOT_DIR/dist/run-scorecard.js" "$TMP_DIR/kaseki-run-scorecard"

set +e
KASEKI_RESULTS_DIR="$TMP_DIR" "$TMP_DIR/kaseki-run-scorecard"
scorecard_status=$?
set -e

test "$scorecard_status" -eq 0
test -s "$TMP_DIR/run-scorecard.json"

node - "$TMP_DIR/run-scorecard.json" <<'NODE'
const fs = require('node:fs');

const scorecard = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(scorecard.schema_version === '1.0', 'schema_version must identify the packaged contract');
assert(typeof scorecard.rubric_version === 'string' && scorecard.rubric_version.length > 0, 'rubric_version must be a non-empty string');
assert(scorecard.run_id === 'packaged-alias-fixture', 'run_id must come from metadata.instance');
assert(scorecard.started_at === '2026-08-11T10:00:00.000Z', 'started_at must come from metadata');
assert(scorecard.ended_at === '2026-08-11T10:02:03.000Z', 'ended_at must come from metadata');
assert(typeof scorecard.scored_at === 'string' && !Number.isNaN(Date.parse(scorecard.scored_at)), 'scored_at must be an ISO date string');
assert(scorecard.lifecycle_status === 'completed', 'zero exit_code must produce completed lifecycle status');
assert(typeof scorecard.overall_score === 'number', 'overall_score must be numeric');
assert(typeof scorecard.grade === 'string', 'grade must be a string');
assert(typeof scorecard.evidence_coverage === 'object' && scorecard.evidence_coverage !== null, 'evidence_coverage must be an object');
assert(typeof scorecard.evidence_coverage.ratio === 'number', 'evidence coverage ratio must be numeric');
assert(typeof scorecard.confidence?.score === 'number', 'confidence score must be numeric');
assert(Array.isArray(scorecard.dimensions) && scorecard.dimensions.length === 6, 'all score dimensions must be present');
assert(typeof scorecard.phases === 'object' && scorecard.phases !== null, 'phases must be an object');
assert(scorecard.timing_totals?.wall_clock_ms === 123000, 'wall-clock milliseconds must derive from metadata duration');
assert(scorecard.timing_totals?.completeness === 'complete', 'metadata duration must provide complete timing evidence');
assert(scorecard.token_totals?.unavailable === true, 'missing token evidence must be explicitly unavailable');
assert(typeof scorecard.scoring_config === 'object' && scorecard.scoring_config !== null, 'scoring_config must be an object');
assert(Array.isArray(scorecard.warnings), 'warnings must be an array');
NODE

printf '✓ Packaged scorecard entrypoint alias generated and validated an artifact.\n'
