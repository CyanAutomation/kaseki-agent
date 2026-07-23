#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
relocated_script="$2"
scouting_templates_dir="$(dirname "$relocated_script")/templates/scouting"

mkdir -p "$scouting_templates_dir"
cp "$repo_root"/templates/scouting/* "$scouting_templates_dir/"
[ -r "$scouting_templates_dir/compact.txt" ] || {
  printf 'relocated script compact scouting template is not readable: %s\n' "$scouting_templates_dir/compact.txt" >&2
  exit 1
}
