#!/usr/bin/env bash
#
# startup-checks.sh — Validate Docker environment and permissions
#
# This script runs as an early-stage check in docker-entrypoint.sh
# to catch permission and configuration issues before they cause failures.
#
# Exit codes:
#   0 = all checks passed
#   1 = configuration error (missing API key, invalid paths, etc.)
#   2 = permission error (not writable, can't fix automatically)
#   3 = warning (something is suboptimal but execution can continue)

set -euo pipefail

# --- Configuration ---
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_TEMPLATE_DIR="${KASEKI_TEMPLATE_DIR:-$KASEKI_ROOT/kaseki-template}"
KASEKI_RESULTS_DIR="${KASEKI_RESULTS_DIR:-$KASEKI_ROOT/kaseki-results}"
KASEKI_RUNS_DIR="${KASEKI_RUNS_DIR:-$KASEKI_ROOT/kaseki-runs}"
MODE="${1:-all}"  # all, permissions, bootstrap, quick, boot, baseline-validation, or worker

# Current UID inside container (typically UID 10000 for non-root user)
CONTAINER_UID="${CONTAINER_UID:-$(id -u)}"
CONTAINER_GID="${CONTAINER_GID:-$(id -g)}"

# Color codes for output
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

# --- Helper functions ---

log_pass() {
  echo -e "${GREEN}✓${NC} $*" >&2
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $*" >&2
}

log_error() {
  echo -e "${RED}✗${NC} $*" >&2
}

log_info() {
  echo -e "${BLUE}ℹ${NC} $*" >&2
}

# Check if we're running in a container managed by Docker (but not necessarily Docker Compose)
is_in_container() {
  [ -f /.dockerenv ] || [ -f /run/.containerenv ]
}

# Detect container management platform (Dockhand, Portainer, Kubernetes, etc.)
detect_container_platform() {
  if [ -S /var/run/docker.sock ] 2>/dev/null; then
    # We have access to docker socket
    if command -v docker &>/dev/null; then
      # Check if running on Portainer (has specific env vars or config)
      if [ -n "${PORTAINER_VERSION:-}" ] || [ -f /.portainer ]; then
        echo "portainer"
        return 0
      fi
      # Check for Dockhand patterns (typically running in restricted mode)
      if grep -q "dockhand" /proc/self/cgroup 2>/dev/null || [ -n "${DOCKHAND_MODE:-}" ]; then
        echo "dockhand"
        return 0
      fi
    fi
  fi
  # Kubernetes detection
  if [ -d /var/run/secrets/kubernetes.io ]; then
    echo "kubernetes"
    return 0
  fi
  echo "docker"
  return 0
}

# Generate platform-specific remediation instructions
suggest_platform_setup() {
  local platform="${1:-docker}"
  
  case "$platform" in
    portainer)
      echo ""
      echo "📦 Running on Portainer — Setup Instructions:"
      echo ""
      echo "  1. In Portainer UI, navigate to Stacks → kaseki-agent"
      echo "  2. Edit the stack and modify the 'services' section:"
      echo ""
      echo "     Before docker-compose up, run on the HOST:"
      echo "       sudo mkdir -p /agents"
      echo "       sudo chown 10000:10000 /agents"
      echo "       sudo chmod 755 /agents"
      echo ""
      echo "  3. Or, use an init container (already added in latest version)"
      echo "     Wait 10 seconds after deploy for init container to complete"
      echo ""
      echo "  See: docs/DEPLOYMENT.md#container-management-platforms"
      ;;
    dockhand)
      echo ""
      echo "🔧 Running on Dockhand — Setup Instructions:"
      echo ""
      echo "  1. SSH into the Dockhand host"
      echo "  2. Run the following commands:"
      echo "       sudo mkdir -p /agents"
      echo "       sudo chown 10000:10000 /agents"
      echo "       sudo chmod 755 /agents"
      echo ""
      echo "  3. Restart the kaseki-api service in Dockhand UI"
      echo ""
      echo "  See: docs/DEPLOYMENT.md#container-management-platforms"
      ;;
    kubernetes)
      echo ""
      echo "☸️  Running on Kubernetes — Setup Instructions:"
      echo ""
      echo "  1. Ensure /agents PersistentVolume is properly mounted"
      echo "  2. The PV must be writable by UID 10000"
      echo ""
      echo "  Example: kubectl patch pv agents-pv -p '{\"spec\":{\"owner\":\"10000:10000\"}}'"
      echo ""
      echo "  See: docs/DEPLOYMENT.md#kubernetes-deployment"
      ;;
    *)
      echo ""
      echo "💡 Setup Instructions:"
      echo ""
      echo "  Run on the host where /agents is mounted:"
      echo "    sudo mkdir -p /agents"
      echo "    sudo chown 10000:10000 /agents"
      echo "    sudo chmod 755 /agents"
      echo ""
      echo "  Then restart the kaseki-api service."
      ;;
  esac
}

