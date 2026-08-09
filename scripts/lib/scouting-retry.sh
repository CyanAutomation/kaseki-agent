#!/bin/bash

# Scouting retry orchestration. This file is sourceable so the retry behavior
# can be exercised with a fake run_scouting_agent implementation.

is_transient_scouting_failure() {
  local exit_code="$1"
  local stderr_content="$2"

  if [ -n "${KASEKI_RESULTS_DIR:-}" ] && [ -f "${KASEKI_RESULTS_DIR}"/scouting-validation-reason.txt ]; then
    local reason_code
    reason_code=$(cat "${KASEKI_RESULTS_DIR}"/scouting-validation-reason.txt 2>/dev/null || echo "")
    case "$reason_code" in
      valid|schema_mismatch|malformed_json|missing_required_fields|missing_file)
        return 1
        ;;
    esac
  fi

  [ "$exit_code" -eq 124 ] && return 0
  case "$exit_code" in
    86|87|88|2) return 1 ;;
  esac
  if echo "$stderr_content" | grep -qi -E "schema|validation|invalid.?json|malformed" 2>/dev/null; then
    return 1
  fi
  if echo "$stderr_content" | grep -qi -E "error|failed|connection|timeout|rate.?limit|api.?error" 2>/dev/null; then
    return 0
  fi
  [ "$exit_code" -ne 0 ] && return 0
  return 1
}


run_scouting_agent_with_retry() {
  local attempt scouting_stderr_capture max_attempts scouting_last_exit scouting_last_stderr
  local scouting_errexit_was_enabled=0

  case $- in
    *e*) scouting_errexit_was_enabled=1 ;;
  esac

  max_attempts="$KASEKI_SCOUTING_MAX_ATTEMPTS"
  attempt=1
  scouting_last_exit=0
  scouting_last_stderr=""

  # Initialize scouting retry tracking env vars
  export KASEKI_SCOUTING_ATTEMPTS=0
  export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=""
  export KASEKI_SCOUTING_ERRORS=""

  while [ "$attempt" -le "$max_attempts" ]; do
    printf '[Scouting Phase] Attempt %d/%d\n' "$attempt" "$max_attempts"
    emit_progress "pi scouting agent" "attempt $attempt/$max_attempts started; required_artifact=$SCOUTING_CANDIDATE_ARTIFACT"

    # Capture stderr for failure classification
    scouting_stderr_capture="/tmp/scouting-stderr-$attempt.log"
    set +e
    export KASEKI_SCOUTING_CONTRACT_STRICT=1
    if [ "$attempt" -gt 1 ]; then
      export KASEKI_SCOUTING_CONTRACT_RETRY=1
      rm -f "$SCOUTING_ARTIFACT" "$SCOUTING_CANDIDATE_ARTIFACT" "$SCOUTING_RAW_EVENTS" 2>/dev/null || true
    else
      unset KASEKI_SCOUTING_CONTRACT_RETRY
    fi
    run_scouting_agent 2>"$scouting_stderr_capture"
    scouting_last_exit=$?
    if [ "$scouting_errexit_was_enabled" -eq 1 ]; then
      set -e
    else
      set +e
    fi

    scouting_last_stderr="$(cat "$scouting_stderr_capture" 2>/dev/null || true)"
    if [ -n "$scouting_last_stderr" ]; then
      {
        printf '[attempt %d exit %d]\n' "$attempt" "$scouting_last_exit"
        printf '%s\n' "$scouting_last_stderr"
      } >> "${KASEKI_RESULTS_DIR}/scouting-stderr.log"
      # PHASE 1 FIX: Check validation errors FIRST (e.g., schema_mismatch)
      # Only fall back to stderr parsing if no validation errors exist
      if ! capture_validation_error_classification "scouting"; then
        capture_provider_error_from_log "${KASEKI_RESULTS_DIR}/scouting-stderr.log" "scouting" || true
      fi
    fi
    rm -f "$scouting_stderr_capture"

    # Success on any attempt
    node - "$attempt" "$scouting_last_exit" "$SCOUTING_CANDIDATE_ARTIFACT" "$SCOUTING_ARTIFACT" "${KASEKI_RESULTS_DIR}/scouting-summary.json" "$SCOUTING_RAW_EVENTS" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [attempt, exitCode, candidateArtifact, finalArtifact, summary, rawEvents] = process.argv.slice(2);
