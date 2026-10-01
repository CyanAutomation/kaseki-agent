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

assert_not_matching() {
  local file="$1"
  local pattern="$2"
  local message="$3"
  ! grep -Eq -- "$pattern" "$file" || fail "$message"
}

assert_job_contains() {
  local file="$1"
  local job="$2"
  local expected="$3"
  local message="$4"
  awk -v target="$job" -v expected="$expected" '
    $0 == "  " target ":" { in_job = 1; next }
    in_job && /^  [[:alnum:]_-]+:/ { in_job = 0 }
    in_job && index($0, expected) { found = 1 }
    END { exit !found }
  ' "$file" || fail "$message"
}

RELEASE_WORKFLOW="$WORKFLOWS_DIR/release.yml"
PUBLISH_WORKFLOW="$WORKFLOWS_DIR/build-docker-image.yml"
CODEQL_WORKFLOW="$WORKFLOWS_DIR/codeql.yml"
DEPENDENCY_REVIEW_WORKFLOW="$WORKFLOWS_DIR/dependency-review.yml"
DEPENDABOT_CONFIG="$ROOT_DIR/.github/dependabot.yml"
CI_WORKFLOW="$WORKFLOWS_DIR/ci.yml"
KASEKI_DOCS_WORKFLOW="$WORKFLOWS_DIR/kaseki-docs.yaml"
KASEKI_DRY_WORKFLOW="$WORKFLOWS_DIR/kaseki-dry.yaml"

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
assert_job_contains "$RELEASE_WORKFLOW" 'publish_npm' 'uses: ./.github/workflows/publish-npm.yml' \
  'Successful releases must invoke the npm publisher'
assert_job_contains "$RELEASE_WORKFLOW" 'publish_npm' 'id-token: write' \
  'npm publishing must use OIDC'
assert_job_contains "$RELEASE_WORKFLOW" 'publish_npm' 'needs: release' \
  'npm publishing must wait for a successful release'
assert_job_contains "$RELEASE_WORKFLOW" 'publish_npm' "if: needs.release.outputs.released == 'true'" \
  'npm publishing must be skipped when semantic-release creates no release'

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
assert_job_contains "$DEPENDENCY_REVIEW_WORKFLOW" 'dependency-review' 'fail-on-severity: low' \
  'Dependency review must make its vulnerability threshold explicit'
assert_job_contains "$DEPENDENCY_REVIEW_WORKFLOW" 'dependency-review' 'fail-on-scopes: runtime, development' \
  'Dependency review must include runtime and development dependencies'

assert_contains "$DEPENDABOT_CONFIG" '- "development"' \
  'Dependabot development groups must use the supported dependency type'
assert_contains "$DEPENDABOT_CONFIG" '- "production"' \
  'Dependabot production groups must use the supported dependency type'
assert_contains "$DEPENDABOT_CONFIG" 'dependency-type:' \
  'Dependabot groups must use the supported dependency-type key'
assert_not_contains "$DEPENDABOT_CONFIG" 'dependency-types:' \
  'Dependabot groups must not use the unsupported plural dependency-type key'
assert_not_matching "$DEPENDABOT_CONFIG" '^[[:space:]]+- "(dev|prod)"$' \
  'Dependabot groups must not use unsupported dependency type aliases'
assert_contains "$DEPENDABOT_CONFIG" 'reviewers:' \
  'Dependabot must keep the maintainer team as reviewers'
assert_contains "$DEPENDABOT_CONFIG" '"CyanAutomation/maintainers"' \
  'Dependabot must retain the maintainers team as reviewers'
assert_not_contains "$DEPENDABOT_CONFIG" '    assignees:' \
  'Dependabot assignees must not name a team'

assert_job_contains "$CI_WORKFLOW" 'validate' 'timeout-minutes: 120' \
  'CI validation must have a bounded runtime'
assert_job_contains "$CI_WORKFLOW" 'docker_artifact_validation' 'timeout-minutes: 40' \
  'Docker artifact validation must retain its bounded runtime'
assert_job_contains "$WORKFLOWS_DIR/build-docker-image.yml" 'docker_integration' 'actions/setup-node@' \
  'Docker integration must select a Node version explicitly'
assert_job_contains "$WORKFLOWS_DIR/build-docker-image.yml" 'docker_integration' 'node-version: ${{ env.NODE_VERSION }}' \
  'Docker integration must use the workflow Node version'
test -f "$ROOT_DIR/scripts/verify-docker-npm-pin.mjs" || fail 'Docker npm registry verification script must exist'
assert_job_contains "$PUBLISH_WORKFLOW" 'checks' 'node scripts/verify-docker-npm-pin.mjs' \
  'Docker publishing must verify global package pins against the registry'
for package in npm @earendil-works/pi-coding-agent undici; do
  assert_contains "$ROOT_DIR/scripts/verify-docker-npm-pin.mjs" "'$package'" \
    "Docker registry verification must include the $package pin"
