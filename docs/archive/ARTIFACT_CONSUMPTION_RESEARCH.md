# Kaseki Agent Artifacts - Comprehensive Consumption & Scoring Research

**Date**: 2026-06-11  
**Scope**: All 80+ artifact types in kaseki-agent with detailed consumption analysis  
**Focus**: Actual usage patterns (not theoretical), size ranges, and agent dependencies

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Artifacts** | 80+ types across all phases |
| **Always-Generated** | ~25 core artifacts |
| **Conditional** | ~55 feature/failure-dependent |
| **High-Value** | 15 (consumed by multiple tools) |
| **Redundant** | 8+ (duplicate information) |
| **Failure-Only** | 12 (skip on success) |
| **Agent-Dependent** | ~30 (external agents read) |

---

## ARTIFACT CONSUMPTION REFERENCE TABLE

### Legend

- **Current Usage**: Where is it actually read in the codebase?
- **Size Range**: Typical file sizes observed
- **Duplication**: Information overlap with other artifacts
- **Failure-Only**: Generated only on error?
- **Agent Dependency**: External agents (monitoring, CI/CD, retry logic) rely on it?
- **Score** (Proposed): Quality score 1-5 (5=essential, 1=redundant/deprecated)

---

## 1. CORE EXECUTION & LOGGING

### 1.1 stdout.log

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: readArtifact() for stage parsing; kaseki-report.ts not used directly; CI/CD polling for progress |
| **Size Range** | Medium (50-500 KB) - grows throughout run |
| **Duplication** | Overlaps with progress.jsonl (progress is subset) |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | **YES** - External monitors parse "==> Stage:" markers to track progress; CI/CD polls for timeouts |
| **How Consumed** | `getCurrentStage()` in kaseki-cli-lib.ts uses regex to find last "==> Stage:" marker |
| **Example** | Contains: setup, agent startup, validation commands echo, completion markers |
| **Proposed Score** | **4** (essential for human/agent monitoring, but info duplicated in progress.jsonl) |

### 1.2 stderr.log

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: detectErrors() scans for error patterns; kaseki-report.ts mentions in failure diagnostics |
| **Size Range** | Small-Medium (5-100 KB) - captured throughout |
| **Duplication** | Partial - errors also in failure.json; warnings also in quality.log |
| **Failure-Only** | No - always generated, even empty |
| **Agent Dependency** | **YES** - External monitors detect timeout/crash patterns; CI/CD checks for errors |
| **How Consumed** | `scanLogForErrors()` with regex `/error\|failed\|exception\|panic\|abort/i` |
| **Failure Patterns** | "Out of memory", "SIGTERM", "Timeout", Docker errors |
| **Proposed Score** | **5** (critical for error detection and debugging) |

### 1.3 progress.log

| Field | Value |
|-------|-------|
| **Current Usage** | Human-readable only (not consumed by code); informational |
| **Size Range** | Small (1-20 KB) - sparse entries |
| **Duplication** | **HEAVY** - Full duplicate of progress.jsonl in plain text |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | NO - Agents use progress.jsonl instead |
| **How Consumed** | Not parsed by any tool; exists for human readability |
| **Example** | "[2026-06-11T14:30:45Z] Stage: clone repository"; "[2026-06-11T14:35:22Z] Starting validation" |
| **Proposed Score** | **2** (low value - redundant with progress.jsonl; could be deprecated) |

### 1.4 progress.jsonl

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: readProgressEvents() for status polling; agent monitors use it |
| **Size Range** | Small-Medium (2-50 KB) - JSONL format, one event per line |
| **Duplication** | Overlaps with metadata.json timestamps, pi-summary.json stats |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | **YES** - External monitors use for real-time stage/progress tracking |
| **How Consumed** | `readProgressEvents()` splits by '\n', parses JSON, filters by stage/message |
| **Critical Fields** | `timestamp`, `stage` ("pi coding agent", "validation", etc.), `message`, `event_type` |
| **Proposed Score** | **5** (essential for live monitoring and external agents) |

### 1.5 exit_code

| Field | Value |
|-------|-------|
| **Current Usage** | Shell scripts and CI/CD pipelines read this; kaseki-cli-lib.ts via metadata.json |
| **Size Range** | Tiny (<1 KB) - single number |
| **Duplication** | Duplicate of metadata.json.exit_code |
| **Failure-Only** | No - always generated (0 on success) |
| **Agent Dependency** | **YES** - Critical for CI/CD pipelines and retry logic |
| **How Consumed** | Direct file read; also available in metadata.json |
| **Proposed Score** | **5** (essential for exit code checking in CI/CD) |

### 1.6 last-command.log

| Field | Value |
|-------|====|
| **Current Usage** | Not consumed by any tool (informational only) |
| **Size Range** | Tiny (1-2 KB) - single line |
| **Duplication** | Information also in stderr.log context |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | NO |
| **How Consumed** | Not parsed; human debugging only |
| **Proposed Score** | **2** (low value - informational only, rarely useful) |

---

## 2. METADATA & REPORTING

### 2.1 metadata.json

| Field | Value |
|-------|-------|
| **Current Usage** | **HEAVY** - kaseki-report.ts reads for all reporting; kaseki-cli-lib.ts for status/analysis; external agents parse |
| **Size Range** | Medium (10-50 KB) - highly detailed |
| **Duplication** | Central consolidation; some fields duplicate pi-summary.json, failure.json |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | **YES** - Primary consumption point for external agents |
| **Critical Fields** | exit_code, failed_command, model, duration_seconds, pi_duration_seconds, validation_exit_code, diff_nonempty |
| **Also Contains** | All stage exit codes (scouting, goal-check, validation, quality, secret-scan) |
| **How Consumed** | Direct JSON parse; fields extracted in kaseki-cli-lib and kaseki-report |
| **Proposed Score** | **5** (most-consumed artifact; central metadata source) |

