#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
eval "$(awk '
  /^run_validation_user_command\(\)/ { capture=1; depth=0 }
  capture {
    print
    for (i=1; i<=length($0); i++) {
      ch=substr($0,i,1)
      if (ch=="{") depth++
      if (ch=="}") depth--
    }
    if (capture && depth==0) exit
  }
' "$ROOT_DIR/kaseki-agent.sh")"

# The worker image uses coreutils timeout; keep this function-level test
# portable to macOS shells where the GNU timeout utility is not installed.
timeout() {
  shift # --signal=TERM
  shift # --kill-after=10s
  shift # duration
  "$@"
}

if run_validation_user_command 'bash -c "exit 42" | tail -n 1; echo 0' 5 >/dev/null 2>&1; then
  printf 'FAIL: a failed pipeline was masked by a trailing echo\n' >&2
  exit 1
else
  result=$?
fi
[ "$result" -eq 42 ] || { printf 'FAIL: expected pipeline exit 42, got %s\n' "$result" >&2; exit 1; }

run_validation_user_command 'printf passed' 5 | grep -q passed
printf 'validation-command-exit-status.test.sh PASS\n'
