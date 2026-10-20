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

assert_top_level_not_contains() {
  local file="$1"
  local unexpected="$2"
  local message="$3"
  awk -v unexpected="$unexpected" '
    /^jobs:/ { exit }
    index($0, unexpected) { found = 1 }
    END { exit found }
  ' "$file" || fail "$message"
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

assert_job_not_contains() {
  local file="$1"
  local job="$2"
  local unexpected="$3"
  local message="$4"
  awk -v target="$job" -v unexpected="$unexpected" '
    $0 == "  " target ":" { in_job = 1; next }
    in_job && /^  [[:alnum:]_-]+:/ { in_job = 0 }
    in_job && index($0, unexpected) { found = 1 }
    END { exit found }
  ' "$file" || fail "$message"
}

assert_step_contains() {
  local file="$1"
  local step="$2"
  local expected="$3"
  local message="$4"
  awk -v target="$step" -v expected="$expected" '
    $0 == "      - name: " target { in_step = 1; next }
    in_step && /^      - name:/ { in_step = 0 }
    in_step && index($0, expected) { found = 1 }
    END { exit !found }
  ' "$file" || fail "$message"
}

assert_step_not_contains() {
  local file="$1"
  local step="$2"
  local unexpected="$3"
  local message="$4"
  awk -v target="$step" -v unexpected="$unexpected" '
    $0 == "      - name: " target { in_step = 1; next }
    in_step && /^      - name:/ { in_step = 0 }
    in_step && index($0, unexpected) { found = 1 }
    END { exit found }
  ' "$file" || fail "$message"
}

RELEASE_WORKFLOW="$WORKFLOWS_DIR/release.yml"
PUBLISH_WORKFLOW="$WORKFLOWS_DIR/build-docker-image.yml"
CODEQL_WORKFLOW="$WORKFLOWS_DIR/codeql.yml"
DEPENDENCY_REVIEW_WORKFLOW="$WORKFLOWS_DIR/dependency-review.yml"
DEPENDABOT_CONFIG="$ROOT_DIR/.github/dependabot.yml"
CI_WORKFLOW="$WORKFLOWS_DIR/ci.yml"
NPM_PUBLISH_WORKFLOW="$WORKFLOWS_DIR/publish-npm.yml"
KASEKI_DOCS_WORKFLOW="$WORKFLOWS_DIR/kaseki-docs.yaml"
KASEKI_DRY_WORKFLOW="$WORKFLOWS_DIR/kaseki-dry.yaml"

assert_contains "$RELEASE_WORKFLOW" 'workflow_dispatch:' \
  'Releases must remain manually invoked'
assert_not_contains "$RELEASE_WORKFLOW" '  push:' \
  'Release workflow must not run automatically on pushes'
assert_contains "$RELEASE_WORKFLOW" 'environment: release' \
  'Release creation must be protected by the release environment'
assert_contains "$RELEASE_WORKFLOW" 'permissions: {}' \
  'The release workflow must deny permissions by default'
assert_job_contains "$RELEASE_WORKFLOW" 'validate' 'contents: read' \
  'Release validation must use read-only repository permissions'
assert_job_not_contains "$RELEASE_WORKFLOW" 'validate' 'contents: write' \
  'Release validation must not receive repository write permissions'
assert_job_contains "$RELEASE_WORKFLOW" 'validate' 'persist-credentials: false' \
  'Release validation checkout must not persist its token'
assert_job_contains "$RELEASE_WORKFLOW" 'dry_run' "if: github.ref == 'refs/heads/main' && inputs.dry_run == 'true'" \
  'Dry-run must execute in its own read-only job on main'
assert_job_contains "$RELEASE_WORKFLOW" 'dry_run' 'contents: read' \
  'Dry-run must use read-only repository permissions'
assert_job_not_contains "$RELEASE_WORKFLOW" 'dry_run' 'contents: write' \
  'Dry-run must not receive repository write permissions'
assert_job_contains "$RELEASE_WORKFLOW" 'release' "if: github.ref == 'refs/heads/main' && inputs.dry_run != 'true'" \
  'The write-enabled release job must not run for dry-runs'
assert_job_contains "$RELEASE_WORKFLOW" 'release' 'contents: write' \
  'The real release job must have permission to create releases'
assert_job_contains "$RELEASE_WORKFLOW" 'release' 'persist-credentials: false' \
  'The real release checkout must not persist its token'
assert_not_contains "$RELEASE_WORKFLOW" 'github.event.inputs.dry_run' \
  'The release script must not interpolate a workflow input into shell source'
assert_not_contains "$RELEASE_WORKFLOW" 'secrets: inherit' \
  'The Docker reusable workflow must not inherit unrelated secrets'
assert_job_contains "$RELEASE_WORKFLOW" 'publish_docker' 'DOCKER_USERNAME: ${{ secrets.DOCKER_USERNAME }}' \
  'The Docker reusable workflow must receive the Docker Hub username explicitly'
assert_job_contains "$RELEASE_WORKFLOW" 'publish_docker' 'DOCKER_PASSWORD: ${{ secrets.DOCKER_PASSWORD }}' \
  'The Docker reusable workflow must receive the Docker Hub password explicitly'
assert_contains "$PUBLISH_WORKFLOW" '      DOCKER_USERNAME:' \
  'The Docker reusable workflow must declare its Docker Hub username secret'
assert_contains "$PUBLISH_WORKFLOW" '      DOCKER_PASSWORD:' \
  'The Docker reusable workflow must declare its Docker Hub password secret'
for job in build_candidate verify promote; do
  assert_job_contains "$PUBLISH_WORKFLOW" "$job" 'name: Validate Docker Hub credentials' \
    "The $job job must explain when Docker Hub credentials are missing"
done
assert_step_contains "$PUBLISH_WORKFLOW" 'Validate Docker Hub credentials' \
  'Configure DOCKER_USERNAME and DOCKER_PASSWORD as repository or organization Actions secrets.' \
  'Missing Docker Hub credentials must point to the required Actions secret configuration'
assert_step_contains "$PUBLISH_WORKFLOW" 'Validate Docker Hub credentials' \
  'DOCKER_USERNAME: ${{ secrets.DOCKER_USERNAME }}' \
  'Docker Hub credential validation must check the username used by the login action'
assert_step_contains "$PUBLISH_WORKFLOW" 'Validate Docker Hub credentials' \
  'DOCKER_PASSWORD: ${{ secrets.DOCKER_PASSWORD }}' \
  'Docker Hub credential validation must check the password used by the login action'
assert_not_contains "$RELEASE_WORKFLOW" 'grep -q "Published release"' \
  'Release detection must not rely on semantic-release log wording'
assert_step_contains "$RELEASE_WORKFLOW" 'Install pinned Bun for target repository tests' \
  'const bunVersion = require("./docker/image-toolchain/package.json").dependencies?.bun;' \
  'Release validation must read the Bun pin from the target repository toolchain metadata'
assert_step_contains "$RELEASE_WORKFLOW" 'Install pinned Bun for target repository tests' \
  'if (typeof bunVersion !== "string" || semver.valid(bunVersion) !== bunVersion) {' \
  'Release validation must reject a missing Bun pin or a non-exact version'
assert_step_contains "$RELEASE_WORKFLOW" 'Install pinned Bun for target repository tests' \
  'ERROR: dependencies.bun in docker/image-toolchain/package.json must be an exact semantic version' \
  'Release validation must explain when its Bun pin is invalid'
assert_step_contains "$RELEASE_WORKFLOW" 'Install pinned Bun for target repository tests' \
  'npm install --prefix "$RUNNER_TEMP/kaseki-bun" --no-audit "bun@$bun_version"' \
  'Release validation must install the pinned Bun npm package in an isolated prefix'
assert_step_contains "$RELEASE_WORKFLOW" 'Install pinned Bun for target repository tests' \
  'echo "$RUNNER_TEMP/kaseki-bun/node_modules/.bin" >> "$GITHUB_PATH"' \
  'Release validation must add the installed Bun binary to PATH for subsequent test steps'
awk '
  $0 == "      - name: Install pinned Bun for target repository tests" { install = NR }
  $0 == "      - name: Run release validation suite" { suite = NR }
  END { exit !(install && suite && install < suite) }
' "$RELEASE_WORKFLOW" || fail 'Release validation must install Bun before running the test suite'
assert_contains "$RELEASE_WORKFLOW" 'comm -13' \
  'Release detection must identify the newly-created immutable tag'
assert_step_contains "$RELEASE_WORKFLOW" 'Run semantic-release' 'GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}' \
  'The write-capable token must be scoped to the semantic-release step'
assert_step_contains "$RELEASE_WORKFLOW" 'Publish Raspberry Pi bootstrap bundle' 'GH_TOKEN: ${{ github.token }}' \
  'The GitHub token must be scoped to the release asset upload step'
assert_step_contains "$RELEASE_WORKFLOW" 'Run semantic-release dry-run' 'GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}' \
  'The read-only token must be scoped to the dry-run semantic-release step'
assert_step_contains "$RELEASE_WORKFLOW" 'Run semantic-release dry-run' 'npm run release:dry' \
  'The dry-run job must run semantic-release in preview mode'
assert_job_contains "$RELEASE_WORKFLOW" 'publish_npm' 'uses: ./.github/workflows/publish-npm.yml' \
  'Successful releases must invoke the npm publisher'
assert_job_contains "$RELEASE_WORKFLOW" 'publish_npm' 'id-token: write' \
  'npm publishing must use OIDC'
assert_job_contains "$RELEASE_WORKFLOW" 'publish_npm' 'needs: release' \
  'npm publishing must wait for a successful release'
assert_job_contains "$RELEASE_WORKFLOW" 'publish_npm' "if: needs.release.outputs.released == 'true'" \
  'npm publishing must be skipped when semantic-release creates no release'
assert_job_contains "$RELEASE_WORKFLOW" 'release' 'kaseki-agent-source.tar.gz' \
  'A successful release must publish the source bundle used by Pi bootstrap'
assert_job_contains "$RELEASE_WORKFLOW" 'release' 'sha256sum "$archive"' \
  'The Pi bootstrap release bundle must have a SHA-256 checksum'
assert_job_contains "$RELEASE_WORKFLOW" 'release' 'gh release upload' \
  'The Pi bootstrap bundle and checksum must be uploaded to the GitHub release'

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
assert_job_contains "$PUBLISH_WORKFLOW" 'verify' 'docker run --rm --entrypoint pi "$DOCKER_HUB_CANDIDATE_IMAGE" --version' \
  'Docker Hub candidate verification must smoke-test the Pi CLI'
assert_job_contains "$PUBLISH_WORKFLOW" 'verify' 'docker run --rm --entrypoint pi "$GHCR_CANDIDATE_IMAGE" --version' \
  'GHCR candidate verification must smoke-test the Pi CLI'
assert_not_contains "$PUBLISH_WORKFLOW" 'pi-coding-agent/dist/experimental/server.js' \
  'Docker candidate verification must not invoke the removed Pi experimental server entrypoint'
for package in npm @earendil-works/pi-coding-agent @earendil-works/pi-server undici brace-expansion; do
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
assert_job_contains "$RELEASE_WORKFLOW" 'validate' 'timeout-minutes: 120' \
  'Release validation must have a bounded runtime'
assert_job_contains "$RELEASE_WORKFLOW" 'dry_run' 'timeout-minutes: 120' \
  'Release dry-run must retain its bounded runtime'
assert_job_contains "$RELEASE_WORKFLOW" 'release' 'timeout-minutes: 120' \
  'Release publishing must have a bounded runtime'
assert_job_contains "$PUBLISH_WORKFLOW" 'prepare' "if: github.ref == 'refs/heads/main' && github.repository == 'CyanAutomation/kaseki-agent'" \
  'Manual and scheduled Docker publishes must be restricted to the canonical main repository'
assert_job_contains "$WORKFLOWS_DIR/publish-npm.yml" 'publish' 'timeout-minutes: 90' \
  'npm publishing must have a bounded runtime'
assert_job_contains "$WORKFLOWS_DIR/publish-npm.yml" 'publish' 'package-manager-cache: false' \
  'npm release publishing must not restore package-manager caches'
assert_contains "$WORKFLOWS_DIR/publish-npm.yml" 'KASEKI_NPM_VERIFY_METADATA_FILE: /tmp/npm-publish-diagnostics/npm-view.json' \
  'npm verification must persist the actual registry response in the diagnostic directory'
assert_contains "$WORKFLOWS_DIR/publish-npm.yml" 'npm-verify-publish.sh "$(node -p "require('"'"'./package.json'"'"').name")" "$VERSION" 300' \
  'npm verification must allow a five-minute registry propagation deadline'
assert_contains "$WORKFLOWS_DIR/publish-npm.yml" 'path: /tmp/npm-publish-diagnostics/' \
  'npm publishing must upload the complete diagnostic directory'
assert_contains "$WORKFLOWS_DIR/publish-npm.yml" 'npm-pack-dry-run.json' \
  'npm publish diagnostics must include package metadata'
assert_not_contains "$WORKFLOWS_DIR/publish-npm.yml" 'path: /tmp/npm-view.json' \
  'npm publishing must not upload the obsolete standalone metadata path'
assert_not_matching "$WORKFLOWS_DIR/publish-npm.yml" 'path:.*\.npmrc' \
  'npm publish artifacts must never include generated npm configuration'
assert_top_level_not_contains "$NPM_PUBLISH_WORKFLOW" 'id-token: write' \
  'The npm publisher must not grant OIDC permission to all jobs'
assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'build' 'npm ci' \
  'The npm package must be built in a job without publishing credentials'
assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'build' 'npm run build' \
  'The npm package must be built before publishing'
assert_job_not_contains "$NPM_PUBLISH_WORKFLOW" 'build' 'id-token: write' \
  'The npm build job must not be able to request an OIDC token'
assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'build' 'actions/upload-artifact@' \
  'The verified npm tarball must be passed to the publish job as an artifact'
assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'publish' 'id-token: write' \
  'Only the npm publish job may request the trusted-publishing OIDC token'
assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'publish' 'actions/download-artifact@' \
  'The npm publish job must consume the verified package artifact'
assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'publish' 'npm publish "$PACKAGE_TARBALL" --access public --provenance --loglevel verbose --ignore-scripts' \
  'The npm publish job must publish the verified tarball without running package scripts'
assert_job_not_contains "$NPM_PUBLISH_WORKFLOW" 'publish' 'npm ci' \
  'The npm publish job must not install dependencies'
assert_job_not_contains "$NPM_PUBLISH_WORKFLOW" 'publish' 'npm run build' \
  'The npm publish job must not execute repository build scripts'
assert_job_not_contains "$NPM_PUBLISH_WORKFLOW" 'publish' 'npm-verify-publish.sh' \
  'The OIDC-enabled npm publish job must not execute repository verification scripts'
assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'verify' 'npm-verify-publish.sh' \
  'Published package verification must run in a separate job'
assert_job_not_contains "$NPM_PUBLISH_WORKFLOW" 'verify' 'id-token: write' \
  'The npm verification job must not be able to request an OIDC token'

assert_job_contains "$KASEKI_DOCS_WORKFLOW" 'docs_sweep' "if: github.ref == 'refs/heads/main'" \
  'Documentation sweeps must be restricted to main'
assert_job_contains "$KASEKI_DRY_WORKFLOW" 'dry_sweep' "if: github.ref == 'refs/heads/main'" \
  'DRY sweeps must be restricted to main'
assert_contains "$KASEKI_DOCS_WORKFLOW" 'REF: main' \
  'Documentation sweeps must target main explicitly'
assert_contains "$KASEKI_DRY_WORKFLOW" 'REF: main' \
  'DRY sweeps must target main explicitly'
assert_step_contains "$KASEKI_DOCS_WORKFLOW" 'Verify controller health' "jq -e '.status == \"ok\"'" \
  'Documentation sweeps must match the controller health response contract'
assert_step_contains "$KASEKI_DRY_WORKFLOW" 'Verify controller health' "jq -e '.status == \"ok\"'" \
  'DRY sweeps must match the controller health response contract'
assert_step_contains "$KASEKI_DOCS_WORKFLOW" 'Verify controller readiness' "jq -e '.status == \"ready\"'" \
  'Documentation sweeps must keep readiness separate from liveness'
assert_step_contains "$KASEKI_DRY_WORKFLOW" 'Verify controller readiness' "jq -e '.status == \"ready\"'" \
  'DRY sweeps must keep readiness separate from liveness'

assert_contains "$PUBLISH_WORKFLOW" '  scan:' \
  'Published images must be vulnerability scanned'
assert_contains "$PUBLISH_WORKFLOW" 'scanners: vuln,misconfig,secret' \
  'Trivy must scan image vulnerabilities, configuration, and embedded secrets'
assert_contains "$PUBLISH_WORKFLOW" 'scanners: vuln,misconfig' \
  'The uploaded SARIF report must omit secret match content'
go_source_dockerfile_exclusions='skip-files: usr/local/go/src/crypto/internal/boring/Dockerfile,usr/local/go/src/crypto/internal/fips140/nistec/fiat/Dockerfile'
go_source_dockerfile_exclusion_count="$(grep -Fc "$go_source_dockerfile_exclusions" "$PUBLISH_WORKFLOW" || true)"
trivy_skip_files_count="$(grep -Fc 'skip-files:' "$PUBLISH_WORKFLOW" || true)"
[[ "$go_source_dockerfile_exclusion_count" -eq 2 && "$trivy_skip_files_count" -eq 2 ]] \
  || fail 'Both Trivy reports must exclude only the upstream Go source-maintenance Dockerfiles'
assert_contains "$PUBLISH_WORKFLOW" 'ignore-unfixed: true' \
  'Trivy must exclude vulnerabilities that do not have a known fix'
assert_contains "$PUBLISH_WORKFLOW" 'scripts/check-trivy-image-findings.mjs trivy-results.json --summary trivy-results-summary.json' \
  'The Docker promotion gate must validate all high and critical Trivy findings'
assert_job_contains "$PUBLISH_WORKFLOW" 'scan' 'needs: [prepare, build_candidate]' \
  'The image scan job must declare direct dependencies for every needs output it reads'
assert_step_contains "$PUBLISH_WORKFLOW" 'Upload sanitized image scan reports' 'trivy-results-summary.json' \
  'Only sanitized Trivy findings may be retained as artifacts'
assert_step_not_contains "$PUBLISH_WORKFLOW" 'Upload sanitized image scan reports' 'trivy-results.json' \
  'Raw Trivy JSON containing secret matches must not be uploaded'
assert_contains "$PUBLISH_WORKFLOW" 'needs: [prepare, build_candidate, verify, scan]' \
  'Promotion must wait for a successful vulnerability scan'
assert_contains "$PUBLISH_WORKFLOW" 'tags="latest"' \
  'Every published Docker image must be promoted to the latest tag'
assert_contains "$PUBLISH_WORKFLOW" 'tags+=",main-$short_sha"' \
  'Non-release Docker builds must retain a main-specific tag'
assert_contains "$PUBLISH_WORKFLOW" 'tags+=",$RELEASE_VERSION"' \
  'Release Docker builds must retain their version-specific tag'

assert_job_contains "$CI_WORKFLOW" 'workflow_lint' 'go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.9' \
  'CI must run a version-pinned actionlint check'
assert_job_contains "$CI_WORKFLOW" 'workflow_lint' 'zizmorcore/zizmor-action@cc914d7f3750a2d13d75c7f184a1060aa0e9d482' \
  'CI must run a commit-pinned zizmor check'
assert_job_contains "$CI_WORKFLOW" 'workflow_lint' 'advanced-security: false' \
  'The zizmor workflow lint job must run without elevated security-events permissions'
assert_job_contains "$CI_WORKFLOW" 'workflow_lint' 'min-severity: high' \
  'Zizmor must gate CI on high-severity workflow security findings'
assert_job_contains "$CI_WORKFLOW" 'docker_artifact_validation' 'persist-credentials: false' \
  'Docker integration checkout must not persist its GitHub token'
assert_step_contains "$CI_WORKFLOW" 'Check for Docker Hub credentials' "if: github.event_name == 'push'" \
  'Docker Hub credentials must be inspected only in a trusted push workflow'
assert_step_contains "$CI_WORKFLOW" 'Authenticate to Docker Hub for base image pulls' \
  "if: github.event_name == 'push' && steps.docker_hub_credentials.outputs.available == 'true'" \
  'Docker Hub authentication must be unavailable to pull request test code'

assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'build' "if: github.repository == 'CyanAutomation/kaseki-agent' && github.ref == 'refs/heads/main'" \
  'The npm publisher must reject callers outside the canonical main repository'
assert_step_contains "$NPM_PUBLISH_WORKFLOW" 'Validate immutable source ref' \
  'REQUESTED_REF: ${{ inputs.ref }}' \
  'The npm publisher must validate its requested source ref before checkout'
assert_step_contains "$NPM_PUBLISH_WORKFLOW" 'Validate immutable source ref' \
  '[[ "$REQUESTED_REF" =~ ^[0-9a-f]{40}$ ]]' \
  'The npm publisher must require a full commit SHA'
assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'publish' "github.repository == 'CyanAutomation/kaseki-agent'" \
  'The npm publish job must reject callers outside the canonical repository'
assert_job_contains "$NPM_PUBLISH_WORKFLOW" 'verify' "github.repository == 'CyanAutomation/kaseki-agent'" \
  'The npm verify job must reject callers outside the canonical repository'
assert_step_contains "$NPM_PUBLISH_WORKFLOW" 'Confirm target version is unpublished' \
  './scripts/check-npm-version-unpublished.sh "$PACKAGE_NAME" "$VERSION"' \
  'The npm publisher must use the tested version-existence check'

assert_job_contains "$PUBLISH_WORKFLOW" 'prepare' "github.repository == 'CyanAutomation/kaseki-agent'" \
  'The Docker publisher must reject callers outside the canonical repository'
assert_step_contains "$PUBLISH_WORKFLOW" 'Validate immutable source ref' \
  'TARGET_REF: ${{ inputs.ref || github.sha }}' \
  'The Docker publisher must validate its requested source ref before checkout'
assert_step_contains "$PUBLISH_WORKFLOW" 'Validate immutable source ref' \
  '[[ "$TARGET_REF" =~ ^[0-9a-f]{40}$ ]]' \
  'The Docker publisher must require a full commit SHA'

assert_top_level_not_contains "$CODEQL_WORKFLOW" 'security-events: write' \
  'CodeQL write permission must be scoped to its analysis job'
assert_job_contains "$CODEQL_WORKFLOW" 'analyze' 'security-events: write' \
  'The CodeQL analysis job must be able to upload scan results'
assert_contains "$CODEQL_WORKFLOW" 'concurrency:' \
  'CodeQL runs must be concurrency-limited'
assert_contains "$DEPENDENCY_REVIEW_WORKFLOW" 'concurrency:' \
  'Dependency review runs must be concurrency-limited'

assert_contains "$ROOT_DIR/package.json" '"test:publish-smoke": "test -f dist/cli.js && npm run test:pack-artifact && npm pack --dry-run' \
  'Publish smoke checks must reuse the existing build instead of repeating the full packaging suite'
assert_not_contains "$ROOT_DIR/package.json" '"test:publish-smoke": "npm run test:packaging-verification"' \
  'Publish smoke checks must not rerun the full packaging verification suite'
assert_contains "$ROOT_DIR/package.json" 'node --test scripts/check-trivy-image-findings.test.mjs' \
  'Workflow contract checks must include the Trivy gate behavior tests'

assert_contains "$ROOT_DIR/Dockerfile" 'node:24-bookworm-slim@sha256:' \
  'The Docker base image must be pinned by digest'
assert_contains "$ROOT_DIR/Dockerfile" 'ARG NODE_IMAGE=docker.io/library/node:' \
  'The Docker base image must use the canonical Docker Official Image'
assert_not_contains "$ROOT_DIR/Dockerfile" '# syntax=docker/dockerfile:' \
  'Dockerfile must use the bundled BuildKit frontend instead of pulling its syntax from Docker Hub'
assert_contains "$ROOT_DIR/.github/dependabot.yml" 'package-ecosystem: "docker"' \
  'Dependabot must keep Docker base-image digests current'

printf '✓ GitHub workflow contracts passed.\n'
