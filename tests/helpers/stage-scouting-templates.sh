#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
relocated_script="$2"
relocated_root="$(dirname "$relocated_script")"
scouting_templates_dir="$relocated_root/templates/scouting"

mkdir -p "$scouting_templates_dir"
cp "$repo_root"/templates/scouting/* "$scouting_templates_dir/"
[ -r "$scouting_templates_dir/compact.txt" ] || {
  printf 'relocated script compact scouting template is not readable: %s\n' "$scouting_templates_dir/compact.txt" >&2
  exit 1
}

# Shell-regression tests relocate the agent script into a temporary directory.
# Keep that relocation aligned with the runtime helper graph so newly sourced
# helpers cannot make an otherwise focused test fail before reaching its case.
mkdir -p "$relocated_root/scripts/lib"
cp "$repo_root"/scripts/*.sh "$relocated_root/scripts/"
cp "$repo_root"/scripts/lib/*.sh "$relocated_root/scripts/lib/"
