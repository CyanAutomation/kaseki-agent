#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

print_contract() {
  printf '\n## %s\n' "$1"
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local message="$3"

  grep -Eq "$pattern" "$file" || fail "$message"
}

assert_package_files_include() {
  local message="$1"
  shift

  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const expectedEntries = process.argv.slice(1);
    const files = JSON.parse(readFileSync("package.json", "utf8")).files;
    if (!Array.isArray(files)) {
      console.error("package.json files must be an array");
      process.exit(1);
    }
    const missingEntries = expectedEntries.filter((entry) => !files.includes(entry));
    if (missingEntries.length) {
      console.error(`missing package.json files entries: ${missingEntries.join(", ")}`);
      process.exit(1);
    }
  ' "$@" || fail "$message"
}

# Parse Dockerfile instructions as logical instructions, rather than assuming that
# COPY or RUN commands occupy one physical line. This keeps these contracts about
# packaging behavior instead of Dockerfile formatting.
assert_docker_contract() {
  local message="$1"
  shift

  node --input-type=module - "$@" <<'NODE' || fail "$message"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const [kind, ...expected] = process.argv.slice(2);
const physicalLines = readFileSync('Dockerfile', 'utf8').split(/\r?\n/);
const instructions = [];
let logicalLine = '';
for (const physicalLine of physicalLines) {
  const trimmed = physicalLine.trim();
  if (!logicalLine && (!trimmed || trimmed.startsWith('#'))) continue;
  logicalLine += `${logicalLine ? ' ' : ''}${trimmed.replace(/\\\s*$/, '')}`;
  if (!/\\\s*$/.test(trimmed)) {
    instructions.push(logicalLine);
    logicalLine = '';
  }
}
if (logicalLine) instructions.push(logicalLine);

const shellWords = (text) => text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((word) =>
  word.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted)
) ?? [];

const copies = instructions
  .filter((instruction) => /^COPY\s/i.test(instruction))
  .map((instruction) => {
    const words = shellWords(instruction).slice(1);
    const flags = words.filter((word) => word.startsWith('--'));
    const paths = words.filter((word) => !word.startsWith('--'));
    return { from: flags.find((flag) => flag.startsWith('--from='))?.slice(7) ?? '', sources: paths.slice(0, -1), destination: paths.at(-1) };
  });

const splitShellCommands = (shellCommand) => {
  const commands = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let index = 0; index < shellCommand.length; index++) {
    const character = shellCommand[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote === character ? null : character;
    }
    if (!quote && character === '&' && index + 1 < shellCommand.length && shellCommand[index + 1] === '&') {
      if (current.trim()) commands.push(current.trim());
      current = '';
      index++;
      continue;
    }
    current += character;
  }
  if (current.trim()) commands.push(current.trim());
  return commands;
};

const containsSequence = (words, sequence) => sequence.length <= words.length &&
  words.some((_, start) => sequence.every((word, offset) => words[start + offset] === word));

const matchesInstall = (words, mode, source, destination) => {
  const installIndex = words.indexOf('install');
  if (installIndex < 0) return false;

  const args = words.slice(installIndex + 1);
  const operands = [];
  let actualMode;
  let optionsEnded = false;
  const optionsWithValues = new Set(['-m', '--mode', '-o', '--owner', '-g', '--group', '-S', '--suffix', '-t', '--target-directory']);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!optionsEnded && argument === '--') {
      optionsEnded = true;
    } else if (!optionsEnded && optionsWithValues.has(argument)) {
      if (index + 1 >= args.length) return false;
      const value = args[++index];
      if (value === undefined) return false;
      if (argument === '-m' || argument === '--mode') actualMode = value;
    } else if (!optionsEnded && /^-m.+/.test(argument)) {
      actualMode = argument.slice(2);
    } else if (!optionsEnded && argument.startsWith('--mode=')) {
      actualMode = argument.slice('--mode='.length);
    } else if (!optionsEnded && argument.startsWith('-')) {
      // Boolean install options (for example --no-target-directory) have no operand.
    } else {
      operands.push(argument);
    }
  }
  return operands.length >= 2 && actualMode === mode && operands.at(-2) === source && operands.at(-1) === destination;
};

const runCommands = instructions
  .filter((instruction) => /^RUN\s/i.test(instruction))
  .flatMap((instruction) => splitShellCommands(instruction.replace(/^RUN\s+/i, '')))
  .map(shellWords);

