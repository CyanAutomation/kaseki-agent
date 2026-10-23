#!/usr/bin/env bash
# Return the missing executable in a tokenized simple command, if any. We only
# inspect the first command word after leading assignments; wrapper commands
# are intentionally left to the validation runner.
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

    # Repository package binaries become available during dependency setup.
    [[ "$executable" == ./node_modules/.bin/* ]] && return 1
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
  printf 'npm=%s\nbun=%s\nkernel=%s\narch=%s\npage_size=%s\nvirtual_memory_limit=%s\nimage=%s\ngo=%s\nmake=%s\ngcc=%s' \
    "$(npm --version 2>/dev/null || printf '<unavailable>')" "$(bun --version 2>/dev/null || printf '<unavailable>')" \
    "$(uname -sr)" "$(uname -m)" "$(getconf PAGESIZE 2>/dev/null || true)" "$(ulimit -v)" "${KASEKI_RUNNER_IMAGE_ID:-unknown}" \
    "$go_version" "$make_version" "$gcc_version"
}