### 2.2 result-summary.md

| Field | Value |
|-------|-------|
| **Current Usage** | Human-readable only; not parsed by tools; CLI may display it |
| **Size Range** | Small (0.5-5 KB) |
| **Duplication** | Information duplicated in metadata.json and failure.json |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | NO (human-targeted) |
| **How Consumed** | Not parsed; humans read it for quick status |
| **Example** | "Status: ✅ Success / ❌ Failed (exit code X)" + failed command, diff lines |
| **Proposed Score** | **3** (useful for human review, but info available elsewhere) |

### 2.3 failure.json

| Field | Value |
|-------|-------|
| **Current Usage** | Structured failure classification; used by external retry/feedback agents |
| **Size Range** | Small (1-10 KB) |
| **Duplication** | Information also in metadata.json, but more focused on failure context |
| **Failure-Only** | **YES** - Only generated on exit code != 0; empty on success |
| **Agent Dependency** | **YES** - Retry agents parse this for failure classification |
| **How Consumed** | JSON parse; external agents use for intelligent retry logic |
| **Critical Fields** | failure_class (from instance-state-derivation), failed_command, validation_failed_command, stderr_tail |
| **Proposed Score** | **4** (valuable for failure understanding and retry agents) |

---

## 3. PI CODING AGENT (Main)

### 3.1 pi-events.jsonl

| Field | Value |
|-------|-------|
| **Current Usage** | Not directly parsed by kaseki tools; consumed by external AI agents for understanding coding process |
| **Size Range** | Large (100-500 KB) - filtered from raw events |
| **Duplication** | pi-summary.json is aggregated view of these events |
| **Failure-Only** | No - always generated (even if empty on Pi failure) |
| **Agent Dependency** | **YES** - External agents (scouting feedback, debugging) read for event-level detail |
| **How Consumed** | External monitoring tools; not parsed internally |
| **Content** | Sanitized Pi events: tool_start, tool_end, assistant messages (no thinking blocks) |
| **Proposed Score** | **4** (valuable for external monitoring and debugging, but agents usually work with pi-summary.json) |

### 3.2 pi-summary.json

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: getAnalysis() reads for tool_executions count; kaseki-report.ts may reference |
| **Size Range** | Small-Medium (5-30 KB) |
| **Duplication** | High - summarizes pi-events.jsonl; some fields duplicate metadata.json |
| **Failure-Only** | No - always generated (with counts even on error) |
| **Agent Dependency** | **MODERATE** - External agents use for summary metrics (tool count, model, etc.) |
| **How Consumed** | `readJsonArtifact(instance, 'pi-summary.json')` in kaseki-cli-lib.ts |
| **Critical Fields** | selected_model, tool_start_count, tool_end_count, assistant_message_types |
| **Proposed Score** | **4** (useful aggregate, but duplicates pi-events.jsonl and metadata.json) |

### 3.3 pi-stderr.log

| Field | Value |
|-------|-------|
| **Current Usage** | Diagnostic/debugging only; not consumed by tools |
| **Size Range** | Small (0-20 KB) |
| **Duplication** | Errors also in stderr.log (container-level stderr) |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | NO - Not consumed by external agents |
| **How Consumed** | Manual debugging only |
| **Proposed Score** | **2** (low value - debugging artifact, not consumed) |

---

## 4. GIT & DIFF ARTIFACTS

### 4.1 git.diff

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: readArtifact() for getAnalysis(); secret-scan checks it; quality gates measure size |
| **Size Range** | **Variable** - Small (0 KB) to Very Large (>400 KB, triggers quality gate) |
| **Duplication** | Individual file content also in changed-files.txt (list only) |
| **Failure-Only** | No - always generated (empty if no changes) |
| **Agent Dependency** | **CONDITIONAL** - Used by external agents only if diff-based validation needed |
| **How Consumed** | Size check (quality.log); content search by secret-scan; external diff analysis |
| **Critical for** | Secret scanning (grep for sk-or-* patterns); quality gate (KASEKI_MAX_DIFF_BYTES) |
| **Proposed Score** | **5** (essential for quality gates and security scanning) |

### 4.2 changed-files.txt

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: getAnalysis() reads to count and list changed files; quality gates validate against allowlist |
| **Size Range** | Small (0.1-10 KB) - one filename per line |
| **Duplication** | File names also in git.status and git.diff (can be extracted) |
| **Failure-Only** | No - always generated (empty if no changes) |
| **Agent Dependency** | **YES** - External agents use for change analysis and allowlist validation |
| **How Consumed** | Line-by-line split in kaseki-cli-lib; allowlist matching in kaseki-agent.sh |
| **Critical for** | Allowlist restoration logic; external change analysis |
| **Proposed Score** | **5** (essential for allowlist validation and change tracking) |

### 4.3 git.status

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools; informational (can extract file info via git.diff or changed-files.txt) |
| **Size Range** | Small (0.1-5 KB) |
| **Duplication** | **HIGH** - Information fully duplicated in changed-files.txt and git.diff |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | NO - Agents use changed-files.txt instead |
| **How Consumed** | Not parsed; human inspection only |
| **Proposed Score** | **2** (low value - fully redundant with changed-files.txt) |

