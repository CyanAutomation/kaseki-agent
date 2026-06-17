# Kaseki Agent: Artifact Schemas

This document defines the formal structure of all kaseki-agent artifacts using JSON Schema and OpenAPI specifications. All artifacts follow **schema_version 2.0**.

## Core Principles

- **Always Generated**: All in-scope artifacts are produced on every run (no conditional flags)
- **Schema Versioning**: `schema_version` field tracks breaking changes
- **Consolidation**: Phase-specific data (validation, quality gates, secret scan) consolidated into `metadata.json.phases`
- **JSONL Format**: Multi-line JSON for streaming and appending (one JSON object per line)
- **Atomic Writes**: All file operations use temporary files and atomic moves

## metadata.json

**Schema Version**: 2.0  
**Availability**: Always (all runs)  
**Purpose**: Core run metadata with consolidated phase data

### Structure

```json
{
  "schema_version": "2.0",
  "instance": "kaseki-N",
  "repo_url": "https://github.com/org/repo",
  "git_ref": "main",
  "provider": "gateway",
  "model": "auto",
  "started_at": "2026-06-11T10:30:00Z",
  "ended_at": "2026-06-11T10:35:00Z",
  "duration_seconds": 300,
  "exit_code": 0,
  
  "phases": {
    "validation": {
      "exit_code": 0,
      "commands_attempted": 3,
      "stopped_early": false,
      "results": [
        {
          "command": "npm run test",
          "exit_code": 0,
          "duration_seconds": 45,
          "status": "passed"
        }
      ]
    },
    "quality_gates": {
      "exit_code": 0,
      "violations": [
        {
          "type": "changed_file_outside_allowlist",
          "detail": "File src/index.ts changed outside allowlist",
          "severity": "error",
          "timestamp": "2026-06-11T10:34:00Z"
        }
      ]
    },
    "secret_scan": {
      "exit_code": 0,
      "matches": [
        {
          "file": "tests/fixtures/keys.json",
          "pattern": "sk-or-abc123...",
          "status": "allowlisted",
          "timestamp": "2026-06-11T10:34:30Z"
        }
      ]
    }
  }
}
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema_version` | string | Yes | Version of metadata schema (breaking changes increment) |
| `instance` | string | Yes | Unique run identifier (kaseki-1, kaseki-2, ...) |
| `repo_url` | string | Yes | Git repository URL |
| `git_ref` | string | Yes | Git branch, tag, or commit SHA |
| `provider` | string | Yes | AI provider (gateway, custom, etc.) |
| `model` | string | Yes | Model identifier |
| `started_at` | ISO8601 | Yes | Run start timestamp |
| `ended_at` | ISO8601 | Yes | Run end timestamp |
| `duration_seconds` | number | Yes | Total run duration |
| `exit_code` | number | Yes | Container exit code (0=success) |
| `phases.validation.results[]` | array | Yes | Validation command results (empty array if no validation) |
| `phases.quality_gates.violations[]` | array | Yes | Quality gate violations (empty if no violations) |
| `phases.secret_scan.matches[]` | array | Yes | Secret scan matches (empty if no matches) |

### Validation Results Schema

```json
{
  "command": "npm run test",
  "exit_code": 0,
  "duration_seconds": 45,
  "status": "passed"
}
```

**Status Values**: `passed`, `failed`, `skipped`, `unknown`

### Quality Gate Violations Schema

```json
{
  "type": "changed_file_outside_allowlist",
  "detail": "File src/index.ts changed",
  "severity": "error",
  "timestamp": "2026-06-11T10:34:00Z"
}
```

**Type Values**:

- `changed_file_outside_allowlist` — Agent changed file outside allowlist
- `validation_allowlist_violation` — Validation changed file outside allowlist
- `diff_exceeds_max_bytes` — Diff larger than KASEKI_MAX_DIFF_BYTES
- `infrastructure_error` — System/environment failure

**Severity Values**: `error`, `warning`, `info`

### Secret Scan Matches Schema

```json
{
  "file": "tests/fixtures/keys.json",
  "pattern": "sk-or-abc123xyz789...",
  "status": "allowlisted",
  "timestamp": "2026-06-11T10:34:30Z"
}
```

**Status Values**:

- `allowlisted` — Pattern found in `.kaseki-secret-allowlist`
- `real_leak` — Unallowlisted credential (causes exit code 6)

---

## result-summary.md

**Schema Version**: 2.0 (markdown)  
**Availability**: Conditional (all successful completions)  
**Format**: Markdown human-readable summary

### Structure

```markdown
# Kaseki Run: kaseki-N

## Status

✅ **PASSED** (exit code 0)

## Key Metrics

- **Duration**: 5m 23s
- **Model**: auto (defaults to gateway's default model)
- **Commands**: 3 attempted, 3 passed
- **Diff Size**: 1.2 KB

## Changes

### Modified Files

- `src/index.ts` (45 lines)
- `src/utils.ts` (12 lines)

### Added Files

- `src/config.json`

## Validation Results

All validation commands passed:
- ✅ npm run lint (0.5s)
- ✅ npm run test (45s)
- ✅ npm run build (30s)

## Quality Gates

No violations detected.

## Secret Scan

No unallowlisted credentials detected.
```

---

## pi-events.jsonl

