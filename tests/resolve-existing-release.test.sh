#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin" "$tmp_dir/repo"
cat > "$tmp_dir/bin/gh" <<'GH_STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == release && "${2:-}" == view && "${3:-}" == "v${EXPECTED_RELEASE_VERSION:-}" ]] || {
  echo "unexpected gh invocation: $*" >&2
  exit 2
}
[[ "${GH_RELEASE_AVAILABLE:-true}" == true ]]
GH_STUB
chmod +x "$tmp_dir/bin/gh"

git -C "$tmp_dir/repo" init --quiet -b main
git -C "$tmp_dir/repo" config user.name 'Release resolution test'
git -C "$tmp_dir/repo" config user.email 'release-resolution-test@example.invalid'
printf '{"name":"fixture","version":"1.2.3"}\n' > "$tmp_dir/repo/package.json"
git -C "$tmp_dir/repo" add package.json
git -C "$tmp_dir/repo" commit --quiet -m 'release 1.2.3'
git -C "$tmp_dir/repo" tag v1.2.3
release_sha="$(git -C "$tmp_dir/repo" rev-parse HEAD)"
git -C "$tmp_dir/repo" tag v1.2.4 "$release_sha"

# Recovery remains valid after main advances beyond the release tag.
printf '{"name":"fixture","version":"1.2.4"}\n' > "$tmp_dir/repo/package.json"
git -C "$tmp_dir/repo" add package.json
git -C "$tmp_dir/repo" commit --quiet -m 'prepare 1.2.4'

resolved="$(cd "$tmp_dir/repo" && PATH="$tmp_dir/bin:$PATH" EXPECTED_RELEASE_VERSION=1.2.3 \
  "$ROOT_DIR/scripts/resolve-existing-release.sh" 1.2.3)"
[[ "$resolved" == $'version=1.2.3\nsha='"$release_sha" ]] || {
  echo "unexpected recovery target output: $resolved" >&2
  exit 1
}

wrong_version_log="$tmp_dir/wrong-version.log"
if (cd "$tmp_dir/repo" && PATH="$tmp_dir/bin:$PATH" EXPECTED_RELEASE_VERSION=1.2.4 \
  "$ROOT_DIR/scripts/resolve-existing-release.sh" 1.2.4) >"$wrong_version_log" 2>&1; then
  echo 'recovery must reject a requested version that does not match the tag package metadata' >&2
  exit 1
fi
grep -Fq 'Release tag v1.2.4 contains package version 1.2.3' "$wrong_version_log" || {
  echo 'the mismatch test must fail at the package-version validation check' >&2
  cat "$wrong_version_log" >&2
  exit 1
}

if (cd "$tmp_dir/repo" && PATH="$tmp_dir/bin:$PATH" EXPECTED_RELEASE_VERSION=1.2.5 \
  "$ROOT_DIR/scripts/resolve-existing-release.sh" 1.2.5) >/dev/null 2>&1; then
  echo 'recovery must reject a version without a tag' >&2
  exit 1
fi

git -C "$tmp_dir/repo" checkout --quiet --orphan orphan
printf '{"name":"fixture","version":"1.2.5"}\n' > "$tmp_dir/repo/package.json"
git -C "$tmp_dir/repo" add package.json
git -C "$tmp_dir/repo" commit --quiet -m 'unreachable release'
git -C "$tmp_dir/repo" tag v1.2.5
git -C "$tmp_dir/repo" checkout --quiet main
if (cd "$tmp_dir/repo" && PATH="$tmp_dir/bin:$PATH" EXPECTED_RELEASE_VERSION=1.2.5 \
  "$ROOT_DIR/scripts/resolve-existing-release.sh" 1.2.5) >/dev/null 2>&1; then
  echo 'recovery must reject a release tag that is not reachable from main' >&2
  exit 1
fi

missing_release_log="$tmp_dir/missing-release.log"
if (cd "$tmp_dir/repo" && PATH="$tmp_dir/bin:$PATH" EXPECTED_RELEASE_VERSION=1.2.3 GH_RELEASE_AVAILABLE=false \
  "$ROOT_DIR/scripts/resolve-existing-release.sh" 1.2.3) >"$missing_release_log" 2>&1; then
  echo 'recovery must reject a tag with no GitHub release' >&2
  exit 1
fi
grep -Fq 'GitHub release v1.2.3 does not exist or is inaccessible' "$missing_release_log" || {
  echo 'missing-release failures must include a clear diagnostic' >&2
  cat "$missing_release_log" >&2
  exit 1
}

echo 'existing release resolution tests passed'