### 4.4 validation-before-state.txt & validation-after-state.txt

| Field | Value |
|-------|-------|
| **Current Usage** | check_validation_allowlist() uses diff to find validation-changed-files.txt |
| **Size Range** | Tiny (0.5-2 KB each) - tab-separated path:hash pairs |
| **Duplication** | Content also computable from git.diff |
| **Failure-Only** | No - always generated if validation runs |
| **Agent Dependency** | NO - Internal use only |
| **How Consumed** | awk-based diff to detect changed files during validation phase |
| **Proposed Score** | **3** (useful for validation allowlist checks, minimal size) |

### 4.5 validation-changed-files.txt

| Field | Value |
|-------|-------|
| **Current Usage** | check_validation_allowlist() reads to validate against KASEKI_VALIDATION_ALLOWLIST |
| **Size Range** | Tiny (0.1-1 KB) |
| **Duplication** | Subset of changed-files.txt (only validation phase changes) |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | NO - Internal use |
| **How Consumed** | Line-by-line validation against pattern |
| **Proposed Score** | **3** (specialized for validation allowlist, useful but small) |

---

## 5. VALIDATION - PRE-AGENT (BASELINE)

### 5.1 pre-validation.log

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools; informational comparison with validation.log |
| **Size Range** | Medium (20-200 KB) - depends on commands |
| **Duplication** | Errors also in failure.json; timing in pre-validation-timings.tsv |
| **Failure-Only** | No - generated if KASEKI_PRE_AGENT_VALIDATION=1 |
| **Agent Dependency** | **CONDITIONAL** - Used by external agents for baseline comparison |
| **How Consumed** | Not parsed internally; used for human or external comparison |
| **Proposed Score** | **3** (useful for baseline, but not consumed by tools) |

### 5.2 pre-validation-timings.tsv

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-report.ts: appendList() displays timing lines; metadata.json includes in timing data |
| **Size Range** | Tiny (0.5-5 KB) - tab-separated rows |
| **Duplication** | Timings also in metadata.json (per-stage summary) |
| **Failure-Only** | No - generated if validation runs |
| **Agent Dependency** | **CONDITIONAL** - External agents may use for timing analysis |
| **How Consumed** | Parsed line-by-line in kaseki-report for display |
| **Critical Fields** | command_name, elapsed_seconds |
| **Proposed Score** | **4** (useful for timing analysis and reporting) |

### 5.3 pre-validation-ts-check.log

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed; informational only |
| **Size Range** | Small (0-50 KB) - depends on TypeScript errors |
| **Duplication** | Errors also in failure.json context |
| **Failure-Only** | Only generated if KASEKI_TS_PRE_CHECK=1 AND typescript precheck runs |
| **Agent Dependency** | NO |
| **How Consumed** | Human inspection only |
| **Proposed Score** | **2** (informational, not consumed by tools) |

---

## 6. VALIDATION - POST-AGENT

### 6.1 validation.log

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: scanLogForErrors() detects validation failures; kaseki-report.ts mentions in diagnostics |
| **Size Range** | Medium (20-500 KB) - depends on command count and verbosity |
| **Duplication** | Errors also in failure.json and metadata.json |
| **Failure-Only** | No - always generated (even if empty) |
| **Agent Dependency** | **YES** - External agents parse for failure classification |
| **How Consumed** | Regex scan for /FAILED\|error\|failed/i patterns |
| **Critical for** | Failure classification; error detection |
| **Proposed Score** | **5** (essential for validation failure detection) |

### 6.2 validation-timings.tsv

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-report.ts: appendList() displays timing lines |
| **Size Range** | Tiny (0.5-5 KB) - tab-separated |
| **Duplication** | Timing data also in metadata.json |
| **Failure-Only** | No - always generated if validation runs |
| **Agent Dependency** | **CONDITIONAL** - External agents may analyze timing patterns |
| **How Consumed** | Line parsing in kaseki-report |
| **Proposed Score** | **4** (useful for timing analysis) |

### 6.3 test-baseline-comparison.json (from validation phase)

| Field | Value |
|-------|-------|
| **Current Usage** | Consumed by external agents for test failure analysis; metadata references it |
| **Size Range** | Small-Medium (5-50 KB) |
| **Duplication** | Some overlap with validation.log |
| **Failure-Only** | Only generated if baseline validation enabled |
| **Agent Dependency** | **YES** - External agents use for intelligent test failure classification |
| **How Consumed** | JSON parse by external tools |
| **Critical Fields** | pre_existing_failures, newly_introduced_failures, failure_classification |
| **Proposed Score** | **4** (valuable for external test analysis) |

---

## 7. AUTO LINT CLEANUP (POST-AGENT)

### 7.1 auto-lint-cleanup.log

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools; informational |
| **Size Range** | Small-Medium (5-100 KB) - depends on linting work |
| **Duplication** | Lint errors also in quality.log |
| **Failure-Only** | Only generated if KASEKI_AUTO_LINT_CLEANUP=1 |
| **Agent Dependency** | NO |
| **How Consumed** | Human inspection only |
| **Proposed Score** | **2** (low value - informational, not consumed) |

### 7.2 auto-lint-cleanup-timings.tsv

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-report.ts: appendList() displays |
| **Size Range** | Tiny (0.2-2 KB) |
| **Duplication** | Timing data also in metadata.json |
| **Failure-Only** | Only generated if cleanup runs |
| **Agent Dependency** | NO |
| **How Consumed** | Line parsing in kaseki-report |
| **Proposed Score** | **3** (minor value for reporting) |