const wantedCount = kind === 'copy' ? undefined : Number(expected.pop());
let actualCount;
if (kind === 'copy') {
  const [stage, source, destination] = expected;
  actualCount = copies.filter((copy) => copy.from === stage && copy.destination === destination && copy.sources.includes(source)).length;
} else if (kind === 'install') {
  const [mode, source, destination] = expected;
  actualCount = runCommands.filter((words) => matchesInstall(words, mode, source, destination)).length;
} else if (kind === 'command') {
  actualCount = runCommands.filter((words) => containsSequence(words, expected)).length;
} else if (kind === 'command-contains') {
  actualCount = runCommands.filter((words) => expected.every((word) => words.includes(word))).length;
} else if (kind === 'parser-self-test') {
  assert.deepEqual(splitShellCommands('echo "foo && bar" && real_command'), ['echo "foo && bar"', 'real_command']);
  assert.deepEqual(splitShellCommands("echo 'foo && bar' && real_command"), ["echo 'foo && bar'", 'real_command']);
  assert.deepEqual(splitShellCommands('echo foo \\&& bar && real_command'), ['echo foo \\&& bar', 'real_command']);
  assert.deepEqual(splitShellCommands('echo foo &'), ['echo foo &']);
  assert.equal(matchesInstall(['install', '-m', '0755', '--no-target-directory', 'source', 'destination'], '0755', 'source', 'destination'), true);
  assert.equal(matchesInstall(['install', '--no-target-directory', '--mode=0755', 'source', 'destination'], '0755', 'source', 'destination'), true);
  assert.equal(matchesInstall(['install', '-m'], '0755', 'source', 'destination'), false);
  assert.equal(matchesInstall(['install', '-m', '0755', 'destination'], '0755', undefined, 'destination'), false);
  assert.equal(containsSequence(['ENV_VAR=value', 'chmod', '+x', 'file'], ['chmod', '+x', 'file']), true);
  process.exit(0);
} else {
  throw new Error(`unknown Docker contract kind: ${kind}`);
}

// COPY only needs to be present; install and command queries have exact counts.
if (kind === 'copy') {
  if (actualCount < 1) process.exit(1);
} else {
  if (actualCount !== wantedCount) {
    console.error(`expected ${wantedCount} matching ${kind} instruction(s), found ${actualCount}`);
    process.exit(1);
  }
}
NODE
}

assert_docker_copy() {
  local source="$1" destination="$2" message="$3" stage="${4:-}"
  assert_docker_contract "$message" copy "$stage" "$source" "$destination"
}

assert_docker_install() {
  local mode="$1" source="$2" destination="$3" count="$4" message="$5"
  assert_docker_contract "$message" install "$mode" "$source" "$destination" "$count"
}

assert_preserved_executable() {
  local source="$1" app_path="$2" installed_path="$3" message="$4"
  assert_docker_contract "$message" command cp "$source" "$app_path" 1
  assert_docker_install 0755 "$app_path" "$installed_path" 2 "$message"
}

contract_published_package_contents() {
  print_contract 'Published package contents'
  assert_docker_contract 'Dockerfile contract parser regression checks failed' parser-self-test
  assert_package_files_include \
    'package.json files does not include all packaged runtime contract entries' \
    dist/ kaseki-agent.sh scripts/ templates/ README.md LICENSE
}

contract_startup_check_availability() {
  print_contract 'Startup-check availability in image stages'
  bash -n scripts/startup-check-packaging.sh
  assert_file_contains .dockerignore '^!tsconfig\.scripts\.json$' \
    '.dockerignore does not allow tsconfig.scripts.json into the Docker build context'
  assert_docker_copy tsconfig.scripts.json ./ \
    'Dockerfile does not copy tsconfig.scripts.json before npm run build'
  assert_docker_copy scripts ./scripts \
    'Dockerfile does not copy scripts into /app for startup-check packaging'
  assert_docker_copy /app/scripts ./scripts \
    'Dockerfile final stage does not copy packaged scripts from runtime stage' runtime
  assert_docker_contract \
    'Dockerfile does not mark startup-check-packaging.sh executable' \
    command-contains chmod +x /app/scripts/startup-check-packaging.sh 1
  assert_docker_contract \
    'Dockerfile must install startup-check symlinks in both runtime and final stages' \
    command /app/scripts/startup-check-packaging.sh install 2
}

