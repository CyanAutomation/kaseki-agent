#!/usr/bin/env bash
set -euo pipefail

mode="${1:-run}"
output_format="text"  # text or json
guide_mode=0          # 0 or 1

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      output_format="json"
      shift
      ;;
    --guide)
      guide_mode=1
      shift
      ;;
    run|doctor)
      mode="$1"
      shift
      ;;
    *)
      printf 'Error: unknown flag or mode: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

required_bins=(docker)
optional_bins=()
case "$mode" in
  run)
    optional_bins=(curl wget sshpass git node npm)
    ;;
  doctor)
    optional_bins=(curl wget sshpass git node npm)
    ;;
  *)
    printf 'Error: unknown preflight mode: %s\n' "$mode" >&2
    exit 2
    ;;
esac

missing_required=()
missing_optional=()

for bin in "${required_bins[@]}"; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    missing_required+=("$bin")
  fi
done

for bin in "${optional_bins[@]}"; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    missing_optional+=("$bin")
  fi
done

# Detect OS for install suggestions
detect_os() {
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if [ -f /etc/os-release ]; then
      . /etc/os-release
      case "$ID" in
        debian|ubuntu|raspbian)
          echo "debian"
          ;;
        fedora|centos|rhel)
          echo "fedora"
          ;;
        arch|manjaro)
          echo "arch"
          ;;
        *)
          echo "linux"
          ;;
      esac
    else
      echo "linux"
    fi
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "macos"
  else
    echo "unknown"
  fi
}

# Get install command for detected OS
get_install_command() {
  local bin="$1"
  local detected_os
  detected_os="$(detect_os)"
  
  case "$detected_os" in
    debian)
      case "$bin" in
        docker) echo "sudo apt update && sudo apt install -y docker.io" ;;
        git) echo "sudo apt install -y git" ;;
        curl) echo "sudo apt install -y curl" ;;
        wget) echo "sudo apt install -y wget" ;;
        node|npm) echo "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs" ;;
        sshpass) echo "sudo apt install -y sshpass" ;;
        *) echo "sudo apt install -y $bin" ;;
      esac
      ;;
    fedora)
      case "$bin" in
        docker) echo "sudo dnf install -y docker" ;;
        git) echo "sudo dnf install -y git" ;;
        curl) echo "sudo dnf install -y curl" ;;
        wget) echo "sudo dnf install -y wget" ;;
        node|npm) echo "curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash - && sudo dnf install -y nodejs" ;;
        sshpass) echo "sudo dnf install -y sshpass" ;;
        *) echo "sudo dnf install -y $bin" ;;
      esac
      ;;
    arch)
      case "$bin" in
        docker) echo "sudo pacman -S --needed docker" ;;
        git) echo "sudo pacman -S --needed git" ;;
        curl) echo "sudo pacman -S --needed curl" ;;
        wget) echo "sudo pacman -S --needed wget" ;;
        node|npm) echo "sudo pacman -S --needed nodejs npm" ;;
        sshpass) echo "sudo pacman -S --needed sshpass" ;;
        *) echo "sudo pacman -S --needed $bin" ;;
      esac
      ;;
    macos)
      case "$bin" in
        docker) echo "brew install --cask docker" ;;
        git) echo "brew install git" ;;
        curl) echo "brew install curl" ;;
        wget) echo "brew install wget" ;;
        node|npm) echo "brew install node" ;;
        sshpass) echo "brew install sshpass" ;;
        *) echo "brew install $bin" ;;
      esac
      ;;
    *)
      echo "Please install $bin manually"
      ;;
  esac
}