---

## 8. QUALITY GATES & VALIDATION

### 8.1 quality.log

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: scanLogForErrors() treats all non-empty lines as errors; kaseki-report.ts references |
| **Size Range** | Tiny-Small (0.1-10 KB) - sparse violations only |
| **Duplication** | Violations also in quality-gates.json (structured) and metadata.json (exit codes) |
| **Failure-Only** | **CONDITIONAL** - Only has content if violations exist |
| **Agent Dependency** | **YES** - External error detection uses this |
| **How Consumed** | Line-by-line parsing; all non-empty lines are treated as errors |
| **Critical Content** | Diff size violations, allowlist violations, validation allowlist violations |
| **Proposed Score** | **5** (essential for quality gate detection) |

### 8.2 secret-scan.log

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: scanLogForErrors() scans if secret_scan_exit_code != 0; kaseki-report.ts measures byte size |
| **Size Range** | Tiny-Small (0-5 KB) - sparse hits only |
| **Duplication** | Structured results also in secret-scan.json (array format) |
| **Failure-Only** | **CONDITIONAL** - Only has content if secrets found |
| **Agent Dependency** | **YES** - External security monitoring reads this |
| **How Consumed** | Line scanning with context (file:line:match); also size measurement |
| **Critical for** | Secret detection and security scanning |
| **Proposed Score** | **5** (essential for security) |

### 8.3 restoration.jsonl

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-report.ts: parseRestorationMetrics() counts restored/kept for metrics; external agents analyze |
| **Size Range** | Tiny (0.1-5 KB) - JSONL, sparse entries |
| **Duplication** | Summary also in quality.log (human-readable) |
| **Failure-Only** | No - always generated (empty if no restoration) |
| **Agent Dependency** | **CONDITIONAL** - Used by agents for detailed allowlist analysis |
| **How Consumed** | JSONL parse; JSON objects with status (restored/kept), file, reason |
| **Critical Fields** | timestamp, event, file, status, reason |
| **Proposed Score** | **4** (useful structured data for allowlist metrics) |

### 8.4 restoration-report.md

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools; human-readable guidance document |
| **Size Range** | Small (0.5-5 KB) |
| **Duplication** | Information in restoration.jsonl (structured) and quality.log |
| **Failure-Only** | Only generated if restoration occurs |
| **Agent Dependency** | NO - Human-targeted |
| **How Consumed** | Human reading for guidance on allowlist adjustment |
| **Proposed Score** | **3** (useful for human guidance, but structured data elsewhere) |

### 8.5 quality-gates.json

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools; structured violation log |
| **Size Range** | Tiny (0.1-5 KB) - JSON array of violations |
| **Duplication** | Violations also in quality.log (text) and metadata.json |
| **Failure-Only** | Only has content if violations exist |
| **Agent Dependency** | **CONDITIONAL** - External agents may parse for structured violation data |
| **How Consumed** | JSON array parse (if used) |
| **Proposed Score** | **3** (structured but not actively consumed) |

### 8.6 critical-change-expectations.json

| Field | Value |
|-------|-------|
| **Current Usage** | verify_critical_change_expectations() reads for verification; external agents may use |
| **Size Range** | Tiny (0.2-1 KB) |
| **Duplication** | Minimal - specialized artifact |
| **Failure-Only** | Only generated if goal-setting enabled |
| **Agent Dependency** | **CONDITIONAL** - Used by external agents for change verification |
| **How Consumed** | JSON parse; fields: required_files, required_search_strings, forbidden_empty_diff |
| **Proposed Score** | **3** (specialized, useful but not always needed) |

---

## 9. SCOUTING AGENT (OPTIONAL)

### 9.1 scouting-events.jsonl

| Field | Value |
|-------|-------|
| **Current Usage** | Not directly consumed; external agents analyze for scouting process |
| **Size Range** | Medium (50-300 KB) - filtered scouting events |
| **Duplication** | scouting-summary.json is aggregated view |
| **Failure-Only** | Only generated if KASEKI_SCOUTING=1 |
| **Agent Dependency** | **CONDITIONAL** - External agents may analyze scouting decisions |
| **How Consumed** | External analysis; not parsed internally |
| **Proposed Score** | **3** (useful for external analysis, but summary.json usually sufficient) |

### 9.2 scouting-summary.json

| Field | Value |
|-------|-------|
| **Current Usage** | Metadata references; external agents may read for stats |
| **Size Range** | Small (2-10 KB) |
| **Duplication** | Stats also in scouting.json (final artifact) |
| **Failure-Only** | Only generated if KASEKI_SCOUTING=1 |
| **Agent Dependency** | **CONDITIONAL** - Agents may use for metrics |
| **How Consumed** | JSON parse (if used) |
| **Proposed Score** | **3** (useful summary, but info also in scouting.json) |

### 9.3 scouting.json

| Field | Value |
|-------|-------|
| **Current Usage** | External agents read for scouting task analysis results; metadata references |
| **Size Range** | Small (1-10 KB) - structured scouting output |
| **Duplication** | Information also in goal-setting.json, scouting-summary.json |
| **Failure-Only** | Only generated if KASEKI_SCOUTING=1 |
| **Agent Dependency** | **YES** - External agents use for task analysis |
| **How Consumed** | JSON parse; contains findings, recommendations, allowlist patterns |
| **Critical Fields** | allowlist_patterns, validation_allowlist, findings, confidence |
| **Proposed Score** | **4** (valuable for external agents and task analysis) |