let stats = {};
try { stats = JSON.parse(fs.readFileSync(summary, 'utf8')); } catch {}
let assistantText = '';
const toolNames = new Set();
try {
  for (const line of fs.readFileSync(rawEvents, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    const type = String(event.type || event.event || '');
    const text = event?.message?.content ?? event?.content ?? event?.text ?? '';
    if (/assistant|message_end|text/i.test(type) && typeof text === 'string') assistantText += text;
    const tool = event?.tool?.name ?? event?.toolName ?? event?.name;
    if (/tool/i.test(type) && typeof tool === 'string') toolNames.add(tool);
  }
} catch {}
const preview = assistantText.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);
const candidateExists = fs.existsSync(candidateArtifact);
const finalExists = fs.existsSync(finalArtifact);
const diag = {
  timestamp: new Date().toISOString(), phase: 'scouting', attempt: Number(attempt),
  exit_code: Number(exitCode), artifact_path: candidateArtifact,
  artifact_exists: candidateExists, artifact_bytes: candidateExists ? fs.statSync(candidateArtifact).size : 0,
  finalized_artifact_path: finalArtifact,
  finalized_artifact_exists: finalExists,
  finalized_artifact_bytes: finalExists ? fs.statSync(finalArtifact).size : 0,
  message_end_count: Number(stats.event_counts?.message_end || 0),
  tool_call_count: Number(stats.tool_start_count || 0),
  provider_error_count: Number(stats.inference_health?.provider_error_count || 0),
  assistant_text_chars: assistantText.length,
  assistant_text_preview: preview || undefined,
  tool_names: [...toolNames].slice(0, 20),
};
fs.appendFileSync(process.env.KASEKI_RESULTS_DIR + '/scouting-contract-diagnostics.jsonl', JSON.stringify(diag) + '\n');
NODE

    if [ "$scouting_last_exit" -eq 0 ]; then
      export KASEKI_SCOUTING_ATTEMPTS=$attempt
      export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=$attempt
      # A failed first attempt sets STATUS/FAILED_COMMAND inside
      # run_scouting_agent.  A validated retry is the authoritative outcome;
      # retaining that stale status made successful runs fail at finalization.
      if [ "${FAILED_COMMAND:-}" = "pi scouting agent" ]; then
        STATUS=0
        FAILED_COMMAND=""
      fi
      clear_provider_error
      emit_progress "pi scouting agent" "attempt $attempt/$max_attempts completed; finalized_artifact=$SCOUTING_ARTIFACT"
      return 0
    fi

    # Preserve the rejected provider output and retry decision for postmortem
    # analysis. The primary raw stream is otherwise replaced on retry.
    if [ "$scouting_last_exit" -ne 0 ]; then
      cp "$SCOUTING_RAW_EVENTS" "${KASEKI_RESULTS_DIR}/scouting-attempt-${attempt}-events.jsonl" 2>/dev/null || true
      node - "$attempt" "$scouting_last_exit" "${PROVIDER_ERROR_TYPE:-}" "${PROVIDER_ERROR_MESSAGE:-}" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [attempt, exitCode, errorType, errorMessage] = process.argv.slice(2);
const entry = { timestamp: new Date().toISOString(), phase: 'scouting', attempt: Number(attempt), exit_code: Number(exitCode), error_type: errorType || 'scouting_contract_failure', error_message: errorMessage || 'Scouting attempt failed before producing a valid handoff', raw_events: `scouting-attempt-${attempt}-events.jsonl`, validation_errors: 'scouting-validation-errors.jsonl' };
fs.appendFileSync(process.env.KASEKI_RESULTS_DIR + '/scouting-retry-diagnostics.jsonl', JSON.stringify(entry) + '\n');
NODE
    fi

    if [ "${SCOUTING_EXIT:-0}" -eq 86 ] || [ "${STATUS:-0}" -eq 86 ]; then
      # Contract failures can be reported either against the candidate file
      # itself or against a field within the candidate (for example,
      # `requirements` or `observations`).  Restricting recovery to the
      # filename left schema failures unrecoverable even though a conservative
      # patch fallback is valid for them.
      local has_scouting_contract_failure=0
      if node - "${KASEKI_RESULTS_DIR}/scouting-validation-errors.jsonl" <<'NODE' >/dev/null 2>&1
