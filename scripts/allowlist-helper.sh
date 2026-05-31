#!/usr/bin/env bash

# Convert a glob-style repo-relative allowlist pattern into an extended regex.
# Supported glob operators:
# - * matches within a single path segment
# - ** matches across path segments
# - **/ matches zero or more path segments
# - ? matches one character within a single path segment
# All other regex metacharacters are escaped so exact path patterns remain exact.
allowlist_pattern_to_regex() {
  awk -v pattern="$1" '
    BEGIN {
      regex = ""
      i = 1
      while (i <= length(pattern)) {
        c = substr(pattern, i, 1)
        next_c = substr(pattern, i + 1, 1)
        next_next_c = substr(pattern, i + 2, 1)

        if (c == "*" && next_c == "*") {
          if (next_next_c == "/") {
            regex = regex "([^/]+/)*"
            i += 3
          } else {
            regex = regex ".*"
            i += 2
          }
        } else if (c == "*") {
          regex = regex "[^/]*"
          i++
        } else if (c == "?") {
          regex = regex "[^/]"
          i++
        } else {
          if (index(".\\^$()+{}|[]", c) > 0) {
            regex = regex "\\" c
          } else {
            regex = regex c
          }
          i++
        }
      }
      print regex
    }
  '
}

build_allowlist_regex() {
  local patterns pattern regexes=()
  patterns="${1:-${KASEKI_CHANGED_FILES_ALLOWLIST:-}}"
  while IFS= read -r pattern || [ -n "$pattern" ]; do
    [ -z "$pattern" ] && continue
    regexes+=("$(allowlist_pattern_to_regex "$pattern")")
  done < <(printf '%s\n' "$patterns" | tr ' ' '\n')

  (IFS='|'; printf '%s' "${regexes[*]}")
}
