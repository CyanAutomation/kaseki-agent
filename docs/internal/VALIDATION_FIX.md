# Validation Fix Implementation Summary

## Issue

Kaseki-agent validation commands failed with getcwd() error on matmetrics repo:

```
shell-init: error retrieving current directory: getcwd: cannot access parent directories: No such file or directory
Error: ENOENT: process.cwd failed
```

All three validation commands (npm run check, test, build) failed with exit code 7.

## Root Cause

The validation phase executed npm commands using `bash -lc` (login shell), which:

1. Sources `/etc/profile` and `~/.bashrc` during startup
2. Attempts to retrieve current working directory via `getcwd()` syscall
3. In `--read-only` containers with restricted filesystem access, this fails
4. Results in ENOENT error before any user command runs

## Solution

Three complementary fixes applied to [kaseki-agent.sh](kaseki-agent.sh):

### Fix 1: Use Non-Login Shell (Line 1579)

**Before:**

```bash
bash -lc "$trimmed"
```

**After:**

```bash
# Use non-login shell (bash -c) to avoid initialization issues in --read-only containers
# Login shell (bash -l) sources /etc/profile and ~/.bashrc, which can fail with getcwd()
# errors when running in constrained filesystem environments (read-only root, etc.)
bash -c "$trimmed"
```

**Impact**: Skips shell initialization entirely; npm commands still work normally

### Fix 2: Pre-Validation Directory Checkpoint (Lines 1549-1561)

**Added:**

```bash
# Checkpoint: Verify working directory exists before validation
if ! [ -d /workspace/repo ]; then
  printf 'ERROR: Working directory /workspace/repo does not exist before validation\n' | tee -a /results/validation.log
  printf 'Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')" | tee -a /results/validation.log
  printf 'Filesystem state:\n' | tee -a /results/validation.log
  ls -laR /workspace 2>&1 | head -100 | tee -a /results/validation.log
  VALIDATION_EXIT=1
  VALIDATION_FAILED_COMMAND_DETAIL="Working directory /workspace/repo missing before validation"
  record_stage_timing "validation" "$VALIDATION_EXIT" ...
fi
```

**Impact**: Catches directory issues early; provides diagnostic info for troubleshooting

### Fix 3: Enhanced Error Diagnostics (Lines 1591-1604)

**Added:**

```bash
# Enhanced diagnostics for getcwd-type errors
if grep -q 'getcwd\|No such file or directory\|cannot access parent directories' /results/validation.log; then
  {
    printf '\n[DIAGNOSTICS] Validation command failed with directory access error:\n'
    printf 'Working directory status:\n'
    printf '  Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')"
    printf '  /workspace/repo exists: %s\n' "$([ -d /workspace/repo ] && echo 'yes' || echo 'no')"
    if [ -L /workspace/repo/node_modules ]; then
      printf '  node_modules is symlink → %s\n' "$(readlink /workspace/repo/node_modules 2>&1 || echo '<readlink failed>')"
    fi
    printf 'Last 20 lines of validation log:\n'
    tail -20 /results/validation.log
  } | tee -a /results/quality.log
fi
```

**Impact**: Captures filesystem state on getcwd errors; enables root cause analysis

## Testing

### Unit Tests ✅

- Non-login shell syntax verified in code
- Directory checkpoint logic confirmed
- Enhanced diagnostics patterns found
- Script syntax validation passed

### Integration Tests ✅

- Non-login npm validation commands execute successfully
- Directory checkpoint detects missing directories
- Enhanced diagnostics captured correctly

### Docker Build ✅

- Image built: `kaseki-agent:fix-validation`
- Script syntax valid in container
- Non-login shell fix present in deployed image

## Expected Outcome

**Before Fix:**

- matmetrics validation fails immediately
- Exit: 7 (from npm getcwd error)
- No diagnostic info about filesystem state

**After Fix:**

- matmetrics validation commands execute normally
- npm properly runs `npm run check`, `npm run test`, `npm run build`
- If directory issues occur, checkpoint catches them with full diagnostics
- If getcwd errors still occur (unlikely), diagnostics capture filesystem state for analysis

## Backwards Compatibility

✅ No breaking changes:

- Non-login shell is transparent to npm commands
- Directory checkpoint is defensive; only triggers if /workspace/repo missing
- Enhanced diagnostics are read-only; don't modify execution flow
- All changes operate before user code runs

## Notes

1. **Why non-login shell works**: Most npm commands and validation scripts don't rely on `~/.bashrc` or `~/.profile` behavior. The shell initialization was unnecessary overhead.

2. **Read-only filesystem is correct**: The `--read-only` flag in run-kaseki.sh is a necessary security control. This fix makes validation compatible with it.

3. **Symlink safety**: The fix doesn't change symlink handling. If `KASEKI_DEPENDENCY_RESTORE_MODE=symlink` is in use, diagnostics will detect broken symlinks.