### 9.4 scouting-candidate.json (intermediate)

| Field | Value |
|-------|-------|
| **Current Usage** | Validated and copied to scouting.json; not directly consumed elsewhere |
| **Size Range** | Small (1-5 KB) - raw output from Pi |
| **Duplication** | Content merged into scouting.json |
| **Failure-Only** | Only generated if scouting runs and completes |
| **Agent Dependency** | NO - Intermediate artifact |
| **How Consumed** | Validation logic only; validation errors in scouting-validation-errors.jsonl |
| **Proposed Score** | **1** (intermediate artifact, should be cleaned up) |

### 9.5 scouting-validation-errors.jsonl

| Field | Value |
|-------|-------|
| **Current Usage** | Validation diagnostics; not consumed by tools |
| **Size Range** | Tiny (0-2 KB) - only if validation fails |
| **Duplication** | Minimal - diagnostic artifact |
| **Failure-Only** | Only if scouting artifact validation fails |
| **Agent Dependency** | NO - Diagnostic only |
| **How Consumed** | Human debugging |
| **Proposed Score** | **2** (debugging artifact, not consumed by tools) |

### 9.6 scouting-stderr.log

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools |
| **Size Range** | Small (0-20 KB) |
| **Duplication** | Errors also in stderr.log |
| **Failure-Only** | No - always generated (may be empty) |
| **Agent Dependency** | NO |
| **How Consumed** | Human debugging |
| **Proposed Score** | **2** (debugging artifact) |

---

## 10. GOAL-SETTING AGENT (OPTIONAL)

### 10.1 goal-setting.json

| Field | Value |
|-------|-------|
| **Current Usage** | External agents read for goal refinement; metadata references |
| **Size Range** | Small (2-10 KB) |
| **Duplication** | Information also in goal-setting-summary.json |
| **Failure-Only** | Only if KASEKI_GOAL_SETTING=1 |
| **Agent Dependency** | **YES** - External agents use for goal context |
| **How Consumed** | JSON parse by external tools |
| **Critical Fields** | refined_goal, scope, constraints, expected_changes |
| **Proposed Score** | **4** (valuable for external goal understanding) |

### 10.2 goal-setting-events.jsonl & goal-setting-summary.json

| Field | Value |
|-------|-------|
| **Current Usage** | Not directly consumed; external analysis |
| **Size Range** | Medium/Small (50-300 KB / 2-10 KB) |
| **Duplication** | Summary duplicates goal-setting.json |
| **Failure-Only** | Only if KASEKI_GOAL_SETTING=1 |
| **Agent Dependency** | **CONDITIONAL** - Agents may analyze |
| **Proposed Score** | **3** (useful but not actively consumed) |

### 10.3 goal-setting-candidate.json (intermediate)

| Field | Value |
|-------|-------|
| **Current Usage** | Intermediate; validated and merged to goal-setting.json |
| **Size Range** | Small (1-5 KB) |
| **Duplication** | Content goes to goal-setting.json |
| **Failure-Only** | Only if goal-setting runs |
| **Agent Dependency** | NO - Intermediate |
| **Proposed Score** | **1** (intermediate, should cleanup) |

---

## 11. GOAL-CHECK AGENT (OPTIONAL, VERIFICATION LOOP)

### 11.1 goal-check.json

| Field | Value |
|-------|-------|
| **Current Usage** | Determines run status (met/not met); metadata references attempt count |
| **Size Range** | Tiny (0.5-2 KB) |
| **Duplication** | Fields also in metadata.json (exit codes, attempt info) |
| **Failure-Only** | Only if KASEKI_GOAL_CHECK=1 |
| **Agent Dependency** | **YES** - Determines retry logic for external agents |
| **How Consumed** | JSON parse; fields: met (boolean), confidence, summary, retry_prompt |
| **Critical for** | Retry decision logic; goal verification |
| **Proposed Score** | **5** (critical for goal verification and retry decisions) |

### 11.2 goal-check-attempts.jsonl

| Field | Value |
|-------|-------|
| **Current Usage** | External agents analyze for retry patterns and decisions |
| **Size Range** | Tiny (0.5-5 KB) - JSONL, one per attempt |
| **Duplication** | Summary in goal-check.json; metadata has attempt count |
| **Failure-Only** | Only if KASEKI_GOAL_CHECK=1 |
| **Agent Dependency** | **CONDITIONAL** - Agents may analyze retry patterns |
| **How Consumed** | JSONL parse (if analyzed) |
| **Critical Fields** | met, confidence, summary (per attempt) |
| **Proposed Score** | **3** (useful for analysis but not critical) |

### 11.3 goal-check-events.jsonl & goal-check-summary.json & goal-check-stderr.log

| Field | Value |
|-------|-------|
| **Current Usage** | Not directly consumed; external analysis |
| **Size Range** | Medium/Small (50-300 KB / 2-10 KB / 0-20 KB) |
| **Duplication** | Errors also in stderr.log |
| **Failure-Only** | Only if KASEKI_GOAL_CHECK=1 |
| **Agent Dependency** | NO - Not actively consumed |
| **Proposed Score** | **2** (informational/debugging) |

### 11.4 goal-check-validation-errors.jsonl