**Schema Version**: 2.0 (JSONL)  
**Availability**: Always (on agent invocation)  
**Format**: JSON Lines (one event per line)

### Structure

Each line is a JSON object:

```json
{
  "type": "tool_call",
  "timestamp": "2026-06-11T10:31:00Z",
  "duration_ms": 450,
  "tool_name": "grep_search",
  "input": {"query": "export", "pattern": "src/**/*.ts"},
  "result": "Found 12 matches",
  "status": "success"
}
```

### Event Types

- `message` — Agent message/thought
- `tool_call` — Tool invocation with input/output
- `model_response` — Model generation
- `error` — Tool execution failure

---

## pi-summary.json

**Schema Version**: 2.0  
**Availability**: Always (on agent invocation)  
**Format**: JSON statistics aggregate

### Structure

```json
{
  "schema_version": "2.0",
  "total_events": 156,
  "event_types": {
    "message": 42,
    "tool_call": 89,
    "model_response": 25
  },
  "input_tokens": 12450,
  "output_tokens": 3210,
  "thinking_time_ms": 15000,
  "model": "auto",
  "started_at": "2026-06-11T10:30:30Z",
  "ended_at": "2026-06-11T10:31:45Z",
  "duration_seconds": 75
}
```

---

## validation.log

**Format**: Text log (plain text)  
**Availability**: Always  
**Purpose**: Command output and timing information

### Structure

```
==> validation
Running command: npm run test
[timing] start=10:31:00 duration=45s exit_code=0

PASS src/parser.test.ts
  parse function
    ✓ parses valid input (5ms)
    ✓ rejects invalid input (3ms)

PASS src/utils.test.ts
  ...
```

---

## quality.log

**Format**: Text log (plain text)  
**Availability**: Always  
**Purpose**: Quality gate diagnostics and failures

### Structure

```
[validation-allowlist] 1 file(s) modified during validation outside allowlist
Validation-phase file outside allowlist: src/generated.ts

[quality-gate-violation] rule=validation_allowlist file=src/generated.ts

[secret-scan] ALLOWLISTED: tests/fixtures/keys.json (sk-or-abc...)
[quality-gate] PASSED: diff_size (1200 bytes <= 400000 max)
```

---

## git.diff

**Format**: Unified diff (text)  
**Availability**: On changes  
**Purpose**: Git diff output

### Structure

Standard unified diff format:

```diff
diff --git a/src/index.ts b/src/index.ts
index 1234567..abcdefg 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -10,3 +10,5 @@
 export function parse(input: string) {
+  // Added comment
+  return input.trim();
 }
```

---

## changed-files.txt

**Format**: Plain text (one file per line)  
**Availability**: On changes  
**Purpose**: List of modified files

### Structure

```
src/index.ts
src/utils.ts
src/config.json
```

---

## progress.jsonl

**Schema Version**: 2.0 (JSONL)  
**Format**: JSON Lines (one event per line)  
**Purpose**: Run progress tracking (sanitized)

### Structure

Each line is a progress event:

```json
{
  "timestamp": "2026-06-11T10:30:45Z",
  "stage": "pi agent",
  "status": "in_progress",
  "progress_percent": 25,
  "current_activity": "Running scouting phase",
  "time_elapsed_seconds": 15,
  "estimated_time_remaining_seconds": 45
}
```

---

## restoration.jsonl

**Schema Version**: 2.0 (JSONL)  
**Format**: JSON Lines (one event per line)  
**Purpose**: Allowlist restoration tracking

### Structure

```json
{
  "file": "src/generated.ts",
  "reason": "validation_allowlist_violation",
  "action": "restored_to_agent_version",
  "timestamp": "2026-06-11T10:34:15Z",
  "detail": "Validation changed file outside allowlist; restored to agent output"
}
```

---

## Deprecated Artifacts (Consolidated into metadata.json)

The following artifacts are **no longer generated** as of schema version 2.0:

- ~~`validation-results.json`~~ → `metadata.json.phases.validation.results`
- ~~`quality-gates.json`~~ → `metadata.json.phases.quality_gates.violations`
- ~~`secret-scan.json`~~ → `metadata.json.phases.secret_scan.matches`
- ~~`secret-scan.log`~~ → consolidated to JSON in metadata.json.phases
- ~~`stdout.log`~~ / ~~`stderr.log`~~ → streaming progress consolidated to progress.jsonl

### Migration Path

For code reading these old artifacts:

```python
# OLD (deprecated)
with open('validation-results.json') as f:
    results = json.load(f)

# NEW (schema 2.0)
with open('metadata.json') as f:
    metadata = json.load(f)
    results = metadata['phases']['validation']['results']
```

---

## Schema Versioning Strategy

- **2.0**: Consolidated phases, no separate JSON files (current)
- **1.x**: Separate validation-results.json, quality-gates.json, secret-scan.json (deprecated)
- **0.x**: Legacy format (unsupported)

Breaking changes increment major version. Tools should check `schema_version` on startup.

---

## References

- [CLAUDE.md](CLAUDE.md) — Artifact inventory and availability
- [ARTIFACT_EVALUATION_REVISED.md](ARTIFACT_EVALUATION_REVISED.md) — Phase 1-4 implementation
- [Quality Gates](QUALITY_GATES.md) — Exit codes and gate definitions