# Output helpers
output_text_mode() {
  if [ "${#missing_required[@]}" -gt 0 ]; then
    printf 'Error: missing required host dependencies: %s\n' "$(IFS=', '; echo "${missing_required[*]}")" >&2
    printf 'Install them, then re-run ./run-kaseki.sh.\n' >&2
    return 1
  fi
  
  printf 'Preflight required dependencies: ok (%s)\n' "$(IFS=', '; echo "${required_bins[*]}")"
  if [ "${#missing_optional[@]}" -eq 0 ]; then
    printf 'Preflight optional dependencies: ok (%s)\n' "$(IFS=', '; echo "${optional_bins[*]}")"
  else
    printf 'Preflight optional dependencies: missing (%s)\n' "$(IFS=', '; echo "${missing_optional[*]}")"
  fi
  
  return 0
}

output_json_mode() {
  local status="ready"
  [ "${#missing_required[@]}" -gt 0 ] && status="failed"
  
  # Build JSON output
  cat <<EOF
{
  "status": "$status",
  "required_ok": $([[ ${#missing_required[@]} -eq 0 ]] && echo "true" || echo "false"),
  "optional_ok": $([[ ${#missing_optional[@]} -eq 0 ]] && echo "true" || echo "false"),
  "required_bins": $(printf '%s\n' "${required_bins[@]}" | jq -sR -c 'split("\n")[:-1]'),
  "optional_bins": $(printf '%s\n' "${optional_bins[@]}" | jq -sR -c 'split("\n")[:-1]'),
  "missing_required": $(printf '%s\n' "${missing_required[@]}" | jq -sR -c 'split("\n")[:-1]'),
  "missing_optional": $(printf '%s\n' "${missing_optional[@]}" | jq -sR -c 'split("\n")[:-1]'),
  "detected_os": "$(detect_os)"
}
EOF
  
  [ "${#missing_required[@]}" -gt 0 ] && return 1 || return 0
}

output_guide_mode() {
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║          Kaseki Agent Preflight Guide                       ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  
  local detected_os
  detected_os="$(detect_os)"
  echo "System Information:"
  echo "  OS: $detected_os"
  echo "  Shell: $SHELL"
  echo ""
  
  # Check required dependencies
  echo "Required Dependencies:"
  for bin in "${required_bins[@]}"; do
    if command -v "$bin" >/dev/null 2>&1; then
      echo "  ✓ $bin"
    else
      echo "  ✗ $bin (MISSING)"
      local install_cmd
      install_cmd=$(get_install_command "$bin")
      echo "    Install: $install_cmd"
    fi
  done
  echo ""
  
  # Check optional dependencies
  echo "Optional Dependencies:"
  for bin in "${optional_bins[@]}"; do
    if command -v "$bin" >/dev/null 2>&1; then
      echo "  ✓ $bin"
    else
      echo "  ○ $bin (optional, not found)"
      local install_cmd
      install_cmd=$(get_install_command "$bin")
      echo "    Install: $install_cmd"
    fi
  done
  echo ""
  
  # Summary and next steps
  if [ "${#missing_required[@]}" -gt 0 ]; then
    echo "⚠ Action Required:"
    echo "  Install missing required dependencies:"
    for bin in "${missing_required[@]}"; do
      local install_cmd
      install_cmd=$(get_install_command "$bin")
      echo "    $install_cmd"
    done
    echo ""
    echo "  After installing, run: ./run-kaseki.sh --doctor"
    return 1
  else
    echo "✓ All required dependencies are installed!"
    if [ "${#missing_optional[@]}" -gt 0 ]; then
      echo ""
      echo "⚠ Note: Some optional dependencies are missing:"
      for bin in "${missing_optional[@]}"; do
        echo "    - $bin"
      done
      echo "  These are optional but recommended for full functionality."
    fi
    return 0
  fi
}

# Route to appropriate output mode
case "$output_format" in
  json)
    output_json_mode
    ;;
  text)
    if [ "$guide_mode" -eq 1 ]; then
      output_guide_mode
    else
      output_text_mode
    fi
    ;;
  *)
    printf 'Error: unknown output format: %s\n' "$output_format" >&2
    exit 2
    ;;
esac