| Field | Value |
|-------|-------|
| **Current Usage** | Diagnostic only |
| **Size Range** | Tiny (0-2 KB) |
| **Duplication** | Minimal |
| **Failure-Only** | Only if validation fails |
| **Agent Dependency** | NO |
| **Proposed Score** | **2** (debugging) |

---

## 12. RUN-EVALUATION AGENT (OPTIONAL, POST-RUN ASSESSMENT)

### 12.1 run-evaluation.json

| Field | Value |
|-------|-------|
| **Current Usage** | External agents read for post-run assessment; metadata references |
| **Size Range** | Small (1-10 KB) |
| **Duplication** | Information also in run-evaluation-summary.json |
| **Failure-Only** | Only if KASEKI_RUN_EVALUATION=1 |
| **Agent Dependency** | **CONDITIONAL** - Used for post-run analysis |
| **How Consumed** | JSON parse by external tools |
| **Critical Fields** | success, confidence, summary, issues, recommendations |
| **Proposed Score** | **3** (useful for post-run analysis but not critical) |

### 12.2 run-evaluation-events.jsonl & run-evaluation-summary.json & run-evaluation-stderr.log

| Field | Value |
|-------|-------|
| **Current Usage** | Not directly consumed |
| **Size Range** | Medium/Small/Small |
| **Duplication** | Summary duplicates run-evaluation.json |
| **Failure-Only** | Only if enabled |
| **Agent Dependency** | NO - Not actively consumed |
| **Proposed Score** | **2** (informational) |

### 12.3 run-evaluation-candidate.json (intermediate)

| Field | Value |
|-------|-------|
| **Current Usage** | Intermediate; validated and merged |
| **Size Range** | Small (1-5 KB) |
| **Duplication** | Content goes to run-evaluation.json |
| **Failure-Only** | Only if enabled |
| **Agent Dependency** | NO - Intermediate |
| **Proposed Score** | **1** (intermediate, cleanup) |

---

## 13. TEST & IMPACT ANALYSIS

### 13.1 test-impact-warnings.log

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools; informational |
| **Size Range** | Tiny (0-10 KB) |
| **Duplication** | Information also available from git.diff analysis |
| **Failure-Only** | Only if test impact detected |
| **Agent Dependency** | NO |
| **How Consumed** | Human inspection |
| **Proposed Score** | **2** (informational only) |

### 13.2 expectation-mismatch-warnings.jsonl

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools; informational |
| **Size Range** | Tiny (0-10 KB) - JSONL |
| **Duplication** | Minimal |
| **Failure-Only** | Only if enabled and mismatches found |
| **Agent Dependency** | NO |
| **How Consumed** | Human inspection |
| **Proposed Score** | **2** (informational) |

### 13.3 critical-change-expectations.json

| Field | Value |
|-------|-------|
| **Current Usage** | verify_critical_change_expectations() reads for validation |
| **Size Range** | Tiny (0.2-1 KB) |
| **Duplication** | Minimal - specialized |
| **Failure-Only** | Only if goal-setting enabled |
| **Agent Dependency** | **CONDITIONAL** |
| **Proposed Score** | **3** (specialized, useful) |

---

## 14. DEPENDENCY & CACHING

### 14.1 dependency-cache.log

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-report.ts: appendList() displays cache lines; metadata references |
| **Size Range** | Small (0.5-10 KB) - sparse entries |
| **Duplication** | Cache hit/miss info also in metadata.json |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | **CONDITIONAL** - Used for performance analysis |
| **How Consumed** | Line parsing in kaseki-report |
| **Example** | "cache hit: workspace cache", "restored from image seed cache" |
| **Proposed Score** | **4** (useful for caching analysis) |

### 14.2 stage-timings.tsv

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-report.ts: appendList() displays; external agents for performance analysis |
| **Size Range** | Tiny (0.5-5 KB) - tab-separated |
| **Duplication** | Timing data also in metadata.json (per-stage) |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | **CONDITIONAL** - Used for performance tuning |
| **How Consumed** | Line parsing |
| **Critical Fields** | stage_name, elapsed_seconds |
| **Proposed Score** | **4** (useful for performance analysis) |

---

## 15. FILTERING & PROCESSING

### 15.1 filter-diagnostics.log

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools; diagnostic only |
| **Size Range** | Small (0-20 KB) |
| **Duplication** | Diagnostic information |
| **Failure-Only** | Only if KASEKI_DEBUG_RAW_EVENTS=1 and filter fails |
| **Agent Dependency** | NO |
| **How Consumed** | Human debugging |
| **Proposed Score** | **1** (debug artifact, rarely needed) |

### 15.2 format-check-command.txt

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools |
| **Size Range** | Tiny (0.1-0.5 KB) - single line |
| **Duplication** | Command also in validation-env.log |
| **Failure-Only** | Only if format check enabled |
| **Agent Dependency** | NO |
| **How Consumed** | Not used |
| **Proposed Score** | **1** (low value) |

---

## 16. GITHUB OPERATIONS (OPTIONAL)

### 16.1 git-push.log

| Field | Value |
|-------|-------|
| **Current Usage** | Not consumed by tools; informational |
| **Size Range** | Small (0-20 KB) |
| **Duplication** | Push status also in metadata.json |
| **Failure-Only** | Only if GitHub push enabled |
| **Agent Dependency** | NO |
| **How Consumed** | Human inspection |
| **Proposed Score** | **2** (informational) |

---

## 17. CONSOLIDATION & AGGREGATION ARTIFACTS

### 17.1 timings-manifest.json

