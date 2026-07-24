#!/bin/bash

# Persist a completed phase's summary before orchestration advances to the next
# phase (or begins finalization).
consolidate_completed_phase() {
  local output_file="$1"
  local phase_name="$2"
  local summary_file="$3"

  if [ ! -f "$summary_file" ]; then
    return 0
  fi

  jq \
    --slurpfile phase_data "$summary_file" \
    --arg phase "$phase_name" \
    '.phases += [($phase_data[0] + {"phase": $phase})]' \
    "$output_file" > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
}

consolidate_timings_to_json() {
  local output_file="$1"
  local validation_timings="${2:-${KASEKI_RESULTS_DIR}/validation-timings.tsv}"
  local pre_validation_timings="${3:-${KASEKI_RESULTS_DIR}/pre-validation-timings.tsv}"
  local stage_timings="${4:-${KASEKI_RESULTS_DIR}/stage-timings.tsv}"

  if [ ! -f "$output_file" ]; then
    printf '{"validation_timings": [], "pre_validation_timings": [], "stage_timings": []}\n' > "$output_file"
  fi

  local validation_json pre_validation_json stage_json
  if [ -s "$validation_timings" ]; then
    validation_json=$(tail -n +2 "$validation_timings" | jq -R 'split("\t") | {command: .[0], elapsed_seconds: (.[1] | tonumber)}' | jq -s '.' 2>/dev/null)
    [ -n "$validation_json" ] && jq --argjson data "$validation_json" '.validation_timings = $data' "$output_file" > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
  fi
  if [ -s "$pre_validation_timings" ]; then
    pre_validation_json=$(tail -n +2 "$pre_validation_timings" | jq -R 'split("\t") | {command: .[0], elapsed_seconds: (.[1] | tonumber)}' | jq -s '.' 2>/dev/null)
    [ -n "$pre_validation_json" ] && jq --argjson data "$pre_validation_json" '.pre_validation_timings = $data' "$output_file" > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
  fi
  if [ -s "$stage_timings" ]; then
    # Current runner rows are stage, exit_code, elapsed_seconds, details. Keep
    # accepting the former two-column format so historical artifacts remain readable.
    stage_json=$(tail -n +2 "$stage_timings" | jq -R 'split("\t") | if length >= 4 then {stage: .[0], exit_code: (.[1] | tonumber), elapsed_seconds: (.[2] | tonumber), details: .[3]} elif length >= 3 then {stage: .[0], exit_code: (.[1] | tonumber), elapsed_seconds: (.[2] | tonumber), details: ""} else {stage: .[0], elapsed_seconds: (.[1] | tonumber)} end' | jq -s '.' 2>/dev/null)
    [ -n "$stage_json" ] && jq --argjson data "$stage_json" '.stage_timings = $data' "$output_file" > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
  fi
}

# The Pi event filter writes a summary for the most recently executed phase.
# Reconcile it with the durable attempt manifest so the run-level artifact does
# not erase retried provider errors from earlier phases.
reconcile_gateway_summary() {
  local summary_file="$1"
  local attempts_file="$2"
  [ -s "$summary_file" ] && [ -s "$attempts_file" ] || return 0

  local attempts errors
  attempts=$(jq -s 'map(select(type == "object"))' "$attempts_file" 2>/dev/null) || return 0
  errors=$(printf '%s' "$attempts" | jq '[.[] | select(.error != null)]') || return 0

  if jq --argjson attempts "$attempts" --argjson errors "$errors" '
    .provider_attempt_count = ($attempts | length)
    | .provider_errors = ($errors | length)
    | .provider_error_history = $errors
    | .primary_provider_error = ($errors[0].error // .primary_provider_error // null)
    | .inference_health = (.inference_health // {})
    | .inference_health.provider_error_count = ($errors | length)
    | .inference_health.had_provider_error = (($errors | length) > 0)
    | .inference_health.agent_turn_success = ((.inference_health.agent_turn_success // true) and (($errors | length) == 0))
  ' "$summary_file" > "${summary_file}.tmp"; then
    mv "${summary_file}.tmp" "$summary_file"
  else
    rm -f "${summary_file}.tmp"
    return 1
  fi
}

consolidate_phase_errors() {
  local output_file="$1"
  shift
  : > "$output_file"

  local stderr_file phase_name
  for stderr_file in "$@"; do
    if [ -s "$stderr_file" ]; then
      phase_name=$(basename "$stderr_file" -stderr.log)
      while IFS= read -r line || [ -n "$line" ]; do
        jq -cn --arg phase "$phase_name" --arg msg "$line" '{phase: $phase, message: $msg, timestamp: (now | todate)}' >> "$output_file"
      done < "$stderr_file"
    fi
  done
}

consolidate_validation_errors() {
  local output_file="$1"
  shift
  : > "$output_file"

  local error_file phase_name
  for error_file in "$@"; do
    if [ -s "$error_file" ]; then
      phase_name=$(basename "$error_file" -validation-errors.jsonl)
      while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] && continue
        jq -c --arg phase "$phase_name" '. + {phase: $phase}' <<< "$line" >> "$output_file" 2>/dev/null || true
      done < "$error_file"
    fi
  done
}

# Consolidate the externally visible run artifacts, then publish terminal status.
# The status writer is deliberately invoked last so consumers never observe a
# terminal status alongside partially consolidated artifacts.
finalize_artifacts_and_publish_status() {
  local results_dir="$1"
  local status_writer="$2"
  local status="$3"
  local validation_timings="${4:-$results_dir/validation-timings.tsv}"
  local pre_validation_timings="${5:-$results_dir/pre-validation-timings.tsv}"

  consolidate_timings_to_json "$results_dir/timings-manifest.json" "$validation_timings" "$pre_validation_timings" "$results_dir/stage-timings.tsv"
  consolidate_phase_errors "$results_dir/phase-errors.jsonl" "$results_dir/critical-change-expectations.log" "$results_dir/summarizer-stderr.log" "$results_dir/baseline-npm-ci.log"
  consolidate_validation_errors "$results_dir/artifact-validation-errors.jsonl" "$results_dir/scouting-validation-errors.jsonl" "$results_dir/goal-setting-validation-errors.jsonl" "$results_dir/goal-check-validation-errors.jsonl"
  reconcile_gateway_summary "$results_dir/gateway-summary.json" "$results_dir/provider-attempts.jsonl" || {
    echo "Warning: Failed to reconcile gateway summary" >&2
  }
  "$status_writer" "$status"
}
