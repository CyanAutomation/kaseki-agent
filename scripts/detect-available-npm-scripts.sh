#!/usr/bin/env bash
# Detect available npm scripts in target repository's package.json.
# This helper queries the package.json and returns only npm scripts that are actually defined.
# Usage:
#   get_available_npm_scripts               # Returns all available scripts
#   filter_npm_commands_to_available "npm run lint:fix;npm run test"  # Returns only available commands

get_available_npm_scripts() {
  local package_json="$1"
  
  # If the argument is a directory or empty, append /package.json
  if [ -z "$package_json" ] || [ "$package_json" = "." ] || [ ! -f "$package_json" ] && [ -d "$package_json" ]; then
    package_json="${package_json:-.}/package.json"
  fi
  
  if [ ! -f "$package_json" ]; then
    return 1
  fi
  
  node - "$package_json" <<'NODE'
const fs = require('fs');
const packageJsonPath = process.argv[2];
try {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  // Return space-separated list of available script names
  Object.keys(scripts).sort().forEach(script => {
    process.stdout.write(script + ' ');
  });
  process.exit(0);
} catch (err) {
  // Malformed JSON or file errors — fail gracefully
  process.exit(1);
}
NODE
}

# Extract script name from npm command like "npm run lint:fix"
npm_run_script_name() {
  local command="$1"
  local npm_run_regex='^npm[[:space:]]+run[[:space:]]+([^[:space:]-][^[:space:]-]*)($|[[:space:]])'
  if [[ "$command" =~ $npm_run_regex ]]; then 
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

# Check if a script name is available in package.json
script_is_available() {
  local script_name="$1"
  local package_json="$2"
  
  # If the argument is a directory or empty, append /package.json
  if [ -z "$package_json" ] || [ "$package_json" = "." ] || [ ! -f "$package_json" ] && [ -d "$package_json" ]; then
    package_json="${package_json:-.}/package.json"
  fi
  
  if [ ! -f "$package_json" ]; then
    return 1
  fi
  
  node - "$script_name" "$package_json" <<'NODE'
const fs = require('fs');
const [scriptName, packageJsonPath] = process.argv.slice(2);
try {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  process.exit(Object.prototype.hasOwnProperty.call(scripts, scriptName) ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

# Filter a list of cleanup commands (semicolon-separated) to only those that are available.
# Input: semicolon-separated commands (e.g., "npm run lint:fix;__kaseki_trailing_whitespace_cleanup__")
# Output: filtered list of commands with only available npm scripts
# Non-npm commands (e.g., __kaseki_trailing_whitespace_cleanup__) are always included.
filter_npm_commands_to_available() {
  local commands="$1"
  local package_json="$2"
  local -a command_array filtered_commands
  local command script_name trimmed
  
  # If the argument is a directory or empty, append /package.json
  if [ -z "$package_json" ] || [ "$package_json" = "." ] || [ ! -f "$package_json" ] && [ -d "$package_json" ]; then
    package_json="${package_json:-.}/package.json"
  fi
  
  if [ -z "$commands" ]; then
    return 0
  fi
  
  # Split by semicolon
  IFS=';' read -r -a command_array <<< "$commands"
  
  for command in "${command_array[@]}"; do
    trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
    [ -z "$trimmed" ] && continue
    
    # Check if this is an npm run command
    if script_name="$(npm_run_script_name "$trimmed" 2>/dev/null)"; then
      # It's an npm run command — only include if available
      if script_is_available "$script_name" "$package_json" 2>/dev/null; then
        filtered_commands+=("$trimmed")
      fi
    else
      # Not an npm run command (e.g., __kaseki_trailing_whitespace_cleanup__) — always include
      filtered_commands+=("$trimmed")
    fi
  done
  
  # Output filtered commands as semicolon-separated string
  if [ "${#filtered_commands[@]}" -gt 0 ]; then
    (IFS=';' ; printf '%s' "${filtered_commands[*]}")
  fi
}

# Main: called when script is sourced with arguments
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
  # Sourced — export functions
  :
else
  # Called directly — execute requested function
  case "${1:-get_available_npm_scripts}" in
    get_available_npm_scripts)
      get_available_npm_scripts "${2:-.}/package.json"
      ;;
    filter_npm_commands)
      filter_npm_commands_to_available "$2" "${3:-.}/package.json"
      ;;
    is_available)
      script_is_available "$2" "${3:-.}/package.json"
      ;;
    *)
      printf 'Usage: %s [get_available_npm_scripts|filter_npm_commands|is_available] [args]\n' "$0" >&2
      exit 1
      ;;
  esac
fi
