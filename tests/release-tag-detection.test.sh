#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/release-tag-detection.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

git -C "$tmp_dir" init --quiet
git -C "$tmp_dir" config user.name 'Release tag test'
git -C "$tmp_dir" config user.email 'release-tag-test@example.invalid'
printf 'fixture\n' > "$tmp_dir/fixture.txt"
git -C "$tmp_dir" add fixture.txt
git -C "$tmp_dir" commit --quiet -m fixture

git -C "$tmp_dir" tag v1.9.0
git -C "$tmp_dir" tag v1.10.0
git -C "$tmp_dir" tag v1.100.0
before_file="$tmp_dir/before-tags"
after_file="$tmp_dir/after-tags"

cd "$tmp_dir"
release_tag_snapshot > "$before_file"
expected_order="$(printf '%s\n' v1.10.0 v1.100.0 v1.9.0 | LC_ALL=C sort)"
[[ "$(cat "$before_file")" == "$expected_order" ]] || {
  echo 'release tag snapshots must use bytewise C-locale ordering' >&2
  exit 1
}

git tag v1.158.0
release_tag_snapshot > "$after_file"
new_tag="$(detect_new_release_tag "$before_file" "$after_file")"
[[ "$new_tag" == v1.158.0 ]] || {
  echo "expected the new release tag v1.158.0, got '$new_tag'" >&2
  exit 1
}

detect_new_release_tag "$after_file" "$after_file" > "$tmp_dir/no-new-tag"
[[ ! -s "$tmp_dir/no-new-tag" ]] || {
  echo 'an unchanged tag set must not report a new tag' >&2
  exit 1
}

git tag v1.159.0
git tag v1.160.0
release_tag_snapshot > "$tmp_dir/multiple-new-tags"
if detect_new_release_tag "$after_file" "$tmp_dir/multiple-new-tags" > /dev/null 2>&1; then
  echo 'release detection must reject multiple newly-created tags' >&2
  exit 1
fi

echo 'release tag detection tests passed'
