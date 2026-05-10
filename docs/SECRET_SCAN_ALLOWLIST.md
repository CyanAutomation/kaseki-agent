# Secret Scan Allowlist

## Overview

The secret scan allowlist permits known safe patterns (test fixtures) while still detecting real credential leaks. This prevents false positives on intentional test credentials while maintaining security.

## Mechanism

The secret scan executes in two phases:

1. **Detection**: Scans `/results`, `/workspace/repo/.git`, `/workspace/repo/src`, and `/workspace/repo/tests` for patterns matching `sk-or-[A-Za-z0-9_-]{20,}` (OpenRouter API key format)

2. **Filtering**: Each detected pattern is checked against `.kaseki-secret-allowlist`
   - If the pattern is in the allowlist → marked as safe, does NOT trigger exit code 6
   - If the pattern is NOT in the allowlist → real leak detected, triggers exit code 6

## Allowlist File Format

**Location**: `.kaseki-secret-allowlist` (repository root)

**Format**: One entry per line

```
<file-path>:<credential-pattern>
```

**Example**:

```
tests/quality-gates.test.sh:sk-or-aBcDeFgHiJkLmNoPqRsT
test/kaseki-api.integration.test.sh:sk-test-integration-key
```

## Adding Allowlist Entries

### When to Add an Entry

Add an allowlist entry when:

- ✅ Creating a **test fixture** with a fake credential pattern (e.g., `sk-or-` test key)
- ✅ The pattern is **intentional and documented** in the code
- ✅ The file is in a **test directory** (`tests/`, `test/`, or `*test*`)

### When NOT to Add an Entry

Do NOT add an allowlist entry for:

- ❌ Real API keys or tokens (rotate immediately, don't allowlist)
- ❌ Credentials in production code (`src/`, `lib/`, etc.)
- ❌ Secrets that "accidentally" appear in logs or artifacts
- ❌ Undocumented or unexplained patterns

### Steps to Add an Entry

1. **Verify the pattern is intentional** (documented in code comments)

   ```bash
   # Example: comment in test file
   # Test fixture: intentional fake API key for integration testing
   API_KEY="sk-test-integration-key"
   ```

2. **Extract the file path and pattern**
   - File path: relative to repository root (e.g., `test/kaseki-api.integration.test.sh`)
   - Pattern: the credential-like string detected by secret scan (e.g., `sk-test-integration-key`)

3. **Add entry to `.kaseki-secret-allowlist`**

   ```
   test/kaseki-api.integration.test.sh:sk-test-integration-key
   ```

4. **Test the fix**

   ```bash
   # Run secret scan on the repo
   ./kaseki-agent.sh
   # Should pass with exit code 0 (no real leaks)
   ```

## Audit Procedure

Conduct a security audit of the allowlist quarterly:

1. **Review each entry**

   ```bash
   cat .kaseki-secret-allowlist
   ```

2. **Verify the corresponding test file still exists and explains the pattern**

   ```bash
   # For each entry, check:
   grep -n "sk-or-\|sk-test-" <file> || echo "Pattern not found; consider removing entry"
   ```

3. **Confirm no test files have been removed**

   ```bash
   # If a file no longer exists, remove its allowlist entry
   ```

4. **Check git history** for any patterns that predate the file

   ```bash
   git log --all --oneline --grep="secret-scan\|allowlist" | head -20
   ```

5. **Generate audit report**

   ```bash
   wc -l .kaseki-secret-allowlist
   echo "Review complete. All patterns verified."
   ```

## Troubleshooting

### Symptoms

**Problem**: "Secret scan failed with exit code 6"

- Check `/agents/kaseki-results/kaseki-N/secret-scan.log` for detected patterns
- If the pattern is intentional (test fixture):
  1. Verify it's in a test file
  2. Add entry to `.kaseki-secret-allowlist` using steps above
  3. Rerun kaseki

**Problem**: "Pattern in allowlist but still failing"

- Verify the **exact file path** matches (relative to repo root)
- Verify the **exact pattern** matches (copy-paste from secret-scan.log)
- Whitespace matters: no leading/trailing spaces
- Check file path normalization (no `/workspace/repo/` prefix)

**Problem**: "Allowlist entry prevents real leak detection"

- Allowlist should **only** contain test fixtures
- If you detect a real leak, **never add it to allowlist**
- **Rotate the leaked credential immediately**
- Remove it from code and git history using `git filter-branch` or `bfg-repo-cleaner`
- Add the real pattern to `.kaseki-secret-allowlist` temporarily **only** if you must (not recommended)

## Integration with CI/CD

The allowlist travels with the repository:

- **When cloning**: The `.kaseki-secret-allowlist` file is committed to git and cloned with the repo
- **In Docker containers**: The allowlist is available in `/workspace/repo/.kaseki-secret-allowlist`
- **In pull requests**: Changes to the allowlist are auditable via git history

## Security Considerations

⚠️ **Important**: The allowlist is a trust boundary. An attacker who can modify this file could hide real credentials.

Recommendations:

- **Protect the allowlist**: Require pull request review for changes to `.kaseki-secret-allowlist`
- **Minimal scope**: Keep only necessary test fixtures; remove outdated entries
- **Documentation**: Comment each entry explaining why it exists
- **Automation**: Consider signed commits or branch protection rules for the allowlist file

## Examples

### Example 1: Test Fixture for Secret Scan Validation

**File**: `tests/quality-gates.test.sh` (line 91)

```bash
# Create a file with a fake API key
cat > "$TMP_DIR/results/secret-test.txt" <<'EOF'
This file has an OpenRouter API key: sk-or-aBcDeFgHiJkLmNoPqRsT
EOF
```

**Allowlist Entry**:

```
tests/quality-gates.test.sh:sk-or-aBcDeFgHiJkLmNoPqRsT
```

### Example 2: Integration Test with Mock API Key

**File**: `test/kaseki-api.integration.test.sh` (line 5)

```bash
# Test fixture: intentional fake API key for integration testing
API_KEY="sk-test-integration-key"
```

**Allowlist Entry**:

```
test/kaseki-api.integration.test.sh:sk-test-integration-key
```

## References

- [CLAUDE.md](CLAUDE.md#Quality-Gates-and-Exit-Codes) — Exit codes and quality gates
- [docs/SECURITY.md](SECURITY.md) — Security hardening overview
- [docs/QUALITY_GATES.md](QUALITY_GATES.md) — Other quality gates (diff size, changed files)