# Check if a directory is writable (even if it doesn't exist yet)
is_writable_or_creatable() {
  local target_dir="$1"
  local parent_dir
  
  # If directory exists, check if it's writable
  if [ -d "$target_dir" ]; then
    if [ -w "$target_dir" ]; then
      return 0
    else
      return 1
    fi
  fi
  
  # If directory doesn't exist, walk up to find a writable parent
  parent_dir="$(dirname "$target_dir")"
  if [ "$parent_dir" = "$target_dir" ]; then
    # We've reached the root
    return 1
  fi
  
  # Check if parent is writable
  if [ -w "$parent_dir" ]; then
    return 0
  fi
  
  # Recursively check parent
  is_writable_or_creatable "$parent_dir"
}

# --- Permission checks ---

check_kaseki_root() {
  log_info "Checking $KASEKI_ROOT..."
  
  if [ ! -d "$KASEKI_ROOT" ]; then
    if is_writable_or_creatable "$KASEKI_ROOT"; then
      if mkdir -p "$KASEKI_ROOT"; then
        log_pass "$KASEKI_ROOT created (UID:GID $CONTAINER_UID:$CONTAINER_GID)"
        return 0
      else
        log_error "Failed to create $KASEKI_ROOT (permission denied)"
        return 2
      fi
    else
      log_error "$KASEKI_ROOT is not accessible and parent is not writable"
      return 2
    fi
  fi
  
  if [ ! -w "$KASEKI_ROOT" ]; then
    log_error "$KASEKI_ROOT exists but is not writable by UID $CONTAINER_UID"
    log_error "Fix: Run on host: sudo chown $CONTAINER_UID:$CONTAINER_GID $KASEKI_ROOT"
    
    # Provide platform-specific instructions if in container
    if is_in_container; then
      local platform
      platform=$(detect_container_platform)
      suggest_platform_setup "$platform"
    fi
    return 2
  fi
  
  log_pass "$KASEKI_ROOT is writable by UID $CONTAINER_UID"
  return 0
}

check_subdirectories() {
  local -a subdirs=("$KASEKI_TEMPLATE_DIR" "$KASEKI_RESULTS_DIR" "$KASEKI_RUNS_DIR")
  local exit_code=0
  
  for subdir in "${subdirs[@]}"; do
    if [ ! -d "$subdir" ]; then
      if ! mkdir -p "$subdir" 2>/dev/null; then
        log_warn "Could not create $subdir (will try later)"
        exit_code=3
      else
        log_pass "$subdir created"
      fi
    elif [ ! -w "$subdir" ]; then
      log_warn "$subdir exists but is not writable"
      exit_code=3
    else
      log_pass "$subdir is ready"
    fi
  done
  
  return "$exit_code"
}

check_worker_mounts() {
  local -a worker_paths=(/workspace /results /cache)
  local exit_code=0
  local path

  log_info "Checking worker container mounts..."

  for path in "${worker_paths[@]}"; do
    if [ ! -d "$path" ]; then
      log_error "$path is not mounted"
      exit_code=2
      continue
    fi

    if [ ! -w "$path" ]; then
      log_error "$path exists but is not writable by UID $CONTAINER_UID"
      exit_code=2
      continue
    fi

    log_pass "$path is writable"
  done

  return "$exit_code"
}

