#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=helpers/repo-memory-test-helpers.sh
. "$(dirname "$0")/helpers/repo-memory-test-helpers.sh"
setup_repo_memory_fixture
trap 'rm -rf "$TMP_DIR"' EXIT
build_result_artifacts
write_repo_memory_summary '2026-05-06T12:00:00Z'

# Keep one rendering-level assertion; the remaining checks parse the documented
# Markdown structure so content in the wrong section cannot satisfy the test.
IFS= read -r title < "$REPO_MEMORY_FILE"
[ "$title" = '# Repository Memory Summary' ]

node - "$REPO_MEMORY_FILE" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');

const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const sections = new Map([['metadata', []]]);
const sectionOrder = [];
let currentSection = 'metadata';

for (const line of lines.slice(1)) {
  if (line.startsWith('## ')) {
    currentSection = line.slice(3);
    assert.ok(!sections.has(currentSection), `duplicate section: ${currentSection}`);
    sections.set(currentSection, []);
    sectionOrder.push(currentSection);
  } else if (line.startsWith('- ')) {
    const section = sections.get(currentSection);
    if (section === undefined) {
      throw new Error(`Cannot add item to unknown section: ${currentSection}`);
    }
    section.push(line.slice(2));
  }
}

assert.deepEqual(sectionOrder, [
  'Last run summary',
  'Changed files',
  'Validation outcomes',
  'Sanitized analysis notes',
]);
assert.deepEqual(
  Object.fromEntries([...sections].map(([name, items]) => [name, items.length])),
  { metadata: 6, 'Last run summary': 2, 'Changed files': 2, 'Validation outcomes': 1, 'Sanitized analysis notes': 1 },
);

const expectedLocations = new Map([
  ['Updated at: 2026-05-06T12:00:00Z', 'metadata'],
  ['Useful architecture note.', 'Sanitized analysis notes'],
  ['npm test: exit 0, 3s', 'Validation outcomes'],
]);
for (const [expected, intendedSection] of expectedLocations) {
  const locations = [...sections]
    .flatMap(([section, items]) => items.filter((item) => item === expected).map(() => section));
  assert.deepEqual(locations, [intendedSection], `${expected} must appear exactly once in ${intendedSection}`);
}
NODE
printf '✅ Repository memory summary generation test passed\n'
