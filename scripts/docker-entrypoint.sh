#!/usr/bin/env bash
set -euo pipefail

case "${1:-agent}" in
  agent|kaseki-agent)
    shift || true
    exec /usr/local/bin/kaseki-agent "$@"
    ;;
  api|kaseki-api)
    shift || true
    exec node /app/dist/kaseki-api-service.js "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
