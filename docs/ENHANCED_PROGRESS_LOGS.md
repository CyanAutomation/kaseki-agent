# Enhanced Pi Agent Progress Logs

## Overview

This feature enhances the real-time progress logs emitted during Pi coding agent execution. Instead of showing only event counts and tool start/end notifications, the logs now include **contextual information** about what the agent is doing: file operations, decisions being made, and tool outputs.

**Status**: ✅ Complete and tested (49 new test cases, all passing)

## What Changed

### Before

```
[progress] pi tool: started read
[progress] pi tool: finished read
[progress] pi coding agent: working; events=163, tool starts=0, tool ends=0
[progress] pi tool: started bash
[progress] pi tool: finished bash
```

### After

```
[progress] pi tool: start read | src/parser.ts (15s)
[progress] pi tool: end read | src/parser.ts (15s)
[progress] pi coding agent: working | 1m 23s elapsed
[progress] pi tool: start bash | npm test (1m 35s)
[progress] pi tool: end bash | npm test (1m 35s)
[progress] pi: processing | implementing error handler (1m 45s)
```

**With colors** (red for errors, yellow for warnings):

- Errors display in **RED**: `[progress] pi tool: bash npm test | FAILED`
- Warnings display in **YELLOW**: `[progress] pi: auto retry started`

## New Files

### Core Implementation

#### `src/pi-progress-summarizer.ts`

Main summarization module with the following exports:

- **`extractFilePath(toolName, content)`** — Extracts file paths from tool operations
  - Handles `read_file`, `write_file`, `grep_search`, `file_search`, etc.
  - Shortens absolute paths (removes `/workspaces/kaseki-agent/` prefix)
  - Truncates long paths with ellipsis (`…/src/file.ts`)

- **`extractDecision(content)`** — Detects agent decision keywords
  - Keywords: `create`, `modify`, `fix`, `implement`, `refactor`, `delete`, `update`, etc.
  - Returns a sentence snippet containing the keyword, max 60 chars

- **`detectError(content)`** — Identifies error patterns in tool output
  - Patterns: `error`, `failed`, `exception`, `exit code`, `cannot`, `not found`, etc.
  - Returns `{ hasError: boolean, snippet?: string }`

- **`formatProgressMessage(stage, action, detail, level, elapsed)`** — Format logs with color
  - **stage**: `"pi tool"` or `"pi coding agent"`
  - **action**: The main action (e.g., `"read src/parser.ts"`)
  - **detail**: Additional context (optional)
  - **level**: `"info"` | `"warn"` | `"error"` (colors applied as specified)
  - **elapsed**: Time since start, e.g., `"1m 23s"`

- **`EventSampler(rate)`** — Sample high-frequency events
  - **rate**: Emit 1 out of every N events (default 10)
  - Prevents log spam from `message_update` events
  - Call `shouldEmit()` to check if event should be logged

- **`formatElapsed(startTime)`** — Convert timestamp to human-readable duration
  - Returns `"45s"` or `"1m 25s"`

- **`truncate(text, maxLen)`** — Truncate text with ellipsis
  - Default max length: 100 chars
  - Adds `…` if truncated

#### `src/ansi-colors.ts`

Color code management:

- **`ANSI_COLORS`** constant object with color codes
  - `RED`, `YELLOW`, `GREEN`, `BLUE`, `CYAN`, `MAGENTA`, `WHITE`, `RESET`, `BOLD`, `DIM`
  - Automatically detects TTY; returns empty strings when piped (no ANSI codes in files)
  - Respects `NO_COLOR` environment variable

- **`stripAnsi(text)`** — Remove ANSI codes from a string
  - Used when writing to JSON logs to keep them clean

#### Enhanced `src/pi-progress-stream.ts`

Real-time progress stream integration:

- Imports and uses the summarizer functions
- Adds **color support** for error/warning events
- Implements **message sampling** (1 per 15 events to avoid noise)
- Tracks **elapsed time** since Pi agent start
- Emits periodic **"X elapsed"** messages every 30 seconds
- Strips ANSI codes when writing to `progress.jsonl` (keeps raw logs clean)

## Environment Variables

### New Variables

- **`KASEKI_PROGRESS_SUMMARIZATION`** (default: `1`)
  - Set to `0` to disable enhanced summaries (revert to old format)
  - Useful for debugging if summarization causes issues

### Existing Variables

- **`KASEKI_STREAM_PROGRESS`** (default: `1`)
  - Set to `0` to suppress all `[progress]` stdout output
  - Still writes to `/results/progress.log` and `progress.jsonl`

- **`NO_COLOR`** (default: empty)
  - If set, suppresses ANSI color codes even in TTY
  - Colors only applied when output is to a terminal (TTY)

## Output Files

### Updated `progress.jsonl`

Each line is a JSON object with:

```json
{
  "timestamp": "2026-05-08T20:54:58.841Z",
  "updatedAt": "2026-05-08T20:54:58.841Z",
  "stage": "pi tool",
  "message": "start read | src/parser.ts (15s)",
  "counts": { "tool_execution_start": 5, ... },
  "level": "info"
}
```

