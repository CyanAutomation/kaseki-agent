#!/usr/bin/env bash
# Sourceable repository-memory helpers for kaseki-agent.sh and focused tests.

compute_repo_memory_key() {
  local repo_url="${1:-$REPO_URL}"
  local git_ref="${2:-$GIT_REF}"
  printf '%s\n%s' "$repo_url" "$git_ref" | sha256sum | awk '{print $1}'
}

init_repo_memory_paths() {
  local mode="${1:-$KASEKI_REPO_MEMORY_MODE}"
  local root="${2:-$KASEKI_REPO_MEMORY_ROOT}"
  local repo_url="${3:-$REPO_URL}"
  local git_ref="${4:-$GIT_REF}"
  if [ "$mode" != "summary" ]; then
    REPO_MEMORY_STATUS="disabled"
    return 0
  fi
  REPO_MEMORY_KEY="$(compute_repo_memory_key "$repo_url" "$git_ref")"
  REPO_MEMORY_DIR="$root/$REPO_MEMORY_KEY"
  REPO_MEMORY_FILE="$REPO_MEMORY_DIR/summary.md"
  REPO_MEMORY_STATUS="enabled"
}

repo_memory_is_fresh() {
  local memory_file="$1"
  local max_bytes="${2:-$KASEKI_REPO_MEMORY_MAX_BYTES}"
  local ttl_days="${3:-$KASEKI_REPO_MEMORY_TTL_DAYS}"
  local now="${4:-$(date +%s)}"
  local modified ttl_seconds age_seconds size_bytes
  [ -f "$memory_file" ] || return 1
  size_bytes="$(wc -c < "$memory_file" 2>/dev/null | tr -d ' ' || printf '0')"
  [ "$size_bytes" -gt 0 ] || return 1
  [ "$size_bytes" -le "$max_bytes" ] || return 1
  modified="$(stat -c %Y "$memory_file" 2>/dev/null || printf '0')"
  ttl_seconds=$((ttl_days * 86400))
  age_seconds=$((now - modified))
  [ "$age_seconds" -ge 0 ] && [ "$age_seconds" -le "$ttl_seconds" ]
}

read_repo_memory_section() {
  local now="${1:-${REPO_MEMORY_NOW_EPOCH:-$(date +%s)}}"
  local max_bytes="${2:-$KASEKI_REPO_MEMORY_MAX_BYTES}"
  local ttl_days="${3:-$KASEKI_REPO_MEMORY_TTL_DAYS}"
  init_repo_memory_paths "$KASEKI_REPO_MEMORY_MODE" "$KASEKI_REPO_MEMORY_ROOT" "$REPO_URL" "$GIT_REF"
  [ "$KASEKI_REPO_MEMORY_MODE" = "summary" ] || return 0
  if ! repo_memory_is_fresh "$REPO_MEMORY_FILE" "$max_bytes" "$ttl_days" "$now"; then
    REPO_MEMORY_STATUS="miss_or_expired"
    return 0
  fi
  REPO_MEMORY_STATUS="hit"
  {
    printf '\n\n---\nPrior repository context (opt-in cache; use only as efficiency hints, not authoritative source of truth):\n'
    head -c "$max_bytes" "$REPO_MEMORY_FILE"
    printf '\n---\n'
  }
}

