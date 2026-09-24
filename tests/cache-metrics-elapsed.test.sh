#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

extract_function() {
  awk -v fn="$1" '
  $0 ~ ("^" fn "\\(\\) \\{") { capture=1; depth=0 }
  capture {
    print
    for (i = 1; i <= length($0); i++) {
      ch = substr($0, i, 1)
      if (ch == "{") depth++
      if (ch == "}") depth--
    }
    if (capture && depth == 0) exit
  }
' "$ROOT_DIR/kaseki-agent.sh"
}
eval "$(extract_function append_cache_metric)"
eval "$(extract_function cache_metric_elapsed_seconds)"
eval "$(extract_function cache_metric_now)"
grep -q 'append_cache_metric .*"fresh_install".*"\$cache_metric_elapsed"' "$ROOT_DIR/kaseki-agent.sh"
grep -q 'record_stage_timing "dependency install" "0" "\$cache_metric_elapsed"' "$ROOT_DIR/kaseki-agent.sh"

metrics="$TMP_DIR/cache-metrics.json"
printf '[]\n' > "$metrics"
append_cache_metric "$metrics" fresh_install true none 1.375 npm_ci
append_cache_metric "$metrics" existing_node_modules true repo '' cache_hit
elapsed="$(cache_metric_elapsed_seconds 1000000000000 1001250000000)"
[ "$elapsed" = '1.250' ] || { printf 'expected 1.250 seconds, got %s\n' "$elapsed" >&2; exit 1; }

mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/date" <<'DATE'
#!/usr/bin/env bash
case "$1" in
  +%s%N)
    if [ "${FAKE_DATE_NANOSECONDS:-0}" = "1" ]; then
      printf '1700000000123456789\n'
    else
      printf '1700000000%%N\n'
    fi
    ;;
  +%s) printf '1700000000\n' ;;
  *) exit 1 ;;
esac
DATE
chmod +x "$TMP_DIR/bin/date"
fallback_now="$(PATH="$TMP_DIR/bin:$PATH" cache_metric_now)"
[ "$fallback_now" = '1700000000' ] || { printf 'expected seconds fallback, got %s\n' "$fallback_now" >&2; exit 1; }
nanosecond_now="$(PATH="$TMP_DIR/bin:$PATH" FAKE_DATE_NANOSECONDS=1 cache_metric_now)"
[ "$nanosecond_now" = '1700000000123456789' ] || { printf 'expected nanosecond timestamp, got %s\n' "$nanosecond_now" >&2; exit 1; }

node - "$metrics" <<'NODE'
const fs = require('node:fs');
const metrics = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (metrics[0].elapsed_seconds !== 1.375) throw new Error('measured elapsed time was not preserved');
if (metrics[1].elapsed_seconds !== null) throw new Error('unmeasured cache decision must be null, not a false zero');
NODE

printf 'cache-metrics-elapsed.test.sh PASS\n'