| Field | Value |
|-------|-------|
| **Current Usage** | Not actively consumed; exists for data consolidation |
| **Size Range** | Small (1-10 KB) - JSON arrays |
| **Duplication** | Timing data also in TSV files and metadata.json |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | **CONDITIONAL** - Agents may use for consolidated timing |
| **How Consumed** | JSON parse (if used) |
| **Proposed Score** | **3** (consolidated view, but TSVs often sufficient) |

### 17.2 all-phase-summaries.json

| Field | Value |
|-------|-------|
| **Current Usage** | Not actively consumed; exists for phase consolidation |
| **Size Range** | Small (1-10 KB) - JSON array |
| **Duplication** | Information also in individual phase artifacts |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | NO - Not actively consumed |
| **Proposed Score** | **2** (consolidation artifact, not actively used) |

### 17.3 validation-results.json & cache-metrics.json & secret-scan.json

| Field | Value |
|-------|-------|
| **Current Usage** | Not actively consumed; structured logs |
| **Size Range** | Small (0.5-10 KB) - JSON arrays |
| **Duplication** | Information also in corresponding .log and .jsonl files |
| **Failure-Only** | No - always initialized (may be empty) |
| **Agent Dependency** | **CONDITIONAL** - Agents may parse structured versions |
| **Proposed Score** | **3** (structured but not actively consumed) |

---

## 18. HOST-LEVEL ARTIFACTS

### 18.1 host-start.json

| Field | Value |
|-------|-------|
| **Current Usage** | kaseki-cli-lib.ts: reads extensively for repo, ref, model, timeout config |
| **Size Range** | Small (0.5-2 KB) |
| **Duplication** | Some fields duplicated in metadata.json |
| **Failure-Only** | No - always generated |
| **Agent Dependency** | **YES** - External agents read for instance config |
| **How Consumed** | JSON parse in kaseki-cli-lib.ts (readInstanceMetadata) |
| **Critical Fields** | repo_url, git_ref, model, agentTimeoutSeconds |
| **Proposed Score** | **5** (essential for agent configuration and instance context) |

---

## REDUNDANCY & DUPLICATION ANALYSIS

### Heavy Duplicates (Can be Removed)

| Artifact Pair | Duplication % | Recommendation |
|---------------|---------------|-----------------|
| progress.log + progress.jsonl | 95% | **REMOVE progress.log** - redundant plain text |
| git.status + changed-files.txt + git.diff | 80% | **REMOVE git.status** - fully duplicated |
| scouting-candidate.json | 100% | **REMOVE** after validation (intermediate) |
| goal-setting-candidate.json | 100% | **REMOVE** after validation (intermediate) |
| goal-check-candidate.json | 100% | **REMOVE** after validation (intermediate) |
| run-evaluation-candidate.json | 100% | **REMOVE** after validation (intermediate) |
| goal-setting-events.jsonl + goal-setting-summary.json | 70% | Consider consolidating |
| all-phase-summaries.json | 60% | Not actively consumed |
| filter-diagnostics.log | N/A | Debug artifact only |
| pi-stderr.log | Partial | Errors also in stderr.log |

### Moderate Overlap (Acceptable)

| Artifact Pair | Duplication % | Notes |
|---------------|---------------|-------|
| metadata.json + result-summary.md | 40% | result-summary is human-readable summary |
| pi-events.jsonl + pi-summary.json | 60% | Summary is useful aggregate |
| validation.log + failure.json | 30% | failure.json is more structured |
| scouting.json + scouting-summary.json | 50% | Both useful |
| quality.log + quality-gates.json | 70% | JSON is structured version |

---

## AGENT CONSUMPTION SUMMARY

### External Agents REQUIRE (High Priority)

1. **metadata.json** - Primary consumption point
2. **progress.jsonl** - Live monitoring
3. **exit_code** / **exit_code file** - Retry logic
4. **changed-files.txt** - Change analysis
5. **git.diff** - Diff-based validation
6. **validation.log** - Failure classification
7. **quality.log** - Quality gate checking
8. **secret-scan.log** - Security monitoring
9. **goal-check.json** - Verification loop
10. **failure.json** - Failure context

### External Agents USE (Conditional)

- pi-events.jsonl, pi-summary.json
- stage-timings.tsv, dependency-cache.log
- scouting.json, goal-setting.json, run-evaluation.json
- test-baseline-comparison.json
- host-start.json

### External Agents IGNORE (Low Priority)

- progress.log, pi-stderr.log, filter-diagnostics.log
- auto-lint-cleanup.log, git-push.log
- All *-candidate.json files (intermediates)
- All *-validation-errors.jsonl files (diagnostics)

---

## FAILURE-ONLY ARTIFACTS (Skip on Success)

| Artifact | Always? | Notes |
|----------|---------|-------|
| failure.json | NO | Only if exit_code != 0 |
| quality.log | NO | Only if violations exist |
| secret-scan.log | NO | Only if secrets found |
| restoration.jsonl | NO | Only if restoration occurs |
| restoration-report.md | NO | Only if restoration occurs |
| scouting-validation-errors.jsonl | NO | Only if scouting validation fails |
| scouting-stderr.log | NO | May be empty |
| goal-check-validation-errors.jsonl | NO | Only if validation fails |
| test-impact-warnings.log | NO | Only if impact detected |
| expectation-mismatch-warnings.jsonl | NO | Only if mismatches found |
| filter-diagnostics.log | NO | Only if debug enabled |

---

## FINAL SCORING SUMMARY TABLE

