# Kaseki Host Setup: API Reference

**Version**: 2.0 (Phase 4-5)  
**Updated**: 2026-06-04  
**Audience**: Tool developers, API consumers, external integrations

This document provides complete JSON schemas, function signatures, and API reference for consuming Kaseki host setup output programmatically.

---

## Quick Start for Tool Integration

### 1. Consume JSON Output

```bash
# Run setup and capture JSON
kaseki-agent host setup --check-only

# Parse results
cat ~/.kaseki/setup-results.json | jq '.checks.checkout_freshness_probe'
# Output: "ok"

# Check exit code
kaseki-agent host setup --check-only
echo $?  # 0=success, 1=error, 2=permission, 3=warning
```

### 2. Use in Scripts

```bash
#!/bin/bash
if kaseki-agent host setup --check-only; then
  echo "Host is ready for Kaseki"
  # Proceed with API deployment
else
  echo "Host needs setup: sudo kaseki-agent host setup --fix"
  exit 1
fi
```

### 3. Parse JSON in External Tools

```javascript
// JavaScript example
const fs = require('fs');
const setupResults = JSON.parse(
  fs.readFileSync(process.env.HOME + '/.kaseki/setup-results.json')
);

if (setupResults.checks.checkout_freshness_probe === 'ok') {
  console.log('Checkout is accessible');
}
```

---

## JSON Schemas

### setup-results.json (v2 - Current)

**Location**: `~/.kaseki/setup-results.json`  
**Version**: 2  
**Updated after**: Each `kaseki-agent host setup` run  
**Format**: JSON (UTF-8)

**Full Schema**:

```json
{
  "timestamp": "2026-06-04T21:09:13Z",
  "mode": "check-only|setup",
  "status": "ok|failed",
  "message": "Setup complete",
  "exit_code": 0,
  "version": "2",
  "checks": {
    "checkout_freshness_probe": "ok|failed|skipped|unknown",
    "template_ready": "ok|missing|not-executable|unknown"
  },
  "performance": {
    "stage_1_ms": 45,
    "probe_duration_ms": 2150
  }
}
```

**Field Descriptions**:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | ISO 8601 | UTC timestamp of setup completion |
| `mode` | string | "check-only" (no changes) or "setup" (with --fix) |
| `status` | string | "ok" (all passed) or "failed" (some checks failed) |
| `message` | string | Human-readable status message |
| `exit_code` | integer | Process exit code (0=success, 1=fatal, 2=permission, 3=warning) |
| `version` | integer | Schema version (for evolution tracking) |
| `checks` | object | Per-check status values |
| `checks.checkout_freshness_probe` | string | Probe status: ok/failed/skipped/unknown |
| `checks.template_ready` | string | Template status: ok/missing/not-executable/unknown |
| `performance` | object | Timing metrics (Phase 4) |
| `performance.stage_1_ms` | integer | Stage 1 duration in milliseconds |
| `performance.probe_duration_ms` | integer | Stage 6 probe duration in milliseconds |

**Example (Success)**:

```json
{
  "timestamp": "2026-06-04T21:09:13Z",
  "mode": "check-only",
  "status": "ok",
  "message": "Setup complete",
  "exit_code": 0,
  "version": "2",
  "checks": {
    "checkout_freshness_probe": "ok",
    "template_ready": "ok"
  },
  "performance": {
    "stage_1_ms": 45,
    "probe_duration_ms": 2150
  }
}
```

**Example (Partial Failure)**:

```json
{
  "timestamp": "2026-06-04T21:10:45Z",
  "mode": "check-only",
  "status": "failed",
  "message": "Setup complete",
  "exit_code": 1,
  "version": "2",
  "checks": {
    "checkout_freshness_probe": "failed",
    "template_ready": "missing"
  },
  "performance": {
    "stage_1_ms": 50,
    "probe_duration_ms": 2100
  }
}
```

### setup-results.json (v1 - Legacy)

**Format**: JSON (UTF-8)  
**Version**: 1  
**Deprecated**: Use v2 instead

**Schema**:

```json
{
  "timestamp": "2026-06-04T21:09:13Z",
  "mode": "check-only|setup",
  "status": "ok|failed",
  "message": "Setup complete",
  "exit_code": 0,
  "version": "1"
}
```

### host-state.json (v2)

**Location**: `~/.kaseki/host-state.json`  
**Purpose**: Internal state tracking; primarily for diagnostics  
**Updated after**: Stages 2, 6, 7  
**Format**: JSON (UTF-8)

**Schema**:

```json
{
  "normalized_secrets_dir": "/root/secrets",
  "timestamp": "2026-06-04T21:09:13Z",
  "version": "2",
  "checkout_freshness_probe": {
    "status": "ok|failed|skipped",
    "detail": "Checkout freshness probe passed...",
    "remediation": "Fix ownership/permissions...",
    "checkout_dir": "/agents/kaseki-agent",
    "uid": "10000",
    "gid": "10000"
  }
}
```

**Example**:

```json
{
  "normalized_secrets_dir": "/home/user/secrets",
  "timestamp": "2026-06-04T21:09:13Z",
  "version": "2",
  "checkout_freshness_probe": {
    "status": "ok",
    "detail": "Checkout freshness probe passed for /agents/kaseki-agent as UID:GID 10000:10000.",
    "remediation": "",
    "checkout_dir": "/agents/kaseki-agent",
    "uid": "10000",
    "gid": "10000"
  }
}
```

---

## Exit Codes

**Exit Code Reference**:

| Code | Name | Meaning | Typical Cause |
|------|------|---------|---------------|
| 0 | Success | All checks passed | Normal operation |
| 1 | Fatal Error | Setup failed, blocking error | Check failed, permission error, fatal condition |
| 2 | Permission Error | Access denied, insufficient privileges | Not running as root, insufficient sudo permissions |
| 3 | Warning | Non-blocking issue detected | Missing optional secret, non-critical configuration |
| 4+ | Stage-Specific | Specific stage or phase failed | Varies by stage |

**Usage in Scripts**:

```bash
#!/bin/bash
kaseki-agent host setup --fix
exit_code=$?

case $exit_code in
  0)
    echo "Setup successful"
    ;;
  2)
    echo "Need sudo: sudo kaseki-agent host setup --fix"
    exit 1
    ;;
  *)
    echo "Setup failed with code $exit_code"
    cat ~/.kaseki/setup-results.json | jq .
    exit 1
    ;;
esac
```

---

## Function Signatures

### validation-stages.sh Functions

All functions exported from `scripts/validation-stages.sh` for reuse by other scripts.

#### validate_host_prerequisites()

**Purpose**: Pre-flight validation of host environment

**Signature**:

```bash
validate_host_prerequisites() -> exit_code
```

**Return Values**:

- `0` — All prerequisites met
- `1` — Fatal error (blocking)
- `2` — Permission error
- `3` — Warning (non-blocking)

**Example Usage**:

```bash
source scripts/validation-stages.sh
validate_host_prerequisites
echo $?  # Check result
```

**Checks Performed**:

- KASEKI_ROOT path traversability
- Git installation and functionality
- Secrets path traversability
- System utilities availability

---

#### validate_host_fixes_applied()

**Purpose**: Post-fix verification of applied changes

**Signature**:

```bash
validate_host_fixes_applied() -> exit_code
```

**Return Values**:

- `0` — All fixes verified
- `1` — Verification failed
- `2` — Permission error during verification

**Example Usage**:

```bash
source scripts/validation-stages.sh
if validate_host_fixes_applied; then
  echo "Fixes were successfully applied"
else
  echo "Fixes may not have been applied correctly"
fi
```

**Checks Performed**:

- Directory ownership matches expected
- Directory permissions match expected
- Git configuration is in place
- Secrets are accessible

---

#### validate_container_entry([mode])

**Purpose**: Validate container can start and access host resources

**Signature**:

```bash
validate_container_entry([mode]) -> exit_code
```

**Parameters**:

- `mode` (optional): all|permissions|bootstrap|quick|worker
  - `all` — Full validation (default)
  - `permissions` — Only check file permissions
  - `bootstrap` — Only check if bootstrap is possible
  - `quick` — Fast checks only (< 1 second)
  - `worker` — Check if worker container can start

**Return Values**:

- `0` — Container can start
- `1` — Container startup will fail
- `2` — Permission issues
- `3` — Warnings

**Example Usage**:

```bash
source scripts/validation-stages.sh

# Quick check for fast startup
validate_container_entry quick

# Detailed validation before worker startup
validate_container_entry worker

# Check only permissions
validate_container_entry permissions
```

---

#### validate_operation_ready()

**Purpose**: Verify all prerequisites are met for Kaseki operation

**Signature**:

```bash
validate_operation_ready() -> exit_code
```

**Return Values**:

- `0` — Ready for operation
- `1` — Not ready (blocking issue)
- `2` — Permission issue
- `3` — Warning (can proceed)

**Example Usage**:

```bash
source scripts/validation-stages.sh
if validate_operation_ready; then
  echo "Kaseki is ready to operate"
  docker-compose up -d kaseki-api
else
  echo "Run: sudo kaseki-agent host setup --fix"
fi
```

**Checks Performed**:

- API key is available
- GitHub App secrets are present
- Host directories are accessible
- Container can run

---

#### run_privilege_tools_parallel(checkout_dir, command[], stderr_file, user_name, group_name)

**Purpose**: Test privilege tools in parallel, return on first success (Phase 4)

**Signature**:

```bash
run_privilege_tools_parallel(
  checkout_dir: string,
  command: array,
  stderr_file: string,
  user_name: string,
  group_name: string
) -> exit_code
```

**Parameters**:

- `checkout_dir` — Checkout directory path (for context)
- `command` — Command array to execute (e.g., `(git -C ... rev-parse HEAD)`)
- `stderr_file` — Temporary file for stderr capture
- `user_name` — Resolved user name for command execution
- `group_name` — Resolved group name for command execution

**Return Values**:

- `0` — At least one tool succeeded
- `1` — All tools failed

**Example Usage**:

```bash
source scripts/validation-stages.sh

stderr_file=$(mktemp)
if run_privilege_tools_parallel "/agents/kaseki-agent" "(git -C /agents/kaseki-agent rev-parse HEAD)" "$stderr_file" "cassette" "cassette"; then
  echo "Checkout is accessible"
else
  echo "Checkout access failed: $(cat $stderr_file)"
fi
rm -f "$stderr_file"
```

**Behavior**:

- Runs `setpriv`, `runuser`, and `sudo` in parallel
- Returns immediately on first success
- Kills remaining processes
- Respects `KASEKI_PRIV_TOOL_TIMEOUT` environment variable

---

#### Logging Functions

**Purpose**: Structured logging with consistent formatting

**Signatures**:

```bash
log_pass(message: string) -> void        # Success (✓)
log_warn(message: string) -> void        # Warning (⚠)
log_error(message: string) -> void       # Error (✗)
log_info(message: string) -> void        # Info (ℹ)

# Stderr variants
log_pass_stderr(message: string) -> void
log_warn_stderr(message: string) -> void
log_error_stderr(message: string) -> void
```

**Example Usage**:

```bash
source scripts/validation-stages.sh

log_pass "Checkout is ready"
log_warn "Optional secret missing"
log_error "Permission denied" >&2
log_info "Starting validation"
```

**Output Examples**:

```
✓ Checkout is ready
⚠ Optional secret missing
✗ Permission denied
ℹ Starting validation
```

---

#### check_path_components_traversable(path: string)

**Purpose**: Verify all directories in path are traversable (readable)

**Signature**:

```bash
check_path_components_traversable(path: string) -> exit_code
```

**Parameters**:

- `path` — Full path to check (e.g., `/home/user/deep/nested/path`)

**Return Values**:

- `0` — All path components are traversable
- `1` — One or more components are not traversable

**Example Usage**:

```bash
source scripts/validation-stages.sh

if check_path_components_traversable "/agents/kaseki-agent/.git"; then
  echo "All path components are readable"
else
  echo "Some directories in path are not accessible"
fi
```

---

## kaseki-setup-host.sh Functions

Additional functions available in the main setup script.

#### run_checkout_freshness_probe(checkout_dir: string)

**Purpose**: Test if container can access checkout with required permissions (Phase 4 parallel)

**Signature**:

```bash
run_checkout_freshness_probe(checkout_dir: string) -> "status|detail|remediation"
```

**Return Format**: Pipe-delimited string (parse with `IFS="|" read`)

```
ok|Checkout freshness probe passed for /agents/kaseki-agent as UID:GID 10000:10000.|
failed|Checkout freshness probe failed: ....|Configure a valid host method...
```

**Example Usage**:

```bash
probe_output=$(run_checkout_freshness_probe "/agents/kaseki-agent")
IFS="|" read -r status detail remediation <<< "$probe_output"
echo "Status: $status"
echo "Detail: $detail"
echo "Remediation: $remediation"
```

**Phase 4 Feature - Parallel Privilege Tools**:

- Tests setpriv, runuser, sudo in parallel
- Returns on first success
- Reduces probe time from ~6s (sequential) to ~2s (parallel)

---

#### track_stage_start(stage_name: string)

#### track_stage_end(stage_name: string)

**Purpose**: Performance tracking for stages (Phase 4)

**Signatures**:

```bash
track_stage_start(stage_name: string) -> void
track_stage_end(stage_name: string) -> void
```

**Parameters**:

- `stage_name` — Stage identifier (e.g., "STAGE_1", "STAGE_6")

**Behavior**:

- `track_stage_start` — Records start time in environment variable `${stage_name}_start`
- `track_stage_end` — Calculates elapsed time and stores in `${stage_name}_duration` (milliseconds)

**Example Usage**:

```bash
track_stage_start "STAGE_1"
validate_host_prerequisites
track_stage_end "STAGE_1"

# Access duration
echo "Stage 1 took ${STAGE_1_duration}ms"
```

---

#### write_setup_results_enhanced(home_dir, exit_code, message, probe_status, template_status)

**Purpose**: Write structured JSON output with Phase 4 timing metrics

**Signature**:

```bash
write_setup_results_enhanced(
  home_dir: string,
  exit_code: integer,
  message: string,
  probe_status: string,       # "ok|failed|skipped|unknown"
  template_status: string     # "ok|missing|not-executable|unknown"
) -> void
```

**Output**: Writes `~/.kaseki/setup-results.json` (v2)

**Example Usage**:

```bash
write_setup_results_enhanced "$HOME" 0 "Setup complete" "ok" "ok"

# Verify output
cat ~/.kaseki/setup-results.json | jq .
```

---

## Integration Examples

### Example 1: Monitor Setup from External CI/CD

**Requirement**: Run kaseki host setup and report results to GitHub Actions

```yaml
- name: Validate Kaseki Host Setup
  run: |
    kaseki-agent host setup --check-only
    
    # Parse results
    SETUP_STATUS=$(cat ~/.kaseki/setup-results.json | jq -r '.status')
    EXIT_CODE=$(cat ~/.kaseki/setup-results.json | jq -r '.exit_code')
    
    if [ "$SETUP_STATUS" != "ok" ]; then
      echo "::error::Host setup failed: $EXIT_CODE"
      cat ~/.kaseki/setup-results.json | jq .
      exit 1
    fi
```

### Example 2: Dashboard Integration

**Requirement**: Consume JSON output in monitoring dashboard

```javascript
// fetch setup status for dashboard
async function getSetupStatus() {
  try {
    const response = await fetch('/.kaseki/setup-results.json');
    const data = await response.json();
    
    return {
      healthy: data.status === 'ok',
      probeStatus: data.checks.checkout_freshness_probe,
      templateStatus: data.checks.template_ready,
      probeDuration: data.performance?.probe_duration_ms,
      lastUpdated: new Date(data.timestamp)
    };
  } catch (e) {
    return { healthy: false, error: e.message };
  }
}
```

### Example 3: Automated Fix in CI/CD

**Requirement**: Automatically fix setup issues during CI/CD

```bash
#!/bin/bash
set -e

echo "Checking Kaseki host setup..."
if ! kaseki-agent host setup --check-only; then
  echo "Setup needs fixes, attempting auto-fix..."
  sudo kaseki-agent host setup --fix
  
  # Verify fix succeeded
  if kaseki-agent host setup --check-only; then
    echo "✓ Auto-fix successful"
  else
    echo "✗ Auto-fix failed, manual intervention required"
    exit 1
  fi
fi

echo "✓ Host is ready for Kaseki"
```

---

## Version Compatibility

### JSON Schema Evolution

| Version | Date | Changes | Upgrade Path |
|---------|------|---------|--------------|
| 1 | Earlier | Basic schema | Migrate to v2 (add checks object) |
| 2 | 2026-05 | Added checks object + performance metrics | Current version |

**Forward Compatibility**:

- New fields in performance object are optional
- Code should handle missing `performance` gracefully

**Example - Handle Missing Performance**:

```bash
jq '.performance.probe_duration_ms // "unavailable"' ~/.kaseki/setup-results.json
```

---

## Debugging & Diagnostics

### Enable Verbose Logging

```bash
# Show all commands
bash -x scripts/kaseki-setup-host.sh --fix 2>&1 | tee debug.log

# Show environment variables
env | grep KASEKI
```

### Inspect Internal State

```bash
# View host state (internal diagnostics)
cat ~/.kaseki/host-state.json | jq .

# View full results with all fields
cat ~/.kaseki/setup-results.json | jq .
```

### Test Individual Functions

```bash
# Source and test a specific function
source scripts/validation-stages.sh
validate_host_prerequisites
echo "Validation result: $?"
```

---

## Rate Limiting & Throttling

**Note**: No rate limiting or throttling is implemented. Kaseki setup can be run multiple times without delay.

```bash
# Safe to run frequently (no side effects in check-only mode)
for i in {1..10}; do
  kaseki-agent host setup --check-only
done
```

---

## See Also

- [HOST_SETUP_STAGES.md](HOST_SETUP_STAGES.md) — Detailed stage information
- [HOST_SETUP_TROUBLESHOOTING.md](HOST_SETUP_TROUBLESHOOTING.md) — Failure diagnosis
- [QUICK_START.md](QUICK_START.md) — User-facing quick start guide
