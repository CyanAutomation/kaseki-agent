#!/bin/bash
# Sourceable Pi JSON capture helper. The caller provides provider configuration
# and emit_error_event.

run_pi_json_capture() {
  local raw_events_file="$1"
  local timeout_seconds="$2"
  local model="$3"
  local prompt="$4"
  local stderr_target="${5:-}"
  local pi_exit progress_exit progress_stderr progress_fifo progress_pid splitter_exit pi_tools bounded_prompt phase_tool_output_cap
  local pi_openrouter_api_key="${openrouter_api_key:-${OPENROUTER_API_KEY:-}}"
  local pi_llm_gateway_api_key="${llm_gateway_api_key:-${LLM_GATEWAY_API_KEY:-}}"
  local pi_llm_gateway_url="${llm_gateway_url:-${LLM_GATEWAY_URL:-}}"
  local -a pipeline_statuses

  # Keep the tool schema—and therefore every provider request—specific to the
  # phase.  Read-only phases must not receive mutation or shell tools.  This
  # also makes accidental writes impossible during evaluation.
  case "${KASEKI_INFERENCE_PHASE:-coding}" in
    goal-setting)
      pi_tools="read,write"
      ;;
    scouting)
      pi_tools="read,search,write"
      ;;
    goal-check|run-evaluation)
      pi_tools="read,search"
      if [ "${KASEKI_GOAL_CHECK_CONTRACT_REPAIR:-0}" = "1" ]; then
        # The controller owns the mandatory artifact.  A repair pass is a
        # one-shot serialization request, not another agent turn: giving it
        # no tools prevents a final exploration loop from consuming the
        # response budget without ever returning the verdict.
        pi_tools=""
      fi
      ;;
    *)
      pi_tools="bash,read,write,search"
      if [ "${KASEKI_HASHLINE_EDITS:-1}" != "0" ]; then
        pi_tools="${pi_tools},hashline_edit"
      fi
      ;;
  esac

  case "${KASEKI_INFERENCE_PHASE:-coding}" in
    goal-setting|scouting) phase_tool_output_cap="${KASEKI_PRECODING_TOOL_OUTPUT_MAX_CHARS:-4000}" ;;
    goal-check|run-evaluation) phase_tool_output_cap="${KASEKI_EVALUATOR_TOOL_OUTPUT_MAX_CHARS:-2000}" ;;
    *) phase_tool_output_cap="${KASEKI_TOOL_OUTPUT_MAX_CHARS:-4000}" ;;
  esac

  # Tool output is fed back into Pi's next completion.  Require bounded,
  # artifact-first output so a broad command or file read cannot dominate all
  # subsequent context.  The full result remains available on disk for a
  # targeted follow-up read.
  bounded_prompt="${prompt}

Tool-output target: aim for each result <=${phase_tool_output_cap} chars. Read/search exact ranges. Large output -> /results; return only path, bytes, hash, failures, and a <=400-character relevant excerpt. Do not repeat unchanged output. At a context checkpoint, finish with a compact handoff: task status, accepted plan, changed files, validation status, and next action. Speak terse. Keep paths, commands, JSON, code, and errors exact."

  wait_for_progress_stream() {
    local pid="$1"
    local waited=0
    local max_wait=50
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$waited" -ge "$max_wait" ]; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        return 124
      fi
      sleep 0.1
      waited=$((waited + 1))
    done
    wait "$pid"
  }

  rm -f "$raw_events_file" 2>/dev/null || true
  : > "$raw_events_file"
  progress_stderr="${KASEKI_RESULTS_DIR}/progress-stream-diagnostics.log"
  progress_fifo="${KASEKI_RESULTS_DIR}/pi-progress-stream.$$.$RANDOM.fifo"
  rm -f "$progress_fifo" 2>/dev/null || true

  if ! mkfifo "$progress_fifo" 2>>"$progress_stderr"; then
    printf '%s [kaseki-agent] failed to create progress fifo; falling back to post-run progress processing\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$progress_stderr" 2>/dev/null || true
  fi

  set +e
  if [ -p "$progress_fifo" ]; then
    KASEKI_STREAM_PROGRESS=0 kaseki-pi-progress-stream "${KASEKI_RESULTS_DIR}"/progress.jsonl /dev/null \
      < "$progress_fifo" \
      2>>"$progress_stderr" &
    progress_pid=$!

    if [ -n "$stderr_target" ]; then
      OPENROUTER_API_KEY="$pi_openrouter_api_key" \
        LLM_GATEWAY_API_KEY="$pi_llm_gateway_api_key" \
        LLM_GATEWAY_URL="$pi_llm_gateway_url" \
        timeout --signal=SIGTERM "$timeout_seconds" \
        pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$model" --tools "$pi_tools" "$bounded_prompt" \
        2> >(tee -a "$stderr_target" >&2) \
        | node -e '
