#!/usr/bin/env bash
# Return the missing executable in a tokenized simple command, if any. We only
# inspect the first command word after leading assignments; wrapper commands
# are intentionally left to the validation runner.
validation_command_preflight_missing_executable() {
  local log_file="$1" line
  [ -r "$log_file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '[validation toolchain preflight] missing_executable='*)
        printf '%s' "${line#*=}"
        return 0
        ;;
    esac
  done < "$log_file"
  return 1
}

validation_command_first_missing_executable() {
  local word executable
  for word in "$@"; do
    [[ "$word" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ ]] && continue
    executable="$word"
    [ -n "$executable" ] || return 1
    [ "$executable" = "none" ] && return 1

    case "$executable" in
      cd|export|set|unset|umask|pushd|popd|read|shift|trap|local|declare|typeset)
        return 1
        ;;
      env|command|exec|builtin|time|timeout|sudo|nice|nohup|bash|sh)
        return 1
        ;;
      if|then|else|elif|fi|for|while|until|select|do|done|case|'esac'|function|'{'|'}'|'('|')'|'!')
        return 1
        ;;
    esac

    if [[ "$executable" == */* ]]; then
      [ -x "$executable" ] || { printf '%s' "$executable"; return 0; }
    elif ! command -v "$executable" >/dev/null 2>&1; then
      printf '%s' "$executable"
      return 0
    fi
    return 1
  done

  return 1
}

# Helpers for catching missing direct validation executables before expensive
# dependency and baseline work starts. This lexer recognizes shell quoting and
# top-level command separators, but never evaluates validation text. Compound
# shell wrappers are left to the normal validation runner.
validation_command_missing_executable() {
  local commands="$1" quote="" token="" char next_char missing
  local escape_next=0 token_started=0 i
  local -a words=()

  for ((i = 0; i < ${#commands}; i++)); do
    char="${commands:i:1}"

    if [ "$quote" = "'" ]; then
      if [ "$char" = "'" ]; then quote=""; else token+="$char"; fi
      token_started=1
      continue
    fi
    if [ "$quote" = '"' ]; then
      if [ "$escape_next" -eq 1 ]; then
        token+="$char"
        escape_next=0
      elif [ "$char" = "\\" ]; then
        escape_next=1
      elif [ "$char" = '"' ]; then
        quote=""
      else
        token+="$char"
      fi
      token_started=1
      continue
    fi

    if [ "$escape_next" -eq 1 ]; then
      token+="$char"
      token_started=1
      escape_next=0
      continue
    fi
    if [ "$char" = "\\" ]; then
      escape_next=1
      token_started=1
      continue
    fi
    if [ "$char" = "'" ] || [ "$char" = '"' ]; then
      quote="$char"
      token_started=1
      continue
    fi

    if [ "$char" = '#' ] && [ "$token_started" -eq 0 ]; then
      while [ "$i" -lt "${#commands}" ] && [ "${commands:i:1}" != $'\n' ]; do
        i=$((i + 1))
      done
      continue
    fi

    case "$char" in
      ' '|$'\t'|$'\r')
        if [ "$token_started" -eq 1 ]; then words+=("$token"); token=""; token_started=0; fi
        ;;
      ';'|'|'|'&'|$'\n')
        if [ "$token_started" -eq 1 ]; then words+=("$token"); token=""; token_started=0; fi
        if [ "${#words[@]}" -gt 0 ]; then
          missing="$(validation_command_first_missing_executable "${words[@]}")" && {
            printf '%s' "$missing"
            return 0
          }
        fi
        words=()
        next_char="${commands:i+1:1}"
        if { [ "$char" = '&' ] && [ "$next_char" = '&' ]; } || \
          { [ "$char" = '|' ] && [ "$next_char" = '|' ]; }; then
          i=$((i + 1))
        fi
        ;;
      *)
        token+="$char"
        token_started=1
        ;;
    esac
  done

  # An unterminated quote is a shell syntax error, not evidence of a missing
  # executable. Let the real validation runner report it.
  [ -z "$quote" ] || return 1
  if [ "$token_started" -eq 1 ]; then words+=("$token"); fi
  if [ "${#words[@]}" -gt 0 ]; then
    missing="$(validation_command_first_missing_executable "${words[@]}")" && {
      printf '%s' "$missing"
      return 0
    }
  fi

  return 1
}

validation_command_preflight() {
  local commands="$1" log_file="$2" repo_root="${3:-}" checked_commands="$1" missing syntax_output helper syntax_status

  # Validate without evaluating any part of the submitted shell text. This
  # catches malformed requests before they can be split or partially run.
  if syntax_output="$(bash -n -c "$commands" 2>&1)"; then
    syntax_status=0
  else
    syntax_status=$?
  fi
  if [ "$syntax_status" -ne 0 ]; then
    {
      printf '[validation command syntax preflight] invalid_shell_syntax\n'
      printf '[validation command syntax preflight] commands=%s\n' "$commands"
      printf '%s\n' "$syntax_output" | head -n 20
      printf 'Validation was not started because the configured command has invalid shell syntax.\n'
      printf 'exit_code=2\n'
    } > "$log_file"
    return 2
  fi

  # Expand straightforward npm run chains in the target repository so the
  # preflight can catch missing tools such as tsc hidden in `npm run check`.
  if [ -n "$repo_root" ] && [ -d "$repo_root" ]; then
    helper="$(dirname "${BASH_SOURCE[0]}")/validation-runtime.mjs"
    [ -r "$helper" ] || helper=/app/scripts/validation-runtime.mjs
    if [ -r "$helper" ] && command -v node >/dev/null 2>&1; then
      checked_commands="$(cd -- "$repo_root" && node "$helper" expand-preflight "$commands")" || checked_commands="$commands"
    fi
  fi

  missing="$(validation_command_missing_executable "$checked_commands")" || return 0
  {
    printf '[validation toolchain preflight] missing_executable=%s\n' "$missing"
    printf '[validation toolchain preflight] commands=%s\n' "$commands"
    [ "$checked_commands" = "$commands" ] || printf '[validation toolchain preflight] expanded_commands=%s\n' "$checked_commands"
    printf 'Validation was not started because the validation environment does not provide the required executable.\n'
    printf 'Install it as a project dependency or in the worker image, or choose a supported validation command.\n'
    printf 'exit_code=127\n'
  } > "$log_file"
  return 127
}

validation_runtime_identity() {
  local go_version make_version gcc_version
  go_version="$(go version 2>/dev/null | head -n 1 || printf '<unavailable>')"
  make_version="$(make --version 2>/dev/null | head -n 1 || printf '<unavailable>')"
  gcc_version="$(gcc --version 2>/dev/null | head -n 1 || printf '<unavailable>')"
  printf 'npm=%s\nbun=%s\nkernel=%s\narch=%s\npage_size=%s\nvirtual_memory_limit=%s\nimage=%s\ngo=%s\nmake=%s\ngcc=%s' \
    "$(npm --version 2>/dev/null || printf '<unavailable>')" "$(bun --version 2>/dev/null || printf '<unavailable>')" \
    "$(uname -sr)" "$(uname -m)" "$(getconf PAGESIZE 2>/dev/null || true)" "$(ulimit -v)" "${KASEKI_RUNNER_IMAGE_ID:-unknown}" \
    "$go_version" "$make_version" "$gcc_version"
}
