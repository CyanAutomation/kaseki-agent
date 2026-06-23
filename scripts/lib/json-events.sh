#!/usr/bin/env bash
# Sourceable JSONL event helper functions for shell scripts.

json_object_from_pairs() {
  jq -cn '$ARGS.positional
    | map(capture("^(?<key>[^=]*)=(?<value>(.|\n)*)$"))
    | reduce .[] as $item ({}; if $item.key == "" then . else .[$item.key] = $item.value end)' --args "$@"
}

append_jsonl_object() {
  local output_file="$1"
  shift
  json_object_from_pairs "$@" >> "$output_file"
}

emit_progress() {
  local stage="$1"
  local detail="$2"
  local status="${3:-info}"
  append_jsonl_object "${KASEKI_RESULTS_DIR}"/progress.jsonl \
    "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "component=kaseki-agent" \
    "stage=$stage" \
    "status=$status" \
    "instance=$INSTANCE_NAME" \
    "detail=$detail"
  :
}

emit_event() {
  local event_type="$1"
  shift
  append_jsonl_object "${KASEKI_RESULTS_DIR}"/progress.jsonl \
    "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "component=kaseki-agent" \
    "event_type=$event_type" \
    "instance=$INSTANCE_NAME" \
    "$@"
}
