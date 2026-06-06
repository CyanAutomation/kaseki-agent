#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

template_dir="$TMP_DIR/template"
host_cache_dir="$TMP_DIR/root/kaseki-cache"
mkdir -p "$template_dir" "$host_cache_dir"

cat > "$template_dir/run-kaseki.sh" <<'EOF_RUN'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--doctor" ]; then
  printf 'Cache: %s\n' "${KASEKI_CACHE_DIR:-}"
  [ "${KASEKI_CACHE_DIR:-}" = "$EXPECTED_HOST_CACHE_DIR" ]
  exit 0
fi

printf 'unexpected args: %s\n' "$*" >&2
exit 2
EOF_RUN
chmod +x "$template_dir/run-kaseki.sh"

output="$(
  KASEKI_ROOT="$TMP_DIR/root" \
  KASEKI_CHECKOUT_DIR="$ROOT_DIR" \
  KASEKI_TEMPLATE_DIR="$template_dir" \
  KASEKI_CACHE_DIR="/cache" \
  EXPECTED_HOST_CACHE_DIR="$host_cache_dir" \
    "$ROOT_DIR/scripts/kaseki-activate.sh" --json doctor
)"

if ! printf '%s\n' "$output" | grep -Fq "\"ok\":true"; then
  printf 'Expected activate doctor to pass with host cache override.\nOutput:\n%s\n' "$output" >&2
  exit 1
fi

if printf '%s\n' "$output" | grep -Fq 'Cache: /cache'; then
  printf 'Expected activate doctor not to pass leaked /cache to template doctor.\nOutput:\n%s\n' "$output" >&2
  exit 1
fi

if ! printf '%s\n' "$output" | grep -Fq "Cache: $host_cache_dir"; then
  printf 'Expected activate doctor output to include host cache dir.\nOutput:\n%s\n' "$output" >&2
  exit 1
fi

printf '✓ kaseki-activate doctor uses host cache dir when container cache env leaks in\n'