check_bootstrap_status() {
  log_info "Checking bootstrap status..."
  
  local template_dir="$KASEKI_TEMPLATE_DIR"
  local run_script="$template_dir/run-kaseki.sh"
  
  if [ ! -f "$run_script" ]; then
    log_warn "Bootstrap incomplete: run-kaseki.sh missing at $run_script"
    log_info "  (This is normal on first startup; will be auto-initialized by API service)"
    return 3
  fi
  
  if [ ! -x "$run_script" ]; then
    log_warn "run-kaseki.sh exists but is not executable"
    if chmod +x "$run_script" 2>/dev/null; then
      log_pass "Fixed: run-kaseki.sh is now executable"
      return 0
    else
      log_error "Failed to make run-kaseki.sh executable"
      return 2
    fi
  fi
  
  log_pass "run-kaseki.sh is ready ($run_script)"
  return 0
}

# --- Secret Path Permission Checks & Auto-Fix ---

is_path_on_readonly_mount() {
  local target_path="$1"
  
  # Check if the path or any parent is mounted as read-only
  if [ ! -e "$target_path" ]; then
    target_path="$(dirname "$target_path")"
  fi
  
  # Use `touch` test to determine if writable (works better than test operator)
  if ! touch "$target_path/.write-test" 2>/dev/null; then
    # If parent directory, check if it's the mount issue
    return 0  # Assume read-only mount
  fi
  rm -f "$target_path/.write-test"
  return 1  # Not read-only
}

# Check if a file is readable by UID 10000 OR GID 10000 (group-based access)
# This is important for read-only mounts where we can't change permissions
is_file_readable_by_uid_or_gid() {
  local file_path="$1"
  local uid="${2:-$CONTAINER_UID}"
  local gid="${3:-$CONTAINER_GID}"
  
  if [ ! -f "$file_path" ]; then
    return 1
  fi
  
  # Test direct readability
  if [ -r "$file_path" ]; then
    return 0
  fi
  
  # Check if file is readable by our group
  local mode
  mode=$(get_current_permissions "$file_path")
  
  if [ "$mode" = "unknown" ] || [ "$mode" = "nonexistent" ]; then
    return 1
  fi
  
  # Extract group read permission (second digit in octal mode)
  # For mode like 0640: group digit is 4 (read permission)
  local group_digit
  group_digit=$(echo "$mode" | cut -c2)
  
  # Check if group has read permission (4 = read)
  if [ "$group_digit" -ge 4 ] && [ "$group_digit" -le 7 ]; then
    # Group has read permission - verify our GID matches
    local file_gid
    if command -v stat &>/dev/null; then
      file_gid=$(stat -c "%g" "$file_path" 2>/dev/null || echo "unknown")
    else
      file_gid=$(ls -ld "$file_path" 2>/dev/null | awk '{print $4}' || echo "unknown")
    fi
    
    # If file GID matches our GID, we can read it via group membership
    if [ "$file_gid" = "$gid" ]; then
      return 0
    fi
  fi
  
  return 1
}

# Check if a directory is traversable by UID or GID (for group-based access)
is_directory_traversable_by_uid_or_gid() {
  local dir_path="$1"
  local uid="${2:-$CONTAINER_UID}"
  local gid="${3:-$CONTAINER_GID}"
  
  if [ ! -d "$dir_path" ]; then
    return 1
  fi
  
  # Test direct traversability
  if [ -x "$dir_path" ]; then
    return 0
  fi
  
  # Check if directory is traversable by our group
  local mode
  mode=$(get_current_permissions "$dir_path")
  
  if [ "$mode" = "unknown" ] || [ "$mode" = "nonexistent" ]; then
    return 1
  fi
  
  # Extract group execute permission (second digit in octal mode)
  # For mode like 0750: group digit is 5 (read+execute permission)
  local group_digit
  group_digit=$(echo "$mode" | cut -c2)
  
  # Check if group has execute permission (1, 3, 5, 7)
  # The last bit (1) means execute, so odd numbers have execute
  if [ "$((group_digit % 2))" -eq 1 ]; then
    # Group has execute permission - verify our GID matches
    local dir_gid
    if command -v stat &>/dev/null; then
      dir_gid=$(stat -c "%g" "$dir_path" 2>/dev/null || echo "unknown")
    else
      dir_gid=$(ls -ld "$dir_path" 2>/dev/null | awk '{print $4}' || echo "unknown")
    fi
    
    if [ "$dir_gid" = "$gid" ]; then
      return 0
    fi
  fi
  
  return 1
}

