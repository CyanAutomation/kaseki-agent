/**
 * Fake binary stubs for testing
 *
 * Factory function to create reusable fake binary stubs (pi, npm, timeout, etc.)
 * that can be shared across multiple test scenarios.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FakeBinariesConfig {
  resultsDir: string;
  piCalls?: string; // Path to log pi calls
  piState?: string; // Path to track pi call attempts
  scenario?: 'success' | 'pi-exit-failure' | 'malformed-artifact';
}

/**
 * Create a directory with fake binary stubs (pi, npm, timeout, etc.)
 *
 * @param binDir Directory to create binaries in
 * @param config Configuration for fake binaries behavior
 * @returns Path to the bin directory
 */
export function createFakeBinariesDir(binDir: string, config: FakeBinariesConfig): string {
  fs.mkdirSync(binDir, { recursive: true });

  const { resultsDir, piCalls, piState, scenario = 'success' } = config;

  // Create fake 'pi' command
  const piScript = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="\${*: -1}"

${
  piCalls
    ? `if printf '%s' "$prompt" | grep -q 'goal-setting Pi agent'; then
  printf 'goal-setting\\n' >> "${piCalls}"
  attempt=1
  if [ -f "${piState}" ]; then attempt=$(( $(cat "${piState}") + 1 )); fi
  printf '%s\\n' "$attempt" > "${piState}"
  if [ "$attempt" -eq 1 ]; then
    echo 'api error: upstream timeout' >&2
    exit 1
  fi
  cat > "${resultsDir}/goal-setting-candidate.json" <<'JSON'
{"original_prompt":"retry original prompt","upgraded_goal":"retry-upgraded prompt from attempt two","reasoning":"second attempt succeeded after a transient failure","key_requirements":["persist retry metadata"],"success_criteria":[{"criterion":"metadata records the successful retry attempt","smart_score":"high","reasoning":"numeric metadata can be asserted"}],"anti_patterns":{"do_not_modify":[],"do_not_break":["retry metadata"],"must_preserve":["original prompt fallback"]},"constraints":{"operational":["retry once after transient goal-setting failure"],"architectural":[],"technical":[],"business":[]},"quality_metrics":{"clarity":"high","measurability":"high","specificity":"high","scope_clarity":"high","constraint_strength":"high"},"confidence":"high"}
JSON
elif printf '%s' "$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\\n' >> "${piCalls}"
  printf '%s\\n' '{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[]}' > "${resultsDir}/scouting-candidate.json"
elif printf '%s' "$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\\n' >> "${piCalls}"
  case "${scenario}" in
    pi-exit-failure)
      printf '{"type":"message","model":"test-model"}\\n'
      exit 42
      ;;
    malformed-artifact)
      printf '%s' '{"met":true,"confidence":"high"' > "${resultsDir}/goal-check-candidate.json"
      ;;
    *)
      printf '%s\\n' '{"met":true,"confidence":"high","summary":"Goal met by orchestration stub.","retry_prompt":"","evidence":["diff inspected"],"missing":[],"validation_notes":["validation was available"]}' > "${resultsDir}/goal-check-candidate.json"
      ;;
  esac
else
  printf 'coding\\n' >> "${piCalls}"
  printf '%s' "$prompt" > "${resultsDir}/coding-prompt.txt"
fi`
    : '# pi stub (no logging)'
}

printf '{"type":"message","model":"test-model"}\\n'
`;

  fs.writeFileSync(path.join(binDir, 'pi'), piScript, { mode: 0o700 });

  // Create fake 'npm' command
  fs.writeFileSync(
    path.join(binDir, 'npm'),
    `#!/usr/bin/env bash
echo "fake npm $*" >&2
mkdir -p node_modules
exit 0
`,
    { mode: 0o700 }
  );

  // Create fake 'timeout' command
  fs.writeFileSync(
    path.join(binDir, 'timeout'),
    `#!/usr/bin/env bash
shift 2
"$@"
`,
    { mode: 0o700 }
  );

  // Create fake 'kaseki-pi-progress-stream' command
  fs.writeFileSync(
    path.join(binDir, 'kaseki-pi-progress-stream'),
    `#!/usr/bin/env bash
cat
`,
    { mode: 0o700 }
  );

  // Create fake 'kaseki-pi-event-filter' command
  fs.writeFileSync(
    path.join(binDir, 'kaseki-pi-event-filter'),
    `#!/usr/bin/env bash
cat "$1" > "$2"
printf '{"selected_model":"test-model"}\\n' > "$3"
`,
    { mode: 0o700 }
  );

  // Create fake 'validation-output-filter' command
  fs.writeFileSync(
    path.join(binDir, 'validation-output-filter'),
    `#!/usr/bin/env bash
cat
`,
    { mode: 0o700 }
  );

  return binDir;
}

/**
 * Create and return a fake pi command that logs which stage it was called for
 * (useful for orchestration testing)
 */
export function createPiWithOrchestrationLogging(
  binDir: string,
  scenario: 'success' | 'pi-exit-failure' | 'malformed-artifact' = 'success'
): void {
  fs.mkdirSync(binDir, { recursive: true });

  const piScript = `#!/usr/bin/env bash
set -uo pipefail
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="\${*: -1}"

append_event() {
  node - "$ORCHESTRATOR_EVENTS" "$1" "${scenario}" <<'NODE'
const fs = require('node:fs');
const [file, stage, scenario] = process.argv.slice(2);
fs.appendFileSync(file, JSON.stringify({ event: 'pi', stage, scenario, at: Date.now() }) + '\\n');
NODE
}

if printf '%s' "$prompt" | grep -q 'goal-setting Pi agent'; then
  append_event goal-setting
  printf '%s\\n' '{"original_prompt":"inspect then code","upgraded_goal":"Upgraded: inspect then code","reasoning":"test","key_requirements":[],"success_criteria":["goal-check should run"]}' > "$KASEKI_RESULTS_DIR/goal-setting-candidate.json"
elif printf '%s' "$prompt" | grep -q 'read-only scouting Pi agent'; then
  append_event scouting
  printf '%s\\n' '{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[],"test_impact":[]}' > "$KASEKI_RESULTS_DIR/scouting-candidate.json"
elif printf '%s' "$prompt" | grep -q 'read-only goal-check Pi agent'; then
  append_event goal-check
  if [ "${scenario}" = "pi-exit-failure" ]; then
    printf '{"type":"message","model":"test-model"}\\n'
    exit 42
  elif [ "${scenario}" = "malformed-artifact" ]; then
    printf '%s' '{"met":true,"confidence":"high"' > "$KASEKI_RESULTS_DIR/goal-check-candidate.json"
  else
    printf '%s\\n' '{"met":true,"confidence":"high","summary":"Goal met by orchestration stub.","retry_prompt":"","evidence":["diff inspected"],"missing":[],"validation_notes":["validation was available"]}' > "$KASEKI_RESULTS_DIR/goal-check-candidate.json"
  fi
else
  append_event coding
fi
printf '{"type":"message","model":"test-model"}\\n'
`;

  fs.writeFileSync(path.join(binDir, 'pi'), piScript, { mode: 0o700 });
}
