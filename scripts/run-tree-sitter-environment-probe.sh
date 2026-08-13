#!/usr/bin/env bash

set -euo pipefail

if ! tree_sitter_version="$(tree-sitter --version 2>/dev/null)"; then
  cat >&2 <<'EOF'
tree-sitter CLI is required for this optional environment probe.
Install the pinned CLI separately with:
  npm install --global tree-sitter-cli@0.25.10
Then rerun: npm run test:tree-sitter:environment-probe
EOF
  exit 1
fi

printf 'Using %s\n' "$tree_sitter_version"
RUN_TREE_SITTER_CLI_INTEGRATION=1 jest --runInBand \
  tests/summarization/optional-tree-sitter-cli-environment-probe.test.ts
