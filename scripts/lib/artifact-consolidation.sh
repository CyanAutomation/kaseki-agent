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