get_current_permissions() {
  local path="$1"
  
  if [ ! -e "$path" ]; then
    echo "nonexistent"
    return 0
  fi
  
  # Use stat if available, otherwise fall back to ls
  if command -v stat &>/dev/null; then
    stat -c "%a" "$path" 2>/dev/null || echo "unknown"
  else
    ls -ld "$path" 2>/dev/null | awk '{print $1}' | sed 's/^.//g' || echo "unknown"
  fi
}

can_auto_fix_permissions() {
  local target_path="$1"
  
  # Don't try to fix if path doesn't exist (parent may be inaccessible)
  if [ ! -e "$target_path" ]; then
    return 1
  fi
  
  # Don't try to fix if on read-only mount
  if is_path_on_readonly_mount "$target_path"; then
    return 1
  fi
  
  # Try to chmod it as a test
  local current_perms
  current_perms=$(get_current_permissions "$target_path")
  
  if [ "$current_perms" = "unknown" ] || [ "$current_perms" = "nonexistent" ]; then
    return 1
  fi
  
  return 0
}

auto_fix_directory_permissions() {
  local dir_path="$1"
  local target_mode="0750"
  
  if [ ! -d "$dir_path" ]; then
    return 1
  fi
  
  # Skip if on read-only mount
  if is_path_on_readonly_mount "$dir_path"; then
    return 1
  fi
  
  local current_mode
  current_mode=$(get_current_permissions "$dir_path")
  
  if [ "$current_mode" != "$target_mode" ] && [ "$current_mode" != "755" ] && [ "$current_mode" != "750" ]; then
    if chmod "$target_mode" "$dir_path" 2>/dev/null; then
      log_pass "Fixed permissions: $dir_path ($current_mode → $target_mode)"
      return 0
    else
      return 1
    fi
  fi
  
  return 0
}

auto_fix_file_permissions() {
  local file_path="$1"
  local target_mode="0640"
  
  if [ ! -f "$file_path" ]; then
    return 1
  fi
  
  # Skip if on read-only mount
  if is_path_on_readonly_mount "$file_path"; then
    return 1
  fi
  
  local current_mode
  current_mode=$(get_current_permissions "$file_path")
  
  if [ "$current_mode" != "$target_mode" ] && [ "$current_mode" != "644" ] && [ "$current_mode" != "640" ] && [ "$current_mode" != "600" ]; then
    if chmod "$target_mode" "$file_path" 2>/dev/null; then
      log_pass "Fixed permissions: $file_path ($current_mode → $target_mode)"
      return 0
    else
      return 1
    fi
  fi
  
  return 0
}

check_directory_traversable() {
  local dir_path="$1"
  local dir_name="$2"
  
  if [ ! -d "$dir_path" ]; then
    return 0  # Directory doesn't exist, not a traversal issue
  fi
  
  # Test if directory is traversable by the current user
  if [ ! -x "$dir_path" ]; then
    log_error "$dir_name is not traversable by UID $CONTAINER_UID"
    
    if can_auto_fix_permissions "$dir_path"; then
      if auto_fix_directory_permissions "$dir_path"; then
        log_pass "$dir_name is now traversable"
        return 0
      else
        log_error "Failed to fix $dir_name permissions"
        return 2
      fi
    else
      # Check if this is a read-only mount
      if is_path_on_readonly_mount "$dir_path"; then
        # Check if directory is traversable by group
        if is_directory_traversable_by_uid_or_gid "$dir_path"; then
          log_warn "$dir_name is on a read-only mount but is traversable by GID $CONTAINER_GID"
          log_warn "Note: Some operations may fail if they require write access"
          return 3  # Warning: accessible but on read-only mount
        fi
        
        # Not traversable even by group
        log_error "$dir_name is on a read-only mount and not traversable"
        log_error ""
        log_error "To fix on HOST (before docker-compose up or container start):"
        log_error "  sudo chmod 0750 $dir_path"
        log_error ""
        return 2
      else
        # Writable mount but still can't fix permissions
        log_error "Cannot auto-fix $dir_name permissions"
        log_error "  sudo chmod 0750 $dir_path"
        return 2
      fi
    fi
  fi
  
  return 0
}

