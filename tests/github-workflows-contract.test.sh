#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOWS_DIR="$ROOT_DIR/.github/workflows"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  local message="$3"
  grep -Fq -- "$expected" "$file" || fail "$message"
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  local message="$3"
  ! grep -Fq -- "$unexpected" "$file" || fail "$message"
}

RELEASE_WORKFLOW="$WORKFLOWS_DIR/release.yml"
PUBLISH_WORKFLOW="$WORKFLOWS_DIR/build-docker-image.yml"
CODEQL_WORKFLOW="$WORKFLOWS_DIR/codeql.yml"
DEPENDENCY_REVIEW_WORKFLOW="$WORKFLOWS_DIR/dependency-review.yml"

assert_contains "$RELEASE_WORKFLOW" 'workflow_dispatch:' \
  'Releases must remain manually invoked'
assert_not_contains "$RELEASE_WORKFLOW" '  push:' \
  'Release workflow must not run automatically on pushes'
assert_contains "$RELEASE_WORKFLOW" 'environment: release' \
  'Release creation must be protected by the release environment'
assert_not_contains "$RELEASE_WORKFLOW" 'grep -q "Published release"' \
  'Release detection must not rely on semantic-release log wording'
assert_contains "$RELEASE_WORKFLOW" 'comm -13' \
  'Release detection must identify the newly-created immutable tag'

test -f "$CODEQL_WORKFLOW" || fail 'CodeQL workflow must exist'
assert_contains "$CODEQL_WORKFLOW" 'pull_request:' \
  'CodeQL must scan pull requests'
assert_contains "$CODEQL_WORKFLOW" 'branches: [main]' \
  'CodeQL must scan main'
assert_contains "$CODEQL_WORKFLOW" 'security-events: write' \
  'CodeQL must be able to publish security results'

test -f "$DEPENDENCY_REVIEW_WORKFLOW" || fail 'Dependency-review workflow must exist'
assert_contains "$DEPENDENCY_REVIEW_WORKFLOW" 'pull_request:' \
  'Dependency review must run on pull requests'

assert_contains "$PUBLISH_WORKFLOW" '  scan:' \
  'Published images must be vulnerability scanned'
assert_contains "$PUBLISH_WORKFLOW" 'scanners: vuln' \
  'Trivy must scan vulnerabilities only; repository secrets are not image findings'
assert_contains "$PUBLISH_WORKFLOW" 'Trivy high/critical findings' \
  'Trivy findings must be summarized before the gate fails'
assert_contains "$PUBLISH_WORKFLOW" 'needs: [prepare, build_candidate, verify, scan]' \
  'Promotion must wait for a successful vulnerability scan'

assert_contains "$ROOT_DIR/Dockerfile" 'node:24-bookworm-slim@sha256:' \
  'The Docker base image must be pinned by digest'
assert_contains "$ROOT_DIR/.github/dependabot.yml" 'package-ecosystem: "docker"' \
  'Dependabot must keep Docker base-image digests current'

printf '✓ GitHub workflow contracts passed.\n'
