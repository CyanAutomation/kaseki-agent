#!/usr/bin/env bash
# Helpers for catching missing direct validation executables before expensive
# dependency and baseline work starts. Compound shell wrappers are left to the
# normal validation runner; simple commands (including commands after &&/||/|)
# are checked without executing user-provided validation text.

validation_command_missing_executable() {
  local commands="$1" command trimmed word executable
  local -a requested_commands words
  IFS=';' read -r -a requested_commands <<< "$commands"

  for command in "${requested_commands[@]}"; do
    trimmed="$command"
    trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    [ -n "$trimmed" ] || continue
    read -r -a words <<< "$trimmed"
    executable=""
    local check_next=1 skip_simple_command=0
    for word in "${words[@]}"; do
      case "$word" in
        '&&'|'||'|'|'|';')
          check_next=1
          skip_simple_command=0
          continue
          ;;
      esac
      [ "$skip_simple_command" -eq 0 ] || continue
      [ "$check_next" -eq 1 ] || continue
      [[ "$word" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ ]] && continue
      executable="${word#\"}"
      executable="${executable%\"}"
      executable="${executable#\'}"
      executable="${executable%\'}"
      check_next=0

      # Shell builtins can prefix a direct command, for example `cd repo && go test`.
      case "$executable" in
        cd|export|set|unset|umask|pushd|popd|read|shift|trap|local|declare|typeset)
          skip_simple_command=1
          check_next=1
          executable=""
          continue
          ;;
        env|command|exec|builtin|time|timeout|sudo|nice|nohup|bash|sh)
          # A wrapper may dispatch a nested command; do not guess through its options.
          skip_simple_command=1
          executable=""
          continue
          ;;
      esac

      if [[ "$executable" == */* ]]; then
        [ -x "$executable" ] || { printf '%s' "$executable"; return 0; }
      elif ! command -v "$executable" >/dev/null 2>&1; then
        printf '%s' "$executable"
        return 0
      fi
      skip_simple_command=1
    done
  done

  return 1
}

validation_command_preflight() {
  local commands="$1" log_file="$2" missing
  missing="$(validation_command_missing_executable "$commands")" || return 0
  {
    printf '[validation toolchain preflight] missing_executable=%s\n' "$missing"
    printf '[validation toolchain preflight] commands=%s\n' "$commands"
    printf 'Validation was not started because the worker image does not provide the required executable.\n'
    printf 'Install the toolchain in the worker image or choose validation commands supported by this image.\n'
    printf 'exit_code=127\n'
  } > "$log_file"
  return 127
}

validation_runtime_identity() {
  local go_version make_version gcc_version
  go_version="$(go version 2>/dev/null | head -n 1 || printf '<unavailable>')"
  make_version="$(make --version 2>/dev/null | head -n 1 || printf '<unavailable>')"
  gcc_version="$(gcc --version 2>/dev/null | head -n 1 || printf '<unavailable>')"
  printf 'go=%s\nmake=%s\ngcc=%s' "$go_version" "$make_version" "$gcc_version"
}
