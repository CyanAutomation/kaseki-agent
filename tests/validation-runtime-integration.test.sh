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
