#!/usr/bin/env bash
set -euo pipefail

TARGET_FILE="${1:-${KASEKI_HEARTBEAT_FILE:-/var/log/kaseki/heartbeat.json}}"
CHECK_CONTAINERS="${KASEKI_HEALTHCHECK_CONTAINERS:-1}"

json_encode() {
  local value
  value="$(cat)"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\b'/\\b}"
  value="${value//$'\f'/\\f}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '"%s"' "$value"
}

json_string() {
  printf '%s' "$1" | json_encode
}

status_ok="true"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

has_docker="false"
docker_cmd=""
daemon_ok="false"
daemon_error=""
container_check_enabled="false"
container_count="0"
container_names_json="[]"

if command -v docker >/dev/null 2>&1; then
  has_docker="true"
  docker_cmd="$(command -v docker)"
fi

if [ "$has_docker" = "true" ]; then
  if docker info >/dev/null 2>&1; then
    daemon_ok="true"
  else
    daemon_error="$(docker info 2>&1 || true)"
    status_ok="false"
  fi
else
  status_ok="false"
fi

if [ "$CHECK_CONTAINERS" = "1" ] && [ "$daemon_ok" = "true" ]; then
  container_check_enabled="true"
  mapfile -t names < <(docker ps --filter 'name=^kaseki-' --format '{{.Names}}' || true)
  container_count="${#names[@]}"
  if [ "${#names[@]}" -gt 0 ]; then
    json_items=()
    for n in "${names[@]}"; do
      json_items+=("$(json_string "$n")")
    done
    container_names_json="[$(IFS=,; echo "${json_items[*]}")]"
  fi
fi

overall_status="ok"
if [ "$status_ok" != "true" ]; then
  overall_status="degraded"
fi

mkdir -p "$(dirname "$TARGET_FILE")"
tmp_file="${TARGET_FILE}.tmp.$$"

cat > "$tmp_file" <<JSON
{
  "timestamp": $(json_string "$ts"),
  "status": $(json_string "$overall_status"),
  "checks": {
    "docker_command": {
      "ok": $has_docker,
      "path": $(json_string "$docker_cmd")
    },
    "docker_daemon": {
      "ok": $daemon_ok,
      "error": $(json_string "$daemon_error")
    },
    "kaseki_containers": {
      "enabled": $container_check_enabled,
      "active_count": $container_count,
      "active_names": $container_names_json
    }
  }
}
JSON

mv "$tmp_file" "$TARGET_FILE"
printf '%s\n' "$TARGET_FILE"
