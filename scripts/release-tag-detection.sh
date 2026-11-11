#!/usr/bin/env bash

release_tag_snapshot() {
  git tag --list 'v[0-9]*' | LC_ALL=C sort
}

detect_new_release_tag() {
  local before_file="${1:?Usage: detect_new_release_tag BEFORE_FILE AFTER_FILE}"
  local after_file="${2:?Usage: detect_new_release_tag BEFORE_FILE AFTER_FILE}"
  local new_tags
  local -a tags=()

  new_tags="$(LC_ALL=C comm -13 "$before_file" "$after_file")" || return $?
  [[ -n "$new_tags" ]] || return 0

  mapfile -t tags <<< "$new_tags"
  if (( ${#tags[@]} != 1 )); then
    printf 'Expected at most one new release tag; found %s:\n%s\n' \
      "${#tags[@]}" "$new_tags" >&2
    return 1
  fi

  printf '%s\n' "${tags[0]}"
}