| Score | Meaning | Example Artifacts |
|-------|---------|------------------|
| **5** | **ESSENTIAL** - Consumed by multiple tools, agents, or CI/CD | metadata.json, exit_code, changed-files.txt, git.diff, stderr.log, validation.log, quality.log, secret-scan.log, progress.jsonl, stdout.log, goal-check.json, host-start.json |
| **4** | **HIGH VALUE** - Consumed by tools or agents, or critical for specific use cases | pi-events.jsonl, pi-summary.json, dependency-cache.log, stage-timings.tsv, validation-timings.tsv, failure.json, scouting.json, goal-setting.json, restoration.jsonl, run-evaluation.json, host-start.json |
| **3** | **MODERATE** - Useful but not actively consumed by tools, or specialized/optional features | pre-validation.log, pre-validation-timings.tsv, test-baseline-comparison.json, validation-before/after-state.txt, validation-changed-files.txt, pre-validation-ts-check.log, auto-lint-cleanup-timings.tsv, result-summary.md, restoration-report.md, quality-gates.json, critical-change-expectations.json, goal-check-attempts.jsonl, timings-manifest.json, scouting-events.jsonl, goal-setting-events.jsonl, goal-check-events.jsonl, run-evaluation-events.jsonl |
| **2** | **LOW VALUE** - Informational only, debugging, rarely used by agents | progress.log, last-command.log, git.status, pi-stderr.log, auto-lint-cleanup.log, scouting-stderr.log, scouting-validation-errors.jsonl, scouting-summary.json, goal-setting-summary.json, goal-check-stderr.log, goal-check-summary.json, goal-check-validation-summary.txt, run-evaluation-stderr.log, run-evaluation-summary.json, test-impact-warnings.log, expectation-mismatch-warnings.jsonl, git-push.log, all-phase-summaries.json, pre-validation-raw.log, validation-raw.log |
| **1** | **DEPRECATED/INTERMEDIATE** - Should be removed; redundant or only used as step in validation | scouting-candidate.json, goal-setting-candidate.json, goal-check-candidate.json, run-evaluation-candidate.json, filter-diagnostics.log, format-check-command.txt |

---

## RECOMMENDATIONS FOR ARTIFACT OPTIMIZATION

### Immediate Actions (Clean-up Intermediates)

- Remove **-candidate.json files after successful validation
- Remove filter-diagnostics.log unless explicitly requested
- Remove progress.log (fully redundant with progress.jsonl)
- Remove git.status (fully redundant with changed-files.txt)

### Medium-Term (Consolidation)

- Merge validation-raw.log → validation.log (no benefit to separate)
- Consider merging goal-check-attempts.jsonl data into goal-check.json metadata
- Consolidate scouting summary artifacts (too many near-duplicates)

### Long-Term (Reduce Noise)

- Evaluate if *-validation-errors.jsonl files are worth keeping (diagnostic noise)
- Consider whether all phase stderr logs are necessary vs central stderr.log
- Evaluate if all -summary.json files are worth individual generation

### Keep Unchanged (High Value)

- All Score 5 artifacts - these are essential
- progress.jsonl - essential for live monitoring
- metadata.json - central metadata source
- All validation/quality/security related artifacts

---

## Reference: How Tools Actually Consume Artifacts

### kaseki-report.ts

```typescript
// Reads in this order for reporting:
1. metadata.json - all exit codes, timings, configuration
2. pi-summary.json - model, event stats
3. changed-files.txt - list of changed files
4. validation-timings.tsv - per-command timings
5. stage-timings.tsv - per-stage timings
6. dependency-cache.log - cache strategy
7. secret-scan.log - byte count
8. restoration.jsonl - count restored vs kept files
9. failure.json / quality.log / secret-scan.log / pi-stderr.log (for next diagnostic)
```

### kaseki-cli-lib.ts

```typescript
// readInstanceMetadata() → reads for all CLI commands:
1. metadata.json - primary source
2. host-start.json - repo/ref/model/timeout

// getInstanceStatus() → for status polling:
1. metadata.json
2. host-start.json
3. stdout.log (stage parsing via "==>")

// detectErrors() → for error detection:
1. metadata.json
2. stderr.log (error pattern scan)
3. quality.log (all non-empty lines = errors)
4. secret-scan.log (conditional on secret_scan_exit_code)
5. validation.log (error pattern scan)

// getAnalysis() → for post-run analysis:
1. metadata.json
2. pi-summary.json
3. changed-files.txt
4. Errors from detectErrors()
```

### External Agents (Monitoring/Retry)

```typescript
// Typical polling loop:
1. metadata.json - check exit_code, model, duration
2. progress.jsonl - parse last N events for stage
3. If not complete: sleep and retry
4. If complete: analyze goal-check.json for retry decision
5. If retry needed: prepare new task with failure context from failure.json
```

---

## CONCLUSION

This research provides the scoring framework needed to:

1. **Identify high-value artifacts** (Score 5) - Essential to keep and optimize
2. **Find redundancies** (Score 1-2) - Safe to remove or consolidate  
3. **Understand consumption patterns** - How tools actually use artifacts
4. **Prioritize agent dependencies** - What external agents require
5. **Optimize storage** - Remove low-value artifacts to reduce total artifact size

**Total actionable artifacts**: ~50-60 (after removing intermediates, redundant logs)  
**Recommended retention**: ~35-40 high-value artifacts
**Estimated size savings**: 20-30% by removing duplicates and intermediates