const fs = require("fs");
const [rawPath, fifoPath] = process.argv.slice(1);
const raw = fs.openSync(rawPath, "a");
let fifo;
try {
  fifo = fs.openSync(fifoPath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
} catch {
  fifo = undefined;
}
function writeProgressChunk(chunk) {
  if (fifo === undefined) return;
  try {
    fs.writeSync(fifo, chunk);
  } catch (error) {
    if (error && (error.code === "EPIPE" || error.code === "ENXIO")) {
      try { fs.closeSync(fifo); } catch {}
      fifo = undefined;
    } else if (!(error && error.code === "EAGAIN")) {
      throw error;
    }
  }
}
process.stdin.on("data", (chunk) => {
  fs.writeSync(raw, chunk);
  writeProgressChunk(chunk);
});
process.stdin.on("end", () => {
  if (fifo !== undefined) fs.closeSync(fifo);
  fs.closeSync(raw);
});
' "$raw_events_file" "$progress_fifo"
    else
      OPENROUTER_API_KEY="$pi_openrouter_api_key" \
        LLM_GATEWAY_API_KEY="$pi_llm_gateway_api_key" \
        LLM_GATEWAY_URL="$pi_llm_gateway_url" \
        timeout --signal=SIGTERM "$timeout_seconds" \
        pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$model" --tools "$pi_tools" "$bounded_prompt" \
        | node -e '
const fs = require("fs");
const [rawPath, fifoPath] = process.argv.slice(1);
const raw = fs.openSync(rawPath, "a");
let fifo;
try {
  fifo = fs.openSync(fifoPath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
} catch {
  fifo = undefined;
}
function writeProgressChunk(chunk) {
  if (fifo === undefined) return;
  try {
    fs.writeSync(fifo, chunk);
  } catch (error) {
    if (error && (error.code === "EPIPE" || error.code === "ENXIO")) {
      try { fs.closeSync(fifo); } catch {}
      fifo = undefined;
    } else if (!(error && error.code === "EAGAIN")) {
      throw error;
    }
  }
}
process.stdin.on("data", (chunk) => {
  fs.writeSync(raw, chunk);
  writeProgressChunk(chunk);
});
process.stdin.on("end", () => {
  if (fifo !== undefined) fs.closeSync(fifo);
  fs.closeSync(raw);
});
' "$raw_events_file" "$progress_fifo"
    fi
    pipeline_statuses=("${PIPESTATUS[@]}")
    pi_exit="${pipeline_statuses[0]:-1}"
    splitter_exit="${pipeline_statuses[1]:-0}"
    wait_for_progress_stream "$progress_pid"
    progress_exit=$?
    rm -f "$progress_fifo" 2>/dev/null || true

    if [ "$splitter_exit" -ne 0 ]; then
      printf '%s [kaseki-agent] raw event splitter failed pi_exit=%s splitter_exit=%s raw_events=%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pi_exit" "$splitter_exit" "$raw_events_file" >> "$progress_stderr" 2>/dev/null || true
      if [ "$pi_exit" -eq 0 ]; then
        pi_exit="$splitter_exit"
      fi
    fi
  else
    if [ -n "$stderr_target" ]; then
      OPENROUTER_API_KEY="$pi_openrouter_api_key" \
        LLM_GATEWAY_API_KEY="$pi_llm_gateway_api_key" \
        LLM_GATEWAY_URL="$pi_llm_gateway_url" \
        timeout --signal=SIGTERM "$timeout_seconds" \
        pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$model" --tools "$pi_tools" "$bounded_prompt" \
        > "$raw_events_file" \
        2> >(tee -a "$stderr_target" >&2)
    else
      OPENROUTER_API_KEY="$pi_openrouter_api_key" \
        LLM_GATEWAY_API_KEY="$pi_llm_gateway_api_key" \
        LLM_GATEWAY_URL="$pi_llm_gateway_url" \
        timeout --signal=SIGTERM "$timeout_seconds" \
        pi --mode json --no-session --provider "$KASEKI_PROVIDER" --model "$model" --tools "$pi_tools" "$bounded_prompt" \
        > "$raw_events_file"
    fi
    pi_exit=$?

    KASEKI_STREAM_PROGRESS=0 kaseki-pi-progress-stream "${KASEKI_RESULTS_DIR}"/progress.jsonl /dev/null \
      < "$raw_events_file" \
      2>>"$progress_stderr"
    progress_exit=$?
  fi

  if [ "$progress_exit" -ne 0 ]; then
    printf '%s [kaseki-agent] progress stream failed pi_exit=%s progress_exit=%s raw_events=%s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pi_exit" "$progress_exit" "$raw_events_file" >> "$progress_stderr" 2>/dev/null || true
    emit_error_event "pi_progress_stream_failed" "Progress stream failed while processing Pi output: $progress_exit" "continue"
  fi

  if [ "$pi_exit" -eq 124 ]; then
    printf '%s [kaseki-agent] Pi JSON capture timed out after %ss raw_events=%s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$timeout_seconds" "$raw_events_file" >> "$progress_stderr" 2>/dev/null || true
  elif [ "$pi_exit" -ne 0 ]; then
    printf '%s [kaseki-agent] Pi JSON capture failed pi_exit=%s raw_events=%s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$pi_exit" "$raw_events_file" >> "$progress_stderr" 2>/dev/null || true
  fi
  set +e

  return "$pi_exit"
}