check_file_readable() {
  local file_path="$1"
  local file_name="$2"
  
  if [ ! -f "$file_path" ]; then
    return 0  # File doesn't exist, not a readability issue
  fi
  
  # Test if file is readable by the current user
  if [ ! -r "$file_path" ]; then
    log_error "$file_name is not readable by UID $CONTAINER_UID"
    
    if can_auto_fix_permissions "$file_path"; then
      if auto_fix_file_permissions "$file_path"; then
        log_pass "$file_name is now readable"
        return 0
      else
        log_error "Failed to fix $file_name permissions"
        return 2
      fi
    else
      # Check if this is a read-only mount
      if is_path_on_readonly_mount "$file_path"; then
        # Check if file is readable by group
        if is_file_readable_by_uid_or_gid "$file_path"; then
          log_warn "$file_name is on a read-only mount but is readable by GID $CONTAINER_GID"
          log_warn "Note: Using group-based access from UID $CONTAINER_UID"
          return 3  # Warning: accessible but on read-only mount
        fi
        
        # Not readable even by group - must fix on host
        log_error "$file_name is on a read-only mount and not readable"
        log_error ""
        log_error "To fix on HOST (before docker-compose up or container start):"
        local dir_path
        dir_path=$(dirname "$file_path")
        # Get current mode for helpful feedback
        local current_mode
        current_mode=$(get_current_permissions "$file_path")
        log_error "  Current mode: $current_mode"
        log_error "  Fix: sudo chmod 0640 $file_path"
        log_error "  Or:  sudo chmod 0644 $file_path (world-readable)"
        log_error ""
        log_error "Make sure parent directory is traversable:"
        log_error "  sudo chmod 0750 $dir_path"
        log_error ""
        return 2
      else
        # Writable mount but still can't fix permissions
        log_error "Cannot auto-fix $file_name permissions"
        local dir_path
        dir_path=$(dirname "$file_path")
        log_error "  sudo chmod 0640 $file_path"
        return 2
      fi
    fi
  fi
  
  return 0
}

check_secret_paths() {
  log_info "Checking secret path permissions..."
  
  local exit_code=0
  local secrets_dir="${KASEKI_SECRETS_DIR:-/agents/secrets}"
  local home_secrets="${HOME:-/root}/secrets"
  local kaseki_secrets="${HOME:-/root}/.kaseki/secrets.json"
  
  # Check /agents/secrets directory (primary mount point)
  if [ -d "$secrets_dir" ]; then
    check_directory_traversable "$secrets_dir" "/agents/secrets" || exit_code=$?
    
    # Check any secret files in the directory
    if [ -d "$secrets_dir" ] && [ -x "$secrets_dir" ]; then
      # openrouter_api_key is the primary one
      if [ -f "$secrets_dir/openrouter_api_key" ]; then
        check_file_readable "$secrets_dir/openrouter_api_key" "openrouter_api_key" || exit_code=$?
      fi
    fi
  fi
  
  # Check $HOME/secrets fallback
  if [ -d "$home_secrets" ]; then
    check_directory_traversable "$home_secrets" "\$HOME/secrets" || exit_code=$?
    
    if [ -d "$home_secrets" ] && [ -x "$home_secrets" ]; then
      if [ -f "$home_secrets/openrouter_api_key" ]; then
        check_file_readable "$home_secrets/openrouter_api_key" "\$HOME/secrets/openrouter_api_key" || exit_code=$?
      fi
    fi
  fi
  
  # Check ~/.kaseki/secrets.json
  if [ -f "$kaseki_secrets" ]; then
    check_file_readable "$kaseki_secrets" "~/.kaseki/secrets.json" || exit_code=$?
  fi
  
  return "$exit_code"
}