**New optional fields:**

- **`message`** — Now includes file paths, decisions, and durations
- **`level`** — `"info"` | `"warn"` | `"error"` (when applicable)

**Note:** ANSI color codes are **stripped** from `progress.jsonl` so the JSON file remains clean and parseable.

### `progress.log` (human-readable)

Plain text log with color codes (ANSI escape sequences) preserved when in TTY.

### `pi-events.jsonl` (post-run)

Unchanged. Processing by `pi-event-filter` is unaffected.

## Test Coverage

### New Tests (49 tests total)

**`src/pi-progress-summarizer.test.ts`** (41 tests):

- `extractFilePath`: 7 tests (paths, relative paths, truncation)
- `extractDecision`: 5 tests (keywords, case-insensitive, context)
- `detectError`: 6 tests (error patterns, exit codes, snippets)
- `formatElapsed`: 3 tests (seconds, minutes, durations)
- `truncate`: 4 tests (length, ellipsis, edge cases)
- `formatProgressMessage`: 6 tests (formatting, coloring, level handling)
- `EventSampler`: 4 tests (sampling rate, reset, defaults)
- `summarizeEvent`: 6 tests (file paths, errors, decisions, timing)

**`src/ansi-colors.test.ts`** (8 tests):

- Color constant exports and properties
- `stripAnsi` function for removing ANSI codes
- TTY detection and color code stripping

All tests pass on both TTY and non-TTY environments.

## Usage Examples

### Standard run (colors enabled in terminal)

```bash
$ OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh
...
[progress] pi coding agent: started
[progress] pi tool: start read | src/parser.ts (5s)
[progress] pi: processing | checking existing structure (8s)
[progress] pi tool: start grep | src/handlers.ts (12s)
[progress] pi: processing | refactoring types (18s)
[progress] pi tool: start write | src/parser.ts (22s)
[progress] pi coding agent: working; events=164 | 1m 23s elapsed
...
```

### With piped output (colors automatically stripped)

```bash
$ OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh 2>&1 | tee output.log
# Colors not applied (piped output)
# But progress.jsonl still has clean data
```

### Disable summaries (revert to basic format)

```bash
$ KASEKI_PROGRESS_SUMMARIZATION=0 OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh
[progress] pi tool: started read
[progress] pi tool: finished read
[progress] pi coding agent: working; events=163, tool starts=0, tool ends=0
```

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Sample message updates** (1 per 15) | Prevents spam; agents emit 100+ message updates per run; sampling shows progress without overwhelming |
| **1-line summaries max** | Fits typical terminal widths (80-100 chars); keeps logs concise |
| **Elapsed time every 30s** | Helps assess progress; not per-action to avoid clutter |
| **Colors only on TTY** | Prevents ANSI codes in log files; respects `NO_COLOR` |
| **Strip colors from JSON** | Keeps `progress.jsonl` clean and parseable by downstream tools |
| **Optional summarization** | Can disable with env var if needed; no breaking changes |

## Performance Considerations

- **Per-event overhead**: ~1-2ms per event (string matching, regex extraction)
- **For typical run** (500 events): ~500-1000ms total overhead
- **Acceptable?** Yes, represents <1% of typical 2-5 minute agent run

If performance becomes a concern, add `KASEKI_PROGRESS_SUMMARIZATION=0` to disable.

## Future Enhancements

1. **Highlight file types**: Color `src/` files differently from `tests/` or `node_modules/`
2. **Track changes per tool**: Show "3 files modified" summary at end
3. **Error recovery tracking**: "Retry 2/3 after error" messages
4. **Token usage estimate**: "~5000 tokens used" periodic updates
5. **Estimated time to completion**: "~2m remaining" based on observed patterns

## Troubleshooting

### No colors appearing?

- Check if output is in a TTY: `ls -la /dev/tty`
- If piped, colors are intentionally disabled
- Set `NO_COLOR=1` to disable even on TTY
- Or redirect to a file and check raw content: `cat /results/progress.log | od -c`

### Logs are too verbose?

- Set `KASEKI_PROGRESS_SUMMARIZATION=0` to disable summaries
- Or set `KASEKI_STREAM_PROGRESS=0` to suppress stdout (still writes to file)

### Logs are too terse?

- Currently not configurable, but can be tuned in code:
  - Edit `src/pi-progress-stream.ts` line 64: `const messageSampler = new EventSampler(15);` → `new EventSampler(5);` for more messages
  - Or increase in `src/pi-progress-summarizer.ts`: `truncate(..., 100)` → `truncate(..., 150)`

### JSON logs have ANSI codes?

- This should never happen (codes are stripped before writing)
- If it does, check `stripAnsi()` function in `ansi-colors.ts`

## Related Files

- [docs/QUALITY_GATES.md](QUALITY_GATES.md) — Progress logs used for quality gate reporting
- [docs/TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) — Examples of prompts that generate informative agent decisions
- [src/pi-event-filter.ts](../src/pi-event-filter.ts) — Post-run filtering (unchanged)
- [src/progress-stream-utils.ts](../src/progress-stream-utils.ts) — Tool name sanitization (existing utility)
