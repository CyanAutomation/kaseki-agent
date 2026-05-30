#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

template_dir="$TMP_DIR/source-checkout"
fake_bin="$TMP_DIR/bin"
mkdir -p "$template_dir/scripts" "$fake_bin"
cp "$ROOT_DIR/run-kaseki.sh" "$template_dir/run-kaseki.sh"
cp "$ROOT_DIR/kaseki-agent.sh" "$template_dir/kaseki-agent.sh"
cp "$ROOT_DIR/scripts/kaseki-preflight.sh" "$template_dir/scripts/kaseki-preflight.sh"
chmod +x "$template_dir/run-kaseki.sh" "$template_dir/kaseki-agent.sh" "$template_dir/scripts/kaseki-preflight.sh"

cat > "$fake_bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--version" ]; then
  printf 'Docker version test\n'
  exit 0
fi

if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
  exit 0
fi

if [ "${1:-}" = "run" ]; then
  shift
  if [ "${1:-}" = "--rm" ]; then shift; fi
  if [ "${1:-}" = "--entrypoint" ]; then
    entrypoint="${2:-}"
    shift 2
  else
    entrypoint=""
  fi
  image="${1:-}"
  shift || true
  case "$entrypoint" in
    test)
      [ "${1:-}" = "-f" ] && [ "${2:-}" = "/app/run-kaseki.sh" ]
      ;;
    sha256sum)
      case "${1:-}" in
        /usr/local/bin/kaseki-agent)
          sha256sum "$TEST_TEMPLATE_DIR/kaseki-agent.sh"
          ;;
        *)
          printf '0000000000000000000000000000000000000000000000000000000000000000  %s\n' "${1:-}"
          ;;
      esac
      ;;
    *)
      printf 'unexpected docker run entrypoint for %s: %s\n' "$image" "$entrypoint" >&2
      exit 2
      ;;
  esac
  exit 0
fi

printf 'unexpected docker invocation: %s\n' "$*" >&2
exit 2
DOCKER
chmod +x "$fake_bin/docker"

set +e
output="$(
  cd "$template_dir" && env \
    PATH="$fake_bin:/usr/bin:/bin" \
    TEST_TEMPLATE_DIR="$template_dir" \
    KASEKI_ROOT="$TMP_DIR/root" \
    KASEKI_LOG_DIR="$TMP_DIR/logs" \
    OPENROUTER_API_KEY="test-key" \
    ./run-kaseki.sh --doctor 2>&1
)"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  printf 'Expected doctor to fail for missing deployed template files\nOutput:\n%s\n' "$output" >&2
  exit 1
fi

for expected in \
  'Image/template parity: missing host file lib/pi-event-filter.js' \
  'Image/template parity: missing deployed template files; this looks like a source checkout or incomplete template.' \
  'sudo KASEKI_IMAGE_PULL_POLICY=missing ./scripts/deploy-pi-template.sh' \
  '/agents/kaseki-template/run-kaseki.sh --doctor'
do
  if ! printf '%s\n' "$output" | grep -Fq "$expected"; then
    printf 'FAIL: Expected doctor output to contain: "%s"\n' "$expected" >&2
    printf 'ACTUAL OUTPUT:\n---\n%s\n---\n' "$output" >&2
    exit 1
  fi
done
