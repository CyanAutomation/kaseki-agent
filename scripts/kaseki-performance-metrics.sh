#!/usr/bin/env bash
# kaseki-performance-metrics.sh
# Analyzes stage timings and generates performance benchmarks
#
# Reads the stage-timings.tsv file and generates a performance report
# in JSON format with summary statistics and percentiles
#
# Usage: kaseki-performance-metrics.sh <stage_timings_tsv> [output_json]
# Default output: /results/performance-metrics.json

set -euo pipefail

STAGE_TIMINGS_FILE="${1:-/results/stage-timings.tsv}"
OUTPUT_FILE="${2:-/results/performance-metrics.json}"

if [ ! -f "$STAGE_TIMINGS_FILE" ]; then
  echo '{"error": "stage-timings.tsv not found"}' > "$OUTPUT_FILE"
  exit 1
fi

# Parse stage timings and calculate metrics
TOTAL_TIME=0
STAGE_COUNT=0
declare -a DURATIONS

while IFS=$'\t' read -r stage _exit_code duration _detail; do
  [ -z "$stage" ] && continue
  [ -z "$duration" ] && continue
  
  DURATIONS+=("$duration")
  TOTAL_TIME=$((TOTAL_TIME + duration))
  STAGE_COUNT=$((STAGE_COUNT + 1))
done < "$STAGE_TIMINGS_FILE"

# Calculate statistics
if [ "$STAGE_COUNT" -eq 0 ]; then
  cat > "$OUTPUT_FILE" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "total_stages": 0,
  "total_duration_seconds": 0,
  "average_stage_duration_seconds": 0,
  "status": "no_data"
}
EOF
  exit 0
fi

AVG_DURATION=$((TOTAL_TIME / STAGE_COUNT))

# Sort durations for percentile calculation
mapfile -t sorted_durations < <(printf '%s\n' "${DURATIONS[@]}" | sort -n)

# Calculate percentiles
P50_INDEX=$((STAGE_COUNT * 50 / 100))
P90_INDEX=$((STAGE_COUNT * 90 / 100))
P95_INDEX=$((STAGE_COUNT * 95 / 100))
P99_INDEX=$((STAGE_COUNT * 99 / 100))

# Handle edge cases
[ $P50_INDEX -eq 0 ] && P50_INDEX=0
[ $P90_INDEX -ge $STAGE_COUNT ] && P90_INDEX=$((STAGE_COUNT - 1))
[ $P95_INDEX -ge $STAGE_COUNT ] && P95_INDEX=$((STAGE_COUNT - 1))
[ $P99_INDEX -ge $STAGE_COUNT ] && P99_INDEX=$((STAGE_COUNT - 1))

P50="${sorted_durations[$P50_INDEX]:-0}"
P90="${sorted_durations[$P90_INDEX]:-0}"
P95="${sorted_durations[$P95_INDEX]:-0}"
P99="${sorted_durations[$P99_INDEX]:-0}"

MIN_DURATION="${sorted_durations[0]:-0}"
MAX_DURATION="${sorted_durations[$((STAGE_COUNT - 1))]:-0}"

# Determine performance rating
if [ "$TOTAL_TIME" -lt 300 ]; then
  RATING="Excellent"
elif [ "$TOTAL_TIME" -lt 600 ]; then
  RATING="Good"
elif [ "$TOTAL_TIME" -lt 1200 ]; then
  RATING="Acceptable"
else
  RATING="Slow"
fi

# Generate output JSON
mkdir -p "$(dirname "$OUTPUT_FILE")"
cat > "$OUTPUT_FILE" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "summary": {
    "total_stages": $STAGE_COUNT,
    "total_duration_seconds": $TOTAL_TIME,
    "average_stage_duration_seconds": $AVG_DURATION,
    "min_stage_duration_seconds": $MIN_DURATION,
    "max_stage_duration_seconds": $MAX_DURATION,
    "rating": "$RATING"
  },
  "percentiles": {
    "p50_seconds": $P50,
    "p90_seconds": $P90,
    "p95_seconds": $P95,
    "p99_seconds": $P99
  },
  "recommendations": [
    $(
      if [ "$MAX_DURATION" -gt 300 ]; then
        echo '"Consider optimizing stages taking >5 minutes",'
      fi
      if [ "$P99" -gt 60 ]; then
        echo '"Some stages exceed 1 minute; review for parallelization",'
      fi
      if [ "$AVG_DURATION" -gt 30 ]; then
        echo '"Average stage duration is high; profile for bottlenecks",'
      fi
      echo '"Good performance baseline"'
    )
  ]
}
EOF

# Print to stdout as well
cat "$OUTPUT_FILE"