done
assert_contains "$ROOT_DIR/scripts/verify-docker-npm-pin.mjs" "['view', selector, 'version', 'engines', '--json']" \
  'Docker package verification must query exact selector version and engine metadata'
assert_contains "$ROOT_DIR/scripts/verify-docker-npm-pin.mjs" "semver.satisfies(NODE_VERSION, nodeRange)" \
  'Docker package verification must require Node 24 support for every pin'

for job in prepare type_check_changed type_check_full checks docker_integration build_candidate scan verify promote; do
  case "$job" in
    prepare) timeout=10 ;;
    type_check_changed) timeout=20 ;;
    type_check_full) timeout=30 ;;
    checks) timeout=90 ;;
    docker_integration) timeout=90 ;;
    build_candidate) timeout=180 ;;
    scan) timeout=45 ;;
    verify) timeout=45 ;;
    promote) timeout=15 ;;
  esac
  assert_job_contains "$WORKFLOWS_DIR/build-docker-image.yml" "$job" "timeout-minutes: $timeout" \
    "Docker workflow job $job must have a bounded runtime"
done
assert_job_contains "$RELEASE_WORKFLOW" 'release' 'timeout-minutes: 120' \
  'Release validation must have a bounded runtime'
assert_job_contains "$WORKFLOWS_DIR/publish-npm.yml" 'publish' 'timeout-minutes: 90' \
  'npm publishing must have a bounded runtime'
assert_job_contains "$WORKFLOWS_DIR/publish-npm.yml" 'publish' 'package-manager-cache: false' \
  'npm release publishing must not restore package-manager caches'
assert_contains "$WORKFLOWS_DIR/publish-npm.yml" 'KASEKI_NPM_VERIFY_METADATA_FILE: /tmp/npm-publish-diagnostics/npm-view.json' \
  'npm verification must persist the actual registry response in the diagnostic directory'
assert_contains "$WORKFLOWS_DIR/publish-npm.yml" 'path: /tmp/npm-publish-diagnostics/' \
  'npm publishing must upload the complete diagnostic directory'
assert_contains "$WORKFLOWS_DIR/publish-npm.yml" 'npm-pack-dry-run.json' \
  'npm publish diagnostics must include package metadata'
assert_not_contains "$WORKFLOWS_DIR/publish-npm.yml" 'path: /tmp/npm-view.json' \
  'npm publishing must not upload the obsolete standalone metadata path'
assert_not_matching "$WORKFLOWS_DIR/publish-npm.yml" 'path:.*\.npmrc' \
  'npm publish artifacts must never include generated npm configuration'

assert_job_contains "$KASEKI_DOCS_WORKFLOW" 'docs_sweep' "if: github.ref == 'refs/heads/main'" \
  'Documentation sweeps must be restricted to main'
assert_job_contains "$KASEKI_DRY_WORKFLOW" 'dry_sweep' "if: github.ref == 'refs/heads/main'" \
  'DRY sweeps must be restricted to main'
assert_contains "$KASEKI_DOCS_WORKFLOW" 'REF: main' \
  'Documentation sweeps must target main explicitly'
assert_contains "$KASEKI_DRY_WORKFLOW" 'REF: main' \
  'DRY sweeps must target main explicitly'

assert_contains "$PUBLISH_WORKFLOW" '  scan:' \
  'Published images must be vulnerability scanned'
assert_contains "$PUBLISH_WORKFLOW" 'scanners: vuln' \
  'Trivy must scan vulnerabilities only; repository secrets are not image findings'
assert_contains "$PUBLISH_WORKFLOW" 'Trivy high/critical findings' \
  'Trivy findings must be summarized before the gate fails'
assert_contains "$PUBLISH_WORKFLOW" '($result.Target // "unknown target")' \
  'Trivy finding summaries must identify the affected scan target'
assert_contains "$PUBLISH_WORKFLOW" '(.PkgPath // "no package path")' \
  'Trivy finding summaries must include package location metadata'
assert_contains "$PUBLISH_WORKFLOW" 'needs: [prepare, build_candidate, verify, scan]' \
  'Promotion must wait for a successful vulnerability scan'
assert_contains "$PUBLISH_WORKFLOW" 'tags="latest"' \
  'Every published Docker image must be promoted to the latest tag'
assert_contains "$PUBLISH_WORKFLOW" 'tags+=",main-$short_sha"' \
  'Non-release Docker builds must retain a main-specific tag'
assert_contains "$PUBLISH_WORKFLOW" 'tags+=",$RELEASE_VERSION"' \
  'Release Docker builds must retain their version-specific tag'

assert_contains "$ROOT_DIR/Dockerfile" 'node:24-bookworm-slim@sha256:' \
  'The Docker base image must be pinned by digest'
assert_contains "$ROOT_DIR/.github/dependabot.yml" 'package-ecosystem: "docker"' \
  'Dependabot must keep Docker base-image digests current'

printf '✓ GitHub workflow contracts passed.\n'