contract_pi_event_filter_runtime_dependencies() {
  print_contract 'Pi event-filter runtime dependencies'
  assert_preserved_executable dist/pi-event-filter-helpers.js /app/lib/pi-event-filter-helpers.js /usr/local/bin/pi-event-filter-helpers.js \
    'Dockerfile does not preserve and install the pi-event-filter helper module'
  assert_docker_contract 'Dockerfile does not preserve pi-event aggregation modules' \
    command cp -r dist/pi-event-aggregation /app/lib/pi-event-aggregation 1
  assert_docker_contract 'Dockerfile must install pi-event aggregation modules in runtime and final stages' \
    command cp -r '/app/lib/pi-event-aggregation/*' /usr/local/bin/pi-event-aggregation/ 2
  assert_docker_contract 'Dockerfile must smoke-test the packaged pi-event filter in runtime and final stages' \
    command /usr/local/bin/kaseki-pi-event-filter '$empty_events' '$filtered_events' '$event_summary' 2
  assert_docker_contract 'Dockerfile does not preserve the hashline event handler runtime dependency' \
    command cp dist/hashline-event-handler.js /app/lib/hashline-event-handler.js 1
  assert_docker_contract 'Dockerfile does not preserve the hashline validator runtime dependency' \
    command cp dist/hashline-validator.js /app/lib/hashline-validator.js 1
  assert_file_contains kaseki-agent.sh 'node "\$\{KASEKI_APP_LIB_DIR\}"/hashline-event-handler-cli\.js' \
    'runner does not invoke the packaged hashline handler directly'
}

contract_scouting_allowlist_runtime_path() {
  print_contract 'Scouting allowlist runtime path'
  assert_docker_install 0755 /app/dist/scouting-allowlist.js /usr/local/bin/scripts/scouting-allowlist.js 2 \
    'Dockerfile must install the scouting validator at its packaged runtime path in both image stages'
  assert_file_contains kaseki-agent.sh '/app/dist/scouting-allowlist\.js' \
    'runner does not fall back to the built scouting validator in the image'
  assert_file_contains kaseki-agent.sh '/usr/local/bin/scripts/scouting-allowlist\.js' \
    'runner does not recognize the installed scouting validator runtime path'
  assert_file_contains scripts/startup-checks.sh '"scouting-allowlist\.js"' \
    'worker preflight does not verify the packaged scouting validator'
}

contract_provider_retry_helpers() {
  print_contract 'Provider retry and cleanup helper installation'
  assert_docker_install 0644 /app/scripts/lib/provider-retry.sh /usr/local/bin/scripts/lib/provider-retry.sh 2 \
    'Dockerfile must install provider-retry.sh at its sourced runtime path in both image stages'
  assert_docker_install 0755 /app/scripts/restore-disallowed-changes.sh /usr/local/bin/scripts/restore-disallowed-changes.sh 2 \
    'Dockerfile must install restore-disallowed-changes.sh at its sourced runtime path in both image stages'
  assert_docker_install 0755 /app/scripts/auto-lint-cleanup-classification.sh /usr/local/bin/scripts/auto-lint-cleanup-classification.sh 2 \
    'Dockerfile must install auto-lint cleanup classification at its sourced runtime path in both image stages'
  assert_file_contains scripts/startup-checks.sh '"lib/provider-retry\.sh"' \
    'worker preflight must reject images missing the provider retry helper'
  assert_file_contains scripts/startup-checks.sh '"restore-disallowed-changes\.sh"' \
    'worker preflight must reject images missing the restore-disallowed-changes helper'
  assert_file_contains scripts/startup-checks.sh '"auto-lint-cleanup-classification\.sh"' \
    'worker preflight must reject images missing the auto-lint cleanup classification helper'
}

contract_transitive_instance_state_helpers() {
  print_contract 'Transitive instance-state runtime helpers'
  local helper
  for helper in instance-status-derivation.js instance-stage-derivation.js instance-failure-extraction.js provider-error-classifier.js; do
    assert_preserved_executable "dist/$helper" "/app/lib/$helper" "/usr/local/bin/$helper" \
      "Dockerfile does not preserve and install transitive instance-state helper: $helper"
  done
}

contract_entrypoint_behavior() {
  print_contract 'Container entrypoint behavior'
  bash -n scripts/docker-entrypoint.sh
  assert_docker_copy kaseki-agent.sh /usr/local/bin/kaseki-agent \
    'Dockerfile must copy repository kaseki-agent.sh to /usr/local/bin/kaseki-agent'
  assert_file_contains Dockerfile '^ENTRYPOINT \["/usr/bin/tini", "--", "/usr/local/bin/kaseki-entrypoint"\]$' \
    'Dockerfile entrypoint does not dispatch through kaseki-entrypoint'
  assert_file_contains Dockerfile 'apt-get install[^&]*shellcheck' \
    'Dockerfile runtime image must include shellcheck because repository lint scripts invoke it'
}

contract_published_package_contents
contract_startup_check_availability
contract_pi_event_filter_runtime_dependencies
contract_scouting_allowlist_runtime_path
contract_provider_retry_helpers
contract_transitive_instance_state_helpers
contract_entrypoint_behavior

printf '\n✓ Static packaging layout contracts passed.\n'
