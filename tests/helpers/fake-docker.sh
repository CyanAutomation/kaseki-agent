#!/usr/bin/env bash
# Shared fake Docker helpers for shell tests.

install_fake_docker_doctor_parity() {
  local fake_bin="$1"
  mkdir -p "$fake_bin"

  cat > "$fake_bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail

entrypoint_arg() {
  local previous=""
  for arg in "$@"; do
    if [ "$previous" = "--entrypoint" ]; then
      printf '%s\n' "$arg"
      return 0
    fi
    previous="$arg"
  done
}

last_arg() {
  local value=""
  for value in "$@"; do :; done
  printf '%s\n' "$value"
}

if [ "${1:-}" = "--version" ]; then
  printf 'Docker version test\n'
  exit 0
fi

if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
  exit 0
fi

if [ "${1:-}" = "run" ]; then
  : "${TEST_TEMPLATE_DIR:?TEST_TEMPLATE_DIR is required}"
  entrypoint="$(entrypoint_arg "$@")"
  target="$(last_arg "$@")"

  case "$entrypoint" in
    test)
      [ "${1:-}" = "-f" ] && [ "${2:-}" = "/app/run-kaseki.sh" ]
      exit 0
      ;;
    sha256sum)
      if [ "$target" = "/usr/local/bin/kaseki-agent" ]; then
        sha256sum "$TEST_TEMPLATE_DIR/kaseki-agent.sh"
      else
        printf '0000000000000000000000000000000000000000000000000000000000000000  %s\n' "$target"
      fi
      exit 0
      ;;
  esac
fi

printf 'unexpected docker invocation in fake doctor parity helper: %s\n' "$*" >&2
exit 2
DOCKER
  chmod +x "$fake_bin/docker"
}
