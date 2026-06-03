# Pi CLI Tool: hashline_edit

**Status**: Proposed for implementation  
**Target Release**: Pi CLI with kaseki-agent integration  
**Purpose**: Content-anchored file edits using SHA-256 hashes instead of line numbers

---

## Overview

The `hashline_edit` tool enables Pi to perform file edits using hash-based content anchors instead of line numbers or text-based string replacement. This eliminates friction from context drift between read and edit phases.

**Problem Solved**:
- ✗ Current: String-based patches fail when file context changes between read and write
- ✗ Current: Line number edits become stale after previous edits shift lines
- ✗ Current: Retry loops consume tokens on patch failures
- ✓ New: Content anchors remain valid even if surrounding lines change

**Expected Impact**: 15–25% reduction in validation failures for large refactorings

---

## Tool Definition

### Name
```
hashline_edit
```

### Input Schema

```json
{
  "type": "hashline_edit",
  "file": "string",
  "anchor": {
    "start_hash": "string",
    "end_hash": "string",
    "context_lines": "number"
  },
  "replacement": "string"
}
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | string | Yes | Path to file (relative to workspace root) |
| `anchor.start_hash` | string | Yes | 8-character SHA-256 hash prefix of first line to replace |
| `anchor.end_hash` | string | Yes | 8-character SHA-256 hash prefix of last line to replace |
| `anchor.context_lines` | number | Yes | Number of surrounding lines to search within (default: 3–5) |
| `replacement` | string | Yes | New content to insert (can span multiple lines) |

### Response Schema

Pi CLI responds via standard tool_call event:

```json
{
  "type": "tool_call",
  "tool_name": "hashline_edit",
  "call": {
    "file": "src/parser.ts",
    "anchor": {
      "start_hash": "7a2f8c1e",
      "end_hash": "9b3d4f2a",
      "context_lines": 3
    },
    "replacement": "  // New implementation\n  return processResult(input);"
  }
}
```

## Hash Format

### Computing Line Hashes

1. Read line as-is (with or without trailing newline)
2. Normalize: Remove trailing `\n` if present
3. Compute: SHA-256 hash of normalized line
4. Prefix: Use first 8 characters (hexadecimal)

### Example

```typescript
import crypto from 'crypto';

function getLineHash(line: string): string {
  const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
  return crypto
    .createHash('sha256')
    .update(normalized, 'utf-8')
    .digest('hex')
    .slice(0, 8);
}

// Usage
const hash = getLineHash('  return 42;'); // → 'a1b2c3d4'
```

### Collision Risk

With 8-character SHA-256 prefixes:
- Hash space: ~16.7 million possible values
- In typical source files: <1% collision probability
- Mitigation: If collision detected, runtime requests retry with more `context_lines`

---

## Anchor Selection Guidelines

### For Pi Agent Behavior

1. **Read file first** to understand structure
2. **Identify lines by content**, not line numbers
3. **Include context**: Use 3–5 surrounding lines for disambiguation
4. **Prefer compact spans**: Replace minimal lines needed (1–5 typically)
5. **Multi-line replacements**: OK to span several lines if needed

### Example: Good vs. Bad Anchors

**✓ Good**: Single replacement with clear context
```json
{
  "anchor": {
    "start_hash": "abc123f4",    // "  const x = 1;"
    "end_hash": "abc123f4",      // Same line (single-line edit)
    "context_lines": 3           // Sufficient for uniqueness
  },
  "replacement": "  const x = 2;"
}
```

**✗ Bad**: Ambiguous or too loose context
```json
{
  "anchor": {
    "start_hash": "return42",    // Too short / wrong format
    "end_hash": "z9y8x7w6",      // Doesn't exist in file
    "context_lines": 1           // Insufficient context
  },
  "replacement": "  return 99;"
}
```

---

## Validation & Error Handling

### Success

Kaseki validates anchors and applies edit:

```json
{
  "status": "applied",
  "file": "src/parser.ts",
  "linesModified": 2,
  "reason": "Successfully applied"
}
```

### Validation Failures

#### Anchor Not Found
```json
{
  "status": "rejected",
  "reason": "Start anchor 7a2f8c1e not found in src/parser.ts"
}
```

**Cause**: Hash mismatch (file content changed, typo in hash)  
**Action**: Pi should retry with fresh file read

#### End Anchor Not Within Context
```json
{
  "status": "rejected",
  "reason": "End anchor 9b3d4f2a not found within context (searched lines 45–60)"
}
```

**Cause**: Lines between start and end exceed `context_lines`  
**Action**: Pi should increase `context_lines` and retry

#### File Not Found
```json
{
  "status": "rejected",
  "reason": "File not found: src/parser.ts"
}
```

**Cause**: Path is incorrect or file was deleted  
**Action**: Verify file exists before proposing edit

### Non-Fatal vs. Fatal Errors

- **Non-fatal** (recorded, continue): Anchor validation failures, file not found, malformed events
- **Fatal** (fail pipeline): System errors (disk I/O, permissions)

Kaseki treats hashline validation failures as non-fatal — rejected edits are logged but don't block the validation pipeline. This encourages Pi to attempt hashline edits without fear of breaking the entire run.

---

## Integration with Kaseki-Agent

### Tool Manifest

Pi is invoked with `--tools` parameter including `hashline_edit`:

```bash
pi --model "$KASEKI_MODEL" \
   --provider openrouter \
   --tools bash,read,write,search,hashline_edit \
   < "$TASK_PROMPT"