# --- API Key validation ---

check_api_key() {
  # Check for OpenRouter API key (required for agent execution)
  local api_key_file="${OPENROUTER_API_KEY_FILE:-}"
  local api_key_env="${OPENROUTER_API_KEY:-}"
  
  log_info "Checking API key..."
  
  if [ -n "$api_key_env" ]; then
    log_pass "OPENROUTER_API_KEY is set (env var)"
    return 0
  fi
  
  if [ -n "$api_key_file" ] && [ -f "$api_key_file" ]; then
    if [ -r "$api_key_file" ]; then
      log_pass "OPENROUTER_API_KEY_FILE is readable ($api_key_file)"
      # Warn if using legacy Docker secrets path
      if [[ "$api_key_file" == "/run/secrets/"* ]]; then
        log_warn "Using legacy Docker secrets path: $api_key_file"
        log_info "  Migrate to ~/.kaseki/secrets.json for better portability"
        log_info "  See docs/TROUBLESHOOTING.md#migrating-from-legacy-docker-secrets"
      fi
      return 0
    else
      log_error "OPENROUTER_API_KEY_FILE exists but is not readable ($api_key_file)"
      return 2
    fi
  fi
  
  if [ -f ~/.kaseki/secrets.json ] && [ -r ~/.kaseki/secrets.json ]; then
    log_pass "API key found in ~/.kaseki/secrets.json"
    return 0
  fi
  
  log_warn "No API key configured yet"
  log_info "  Run: kaseki-agent init"
  return 3  # Warning, not error
}

# --- Network checks ---

check_port_availability() {
  local port="${1:-8080}"
  
  log_info "Checking if port $port is available..."
  
  if command -v ss &>/dev/null; then
    if ss -tuln 2>/dev/null | grep -q ":$port "; then
      log_warn "Port $port is already in use"
      return 3
    else
      log_pass "Port $port is available"
      return 0
    fi
  fi
  
  # Fallback if ss is not available
  return 0
}

# --- Main execution ---

main() {
  local overall_exit=0
  
  echo ""
  log_info "Starting kaseki-agent startup checks (mode: $MODE)"
  echo ""
  
  case "$MODE" in
    all)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_bootstrap_status || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_secret_paths || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_api_key || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;
    
    permissions)
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$?
      ;;
    
    bootstrap)
      check_bootstrap_status || overall_exit=$?
      ;;
    
    quick|boot)
      # Minimal checks (just essentials)
      check_kaseki_root || overall_exit=$?
      ;;

    worker)
      # Ephemeral worker containers do not mount /agents. They receive scoped
      # workspace, results, and cache mounts from run-kaseki.sh.
      check_worker_mounts || overall_exit=$?
      check_secret_paths || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_api_key || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;

    baseline-validation)
      # Startup smoke test mode used by API dry-runs before repository validation.
      check_kaseki_root || overall_exit=$?
      check_subdirectories || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_bootstrap_status || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      check_secret_paths || overall_exit=$((overall_exit > $? ? overall_exit : $?))
      ;;
    
    *)
      log_error "Unknown mode: $MODE"
      echo "Usage: $0 [all|permissions|bootstrap|quick|boot|baseline-validation|worker]"
      return 1
      ;;
  esac
  
  echo ""
  if [ "$overall_exit" -eq 0 ]; then
    log_pass "All checks passed"
  elif [ "$overall_exit" -eq 2 ]; then
    log_error "Configuration error detected; startup blocked"
  else
    log_warn "Some warnings detected; continuing anyway"
  fi
  echo ""
  
  return "$overall_exit"
}

main "$@"