const fs = require('node:fs');
const file = process.argv[2];
try {
  const entries = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const contractFailure = entries.some((entry) => [
    'missing_file', 'malformed_json', 'schema_mismatch', 'schema_validation_failed',
    'schema_type_mismatch', 'invalid_candidate', 'readonly_filesystem',
    // A normalized candidate that still exits 86 must be retried or use the
    // patch fallback.  The original validator detail is ephemeral, while this
    // durable record is the only evidence available to the retry loop.
    'schema_normalized',
  ].includes(String(entry.reason_code || '')) || String(entry.field || '').includes('scouting-candidate.json'));
  process.exit(contractFailure ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
      then
        has_scouting_contract_failure=1
      fi
      if [ "$attempt" -lt "$max_attempts" ] && [ "$has_scouting_contract_failure" -eq 1 ]; then
        printf '[Scouting Phase] Artifact contract failure (exit 86), retrying with explicit write instructions\n'
        attempt=$((attempt + 1))
        rm -f "$SCOUTING_ARTIFACT" "$SCOUTING_RAW_EVENTS" "${KASEKI_RESULTS_DIR}/scouting-validation-reason.txt" 2>/dev/null || true
        continue
      fi
      # Both attempts have received the explicit artifact-write contract.  For
      # patch runs, retain the failure evidence but use the conservative,
      # validated fallback rather than failing before coding can start.
      if [ "$KASEKI_TASK_MODE" = "patch" ] && [ "$has_scouting_contract_failure" -eq 1 ]; then
        rm -f "$SCOUTING_CANDIDATE_ARTIFACT" "$SCOUTING_ARTIFACT" 2>/dev/null || true
        write_scouting_fallback_artifact "$SCOUTING_CANDIDATE_ARTIFACT"
        if validate_scouting_artifact "$SCOUTING_CANDIDATE_ARTIFACT" "$SCOUTING_ARTIFACT" "${KASEKI_RESULTS_DIR}/scouting-validation-reason.txt"; then
          mark_scouting_fallback_recovered "patch_retry_exhausted_fallback_recovered"
          printf '[Scouting Phase] Artifact contract exhausted; validated conservative patch fallback and continuing\n'
          export KASEKI_SCOUTING_ATTEMPTS=$attempt
          export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT="fallback"
          STATUS=0
          SCOUTING_EXIT=0
          clear_provider_error
          return 0
        fi
      fi
      printf '[Scouting Phase] Deterministic validation failure (exit 86), not retrying\n'
      export KASEKI_SCOUTING_ATTEMPTS=$attempt
      export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=""
      return 86
    fi

    # Check if this is a transient failure worth retrying
    if is_transient_scouting_failure "$scouting_last_exit" "$scouting_last_stderr"; then
      if [ "$attempt" -lt "$max_attempts" ]; then
        printf '[Scouting Phase] Transient failure detected (exit %d), retrying immediately...\n' "$scouting_last_exit"
        attempt=$((attempt + 1))
        # Reset scouting artifacts for retry
        rm -f "$SCOUTING_ARTIFACT" "$SCOUTING_RAW_EVENTS" 2>/dev/null || true
        # Clean up validation reason file from previous attempt
        rm -f "${KASEKI_RESULTS_DIR}"/scouting-validation-reason.txt 2>/dev/null || true
        continue
      fi
    else
      # Deterministic failure - do not retry
      printf '[Scouting Phase] Deterministic failure (exit %d), not retrying\n' "$scouting_last_exit"
      export KASEKI_SCOUTING_ATTEMPTS=$attempt
      export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=""
      return "$scouting_last_exit"
    fi

    # Fallthrough to next attempt
    attempt=$((attempt + 1))
  done

  # Max attempts exhausted
  export KASEKI_SCOUTING_ATTEMPTS=$max_attempts
  export KASEKI_SCOUTING_SUCCEEDED_ON_ATTEMPT=""
  printf '[Scouting Phase] Max retry attempts exhausted (exit %d)\n' "$scouting_last_exit"
  return "$scouting_last_exit"
}
