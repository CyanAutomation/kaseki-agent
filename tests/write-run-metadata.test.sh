#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-metadata-write.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

candidate="$TMP_DIR/candidate.json"
output="$TMP_DIR/metadata.json"
diagnostic="$TMP_DIR/metadata-write-error.json"

node - "$candidate" <<'NODE'
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], JSON.stringify({
  schema_version: '2.0',
  instance: 'run "one"\n🪨',
  failed_command: 'goal check',
  detail: 'quote: "; newline:\n; unicode: 🪨',
}));
NODE

fallback="$(node -e 'process.stdout.write(JSON.stringify({schema_version:"2.0",instance:process.argv[1],task_mode:"patch",status:8,exit_code:8,failed_command:"goal check",started_at:"2026-09-23T19:20:54Z",ended_at:"2026-09-23T20:21:14Z",duration_seconds:3620,worker_error_type:"",worker_error_phase:"",worker_error_message:"",validation_exit_code:0,validation_commands_attempted:0,goal_check_attempts:1,goal_check_met:true,critical_change_failure_reason:"required evidence missing",baseline_setup_failure_reason:"dependency_install_failed"}))' $'run "one"\n🪨')"

node "$ROOT_DIR/scripts/write-run-metadata.mjs" "$candidate" "$output" "$diagnostic" "$fallback"
node - "$output" "$diagnostic" <<'NODE'
const fs = require('node:fs');
const [metadataPath, diagnosticPath] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
if (metadata.instance !== 'run "one"\n🪨' || metadata.detail !== 'quote: "; newline:\n; unicode: 🪨') {
  throw new Error(`valid metadata lost escaped text: ${JSON.stringify(metadata)}`);
}
if (fs.existsSync(diagnosticPath)) throw new Error('successful serialization emitted a failure diagnostic');
NODE

printf '%s\n' '{"instance":"discard-me","detail":"PRIVATE_INVALID_PAYLOAD",' > "$candidate"
node "$ROOT_DIR/scripts/write-run-metadata.mjs" "$candidate" "$output" "$diagnostic" "$fallback"

node - "$output" "$diagnostic" "$TMP_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [metadataPath, diagnosticPath, directory] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const diagnostic = JSON.parse(fs.readFileSync(diagnosticPath, 'utf8'));
if (metadata.instance !== 'run "one"\n🪨' || metadata.exit_code !== 8 || metadata.failed_command !== 'goal check') {
  throw new Error(`fallback did not preserve root failure and timestamps: ${JSON.stringify(metadata)}`);
}
if (metadata.started_at !== '2026-09-23T19:20:54Z' || metadata.ended_at !== '2026-09-23T20:21:14Z' || metadata.duration_seconds !== 3620) {
  throw new Error('fallback did not preserve original run timing');
}
if (metadata.goal_check_attempts !== 1 || metadata.goal_check_met !== true || metadata.critical_change_failure_reason !== 'required evidence missing') {
  throw new Error('fallback did not preserve goal-check and critical-change diagnostics');
}
if (metadata.baseline_setup_failure_reason !== 'dependency_install_failed') {
  throw new Error('fallback did not preserve baseline setup diagnostics');
}
if (metadata.worker_error_type || metadata.metadata_write_error?.reason_code !== 'metadata_write_invalid') {
  throw new Error('serialization error overwrote the root worker classification');
}
if (diagnostic.reason_code !== 'metadata_write_invalid' || !/^[a-f0-9]{64}$/.test(diagnostic.candidate_sha256)) {
  throw new Error(`missing structured serializer diagnostic: ${JSON.stringify(diagnostic)}`);
}
const serializedDiagnostic = JSON.stringify(diagnostic);
if (serializedDiagnostic.includes('PRIVATE_INVALID_PAYLOAD')) throw new Error('invalid raw metadata was copied into diagnostics');
if (fs.readdirSync(directory).some(file => /metadata\.json\.tmp/.test(file))) throw new Error('temporary metadata file was left behind');
NODE

printf '✓ Metadata serializer preserves valid fields and writes a safe, atomic diagnostic fallback.\n'