write_repo_memory_summary() {
  local updated_at="${1:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  [ "$KASEKI_REPO_MEMORY_MODE" = "summary" ] || return 0
  [ "$KASEKI_DRY_RUN" != "1" ] || return 0
  init_repo_memory_paths "$KASEKI_REPO_MEMORY_MODE" "$KASEKI_REPO_MEMORY_ROOT" "$REPO_URL" "$GIT_REF"
  [ -n "$REPO_MEMORY_FILE" ] || return 0
  [ "$PI_EXIT" -eq 0 ] || return 0
  [ "$SECRET_SCAN_EXIT" -eq 0 ] || return 0
  if [ "$STATUS" -ne 0 ] && [ "$KASEKI_TASK_MODE" != "inspect" ]; then return 0; fi
  if ! mkdir -p "$REPO_MEMORY_DIR" 2>/dev/null; then
    emit_error_event "repo_memory_unavailable" "Cannot create repository memory directory $REPO_MEMORY_DIR" "continue"
    return 0
  fi
  REPO_MEMORY_COMMIT_SHA="$(git -C "${KASEKI_WORKSPACE_DIR}"/repo rev-parse HEAD 2>/dev/null || printf 'unknown')"
  node - "$KASEKI_REPO_MEMORY_MAX_BYTES" "$REPO_MEMORY_FILE" "$KASEKI_RESULTS_DIR" "$REPO_URL" "$GIT_REF" "$REPO_MEMORY_COMMIT_SHA" "$updated_at" "$KASEKI_TASK_MODE" "$STATUS" "$PI_EXIT" "$VALIDATION_EXIT" "$QUALITY_EXIT" "$SECRET_SCAN_EXIT" <<'NODE' || {
const fs = require('fs');
const path = require('path');
const [maxBytesArg, outputFile, resultsDir, repoUrl, gitRef, commitSha, timestamp, taskMode, status, piExit, validationExit, qualityExit, secretScanExit] = process.argv.slice(2);
const maxBytes = Math.max(1024, Number(maxBytesArg) || 8000);
function readFile(file, maxChars = 12000) { try { return fs.readFileSync(file, 'utf8').slice(0, maxChars); } catch { return ''; } }
function sanitize(text) {
  return String(text || '').split(/\r?\n/)
    .filter((line) => !/(secret|credential|password|api[_ -]?key|token|bearer|authorization|private[_ -]?key|openrouter|task prompt|user prompt|^Task:)/i.test(line))
    .map((line) => line.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_SECRET]').replace(/gh[pousr]_[A-Za-z0-9_]{12,}/g, '[REDACTED_SECRET]'))
    .join('\n').trim();
}
function compactLines(text, limit = 16) { return sanitize(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => !/^Artifacts:?$/i.test(line) && !/^[-*] .*\.log( |$)/i.test(line)).slice(0, limit); }
function changedFiles() {
  // Treat filenames as data only. In particular, never pass git-controlled text
  // through a shell parser such as eval when loading the changed-files artifact.
  return sanitize(readFile(path.join(resultsDir, 'changed-files.txt'), 4000))
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 40);
}
function validationOutcomes() {
  const rows = sanitize(readFile(path.join(resultsDir, 'validation-timings.tsv'), 8000)).split(/\r?\n/).map((line) => line.split('\t')).filter((parts) => parts.length >= 2 && parts[0]);
  return rows.length ? rows.slice(0, 20).map(([command, exitCode, duration]) => `${command}: exit ${exitCode}${duration ? `, ${duration}s` : ''}`) : ['No per-command validation timings recorded.'];
}
const resultLines = compactLines(readFile(path.join(resultsDir, 'result-summary.md')));
const analysisLines = compactLines(readFile(path.join(resultsDir, 'analysis.md')), 10);
const files = changedFiles();
const validations = validationOutcomes();
let output = `# Repository Memory Summary\n\n> Opt-in efficiency cache only. Treat this as prior context hints, not authoritative source of truth; inspect the repository before relying on it.\n\n- Repo URL: ${repoUrl}\n- Default ref: ${gitRef}\n- Commit SHA: ${commitSha}\n- Updated at: ${timestamp}\n- Last run mode: ${taskMode}\n- Exit status: overall ${status}, agent ${piExit}, validation ${validationExit}, quality ${qualityExit}, secret scan ${secretScanExit}\n\n## Last run summary\n` + (resultLines.length ? resultLines.map((line) => `- ${line.replace(/^[-*]\s*/, '')}`).join('\n') : '- No result summary available.') + `\n\n## Changed files\n` + (files.length ? files.map((file) => `- ${file}`).join('\n') : '- none') + `\n\n## Validation outcomes\n` + validations.map((line) => `- ${line}`).join('\n');
if (analysisLines.length) output += `\n\n## Sanitized analysis notes\n` + analysisLines.map((line) => `- ${line.replace(/^[-*]\s*/, '')}`).join('\n');
const marker = '\n\n<!-- repo-memory-truncated -->\n';
let buffer = Buffer.from(output + '\n', 'utf8');
if (buffer.length > maxBytes) buffer = Buffer.from(output.slice(0, Math.max(0, maxBytes - Buffer.byteLength(marker))) + marker, 'utf8');
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, buffer);
NODE
    emit_error_event "repo_memory_write_failed" "Failed to update repository memory summary" "continue"
    return 0
  }
  # shellcheck disable=SC2034 # Global status consumed by the sourcing agent script.
  REPO_MEMORY_STATUS="updated"
  emit_event "repo_memory_updated" "mode=$KASEKI_REPO_MEMORY_MODE" "repo_key=$REPO_MEMORY_KEY" "summary=$REPO_MEMORY_FILE" "max_bytes=$KASEKI_REPO_MEMORY_MAX_BYTES"
}