```

### Fallback Handling

If Pi doesn't support `hashline_edit`:
1. Kaseki removes tool from manifest
2. Pi uses bash/write tools (existing behavior)
3. No breaking changes; graceful degradation

### Feature Flag

Environment variable controls hashline prompt guidance:

```bash
# Enable (default)
export KASEKI_HASHLINE_EDITS=1

# Disable (use bash/write only)
export KASEKI_HASHLINE_EDITS=0
```

---

## Example Workflow

### 1. Pi Reads File
```python
# Pi reads to understand structure
with open('src/auth.ts', 'r') as f:
    content = f.read()
# Finds old login logic on lines 45–50
```

### 2. Pi Calls hashline_edit
```json
{
  "type": "tool_call",
  "tool_name": "hashline_edit",
  "call": {
    "file": "src/auth.ts",
    "anchor": {
      "start_hash": "d4e5f6a7",  // Old password hashing
      "end_hash": "c8b9a0d1",    // Old return statement
      "context_lines": 5
    },
    "replacement": "  // New PBKDF2 implementation\n  return crypto.pbkdf2(password, salt, 100000, 32);"
  }
}
```

### 3. Kaseki Validates & Applies
```
✓ start_hash d4e5f6a7 found at line 45
✓ end_hash c8b9a0d1 found at line 50
✓ anchor span within context_lines (5 lines)
→ Apply edit (replace lines 45–50)
→ Log: "hashline_edit applied: src/auth.ts (6 lines modified)"
```

### 4. Validation Runs
```bash
npm run test   # Runs with new code
npm run build  # Compiles successfully
# If either fails, Kaseki logs and continues (quality gate)
```

---

## Testing Pi's hashline_edit Support

### Smoke Test

Verify Pi can:

1. Call `hashline_edit` tool (check JSONL output)
2. Provide valid anchors (hashes exist in file)
3. Handle validation feedback (retry on stale anchor)

### Test Coverage

- [ ] Single-line edits
- [ ] Multi-line replacements
- [ ] Edits at file start/end
- [ ] Stale anchor detection (file changed)
- [ ] Context_lines handling (narrow and wide)
- [ ] Mixed tool usage (bash + hashline + write)

---

## References

- **Kaseki Integration**: See [docs/OHMYPI_FEATURE_INTEGRATION.md](docs/OHMYPI_FEATURE_INTEGRATION.md) — Feature 1
- **HashlineValidator**: See [src/hashline-validator.ts](src/hashline-validator.ts) — Kaseki-side validation
- **Event Handler**: See [src/hashline-event-handler.ts](src/hashline-event-handler.ts) — Processes Pi events

---

## Changelog

| Date | Version | Status | Notes |
|------|---------|--------|-------|
| 2026-06-03 | 1.0-draft | Proposed | Initial specification for Pi CLI integration |

---

## Contact / Questions

- **Kaseki Team**: kaseki-agent maintainers
- **Feature Sponsor**: Oh-My-Pi feature roadmap
- **EPIC**: Feature 1: Hashline Editing
