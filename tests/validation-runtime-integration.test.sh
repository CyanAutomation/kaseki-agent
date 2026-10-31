#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=test/helpers/validation-contract-helpers.sh
source "$ROOT_DIR/test/helpers/validation-contract-helpers.sh"

runtime_dir=""
new_test_context runtime_dir
write_fake_tools "$runtime_dir/bin"
create_controlled_repo "$runtime_dir/repository" 1
cat > "$runtime_dir/bin/native-crash" <<'EOF'
#!/usr/bin/env bash
echo 'MmapAligned() failed - unable to allocate with tag'
echo 'TCMalloc assumes a 48-bit virtual address space size'
echo 'FATAL ERROR: Out of memory trying to allocate internal tcmalloc data'
exit 1
EOF
chmod +x "$runtime_dir/bin/native-crash"
status=0
run_kaseki_agent_for_validation "$runtime_dir" "$runtime_dir/repository" 'native-crash;touch should-not-run' "$runtime_dir/run.log" || status=$?
[ "$status" -eq 70 ] || { tail -60 "$runtime_dir/run.log"; fail "native startup crash should exit 70, got $status"; }
[ ! -e "$runtime_dir/workspace/repo/should-not-run" ] || fail 'continued validation after native startup failure'
node - "$runtime_dir/results/metadata.json" <<'NODE'
const fs = require('node:fs');
const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (metadata.pre_validation_exit_code !== 70 || !metadata.validation_infrastructure_diagnostics.infrastructure_failure) process.exit(1);
if (!metadata.pre_validation_failure_reason.includes('workerd_address_space_incompatible')) process.exit(1);
NODE
pass 'native runtime crash fails validation before agent work with infrastructure diagnostics'

runtime_dir=""
new_test_context runtime_dir
create_controlled_repo "$runtime_dir/repository" 0
mkdir -p "$runtime_dir/bin"
cat > "$runtime_dir/bin/npm" <<'EOF_NPM'
#!/usr/bin/env bash
case "${1:-}" in
  --version) printf '11.0.0\n' ;;
  ls) exit 0 ;;
  ci)
    count=0
    count_file="${VALIDATION_MARKER}.npm-count"
    [ ! -f "$count_file" ] || count="$(cat "$count_file")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$count_file"
    mkdir -p node_modules
    if [ "$count" -ge 2 ]; then
      mkdir -p node_modules/workerd/bin
      cat > node_modules/workerd/package.json <<'JSON'
{"name":"workerd","version":"1.0.0","bin":{"workerd":"bin/workerd"}}
JSON
      cat > node_modules/workerd/bin/workerd <<'EOF_WORKERD'
#!/usr/bin/env bash
echo 'MmapAligned() failed - unable to allocate with tag' >&2
echo 'TCMalloc assumes a 48-bit virtual address space size' >&2
exit 134
EOF_WORKERD
      chmod +x node_modules/workerd/bin/workerd
    fi
    ;;
  *) exit 2 ;;
esac
EOF_NPM
cat > "$runtime_dir/bin/workerd" <<'EOF_WORKERD_COMMAND'
#!/usr/bin/env bash
touch "$VALIDATION_MARKER"
EOF_WORKERD_COMMAND
chmod +x "$runtime_dir/bin/npm"
chmod +x "$runtime_dir/bin/workerd"
status=0
run_kaseki_agent_for_validation "$runtime_dir" "$runtime_dir/repository" 'npm ci && workerd test' "$runtime_dir/run.log" \
  VALIDATION_MARKER="$runtime_dir/test-command-ran" || status=$?
[ "$status" -eq 70 ] || { tail -80 "$runtime_dir/run.log"; fail "post-install workerd preflight should exit 70, got $status"; }
[ ! -e "$runtime_dir/test-command-ran" ] || fail 'continued into worker tests after native runtime preflight failure'
node - "$runtime_dir/results/validation-runtime.jsonl" <<'NODE'
const fs = require('node:fs');
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
if (rows.length !== 2 || rows[0].status !== 'not_required' || rows[1].classification !== 'workerd_address_space_incompatible') process.exit(1);
NODE
pass 'post-install workerd preflight catches incompatible Pi runtime before worker tests'
