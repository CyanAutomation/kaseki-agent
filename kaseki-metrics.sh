#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <stage-timings.tsv> <metadata.json> [output.json]" >&2
  exit 2
fi

STAGE_TIMINGS_FILE="$1"
METADATA_FILE="$2"
OUTPUT_FILE="${3:-}"

metrics_json="$(python3 - "$STAGE_TIMINGS_FILE" "$METADATA_FILE" <<'PY'
import json
import sys
from collections import OrderedDict

stage_path = sys.argv[1]
metadata_path = sys.argv[2]

try:
    with open(metadata_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)
except (FileNotFoundError, PermissionError, json.JSONDecodeError) as e:
    print(f"Error reading metadata: {e}", file=sys.stderr)
    sys.exit(1)

success = 0
failure = 0
stage_count = 0
stage_duration_seconds = OrderedDict()

try:
    with open(stage_path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            stage = parts[0]
            exit_raw = parts[1].strip()
            duration_raw = parts[2].strip()

            try:
                exit_code = int(exit_raw)
            except ValueError:
                continue

            try:
                duration = float(duration_raw)
            except ValueError:
                duration = 0.0

            stage_count += 1
            if exit_code == 0:
                success += 1
            else:
                failure += 1

            stage_duration_seconds[stage] = round(stage_duration_seconds.get(stage, 0.0) + duration, 6)
except (FileNotFoundError, PermissionError) as e:
    print(f"Error reading stage timings: {e}", file=sys.stderr)
    sys.exit(1)

total_runtime = metadata.get("total_duration_seconds")
if total_runtime is None:
    total_runtime = metadata.get("duration_seconds")
if total_runtime is None:
    total_runtime = 0

result = {
    "schema_version": "kaseki.metrics.v1",
    "instance": metadata.get("instance"),
    "repo_url": metadata.get("repo_url"),
    "git_ref": metadata.get("git_ref"),
    "provider": metadata.get("provider"),
    "model": metadata.get("model"),
    "exit_code": metadata.get("exit_code"),
    "started_at": metadata.get("started_at"),
    "finished_at": metadata.get("finished_at"),
    "current_stage": metadata.get("current_stage"),
    "failed_command": metadata.get("failed_command"),
    "stage_counters": {
        "total": stage_count,
        "success": success,
        "failure": failure,
    },
    "stage_duration_seconds": stage_duration_seconds,
    "total_runtime_seconds": total_runtime,
}

print(json.dumps(result, separators=(",", ":"), sort_keys=False))
PY
)"

if [ -n "$OUTPUT_FILE" ]; then
  mkdir -p "$(dirname "$OUTPUT_FILE")"
  if ! printf '%s\n' "$metrics_json" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), indent=2, sort_keys=False))' > "$OUTPUT_FILE"; then
    echo "Error: Failed to write metrics to $OUTPUT_FILE" >&2
    exit 1
  fi
fi

printf '%s\n' "$metrics_json"
