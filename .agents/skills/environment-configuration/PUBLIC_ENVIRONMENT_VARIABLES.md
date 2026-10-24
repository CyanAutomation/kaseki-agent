# Public Environment Variables

Generated from `environment-variables.json`. This is a published quick lookup, not a complete runtime manifest.
Use the [canonical environment reference](../../../docs/ENV_VARS.md) for supported settings, defaults, and behavior.
<!-- BEGIN GENERATED PUBLIC ENVIRONMENT VARIABLES -->
| Variable | Default | Description | Accepted values |
|---|---|---|---|
| `GIT_REF` | `main` | Git branch, tag, or commit to check out | Branch name, tag, or commit SHA |
| `TASK_PROMPT` | `A code-fix task` | Instruction passed to the coding agent | Natural-language task prompt |
| `KASEKI_MODEL` | `dynamic/kaseki-agent` | LLM model used for agent execution | Provider-supported model identifier, or `auto` |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `10800` | Maximum agent execution time in seconds | Non-negative integer, up to 86400 |
| `KASEKI_RETENTION_RUNS` | `5` | Number of terminal run result directories retained during storage cleanup | Integer from 0 to 100 |
| `KASEKI_STORAGE_WARN_FREE_BYTES` | `5368709120` | Free-space threshold that triggers automatic retention and cache cleanup | Positive integer bytes, greater than or equal to the minimum threshold |
| `KASEKI_STORAGE_MIN_FREE_BYTES` | `2147483648` | Minimum free space required to accept a new run after cleanup | Positive integer bytes, less than or equal to the warning threshold |
| `KASEKI_CAVEMAN` | `1` | Legacy switch for terse communication guidance | `0` (disable) or `1` (enable) |
| `KASEKI_CAVEMAN_LEVEL` | `2` | Soft prompt and tool-output reduction level | Integer `0` through `3` |
| `KASEKI_CAVEMAN_ROUTER` | `jev` | Enable or disable JEV routing for large tool results | `jev` or `off` |
| `KASEKI_CAVEMAN_ROUTER_MIN_CHARS` | `6000 at level 2; 3000 at level 3` | Minimum result size for the legacy JEV tool-output router; semantic routing uses its token threshold | Positive integer |
| `KASEKI_CAVEMAN_ROUTER_TIMEOUT_MS` | `1200` | Maximum wait for one dynamic tool-output routing decision | Positive integer milliseconds |
| `KASEKI_CAVEMAN_ROUTER_CONFIDENCE_THRESHOLD` | `0.86` | Minimum choice confidence for a local transform in the legacy tool-output router | Number from 0 to 1 |
| `KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED` | `1` | Enable semantic disposition decisions for large coding-phase tool results | `0` (use existing Caveman routing) or `1` (enable semantic routing) |
| `KASEKI_SEMANTIC_CONTEXT_MIN_TOKENS` | `1500` | Minimum estimated tool-result size before semantic routing considers JEV | Positive integer tokens |
| `KASEKI_SEMANTIC_CONTEXT_DISCARD_THRESHOLD` | `0.98` | Minimum discard probability required to omit tool output or a scouting fact from active context | Number from 0 to 1 |
| `KASEKI_SEMANTIC_CONTEXT_CONDENSE_THRESHOLD` | `0.7` | Minimum condense probability required to condense tool output or reduce a scouting fact | Number from 0 to 1 |
| `KASEKI_SEMANTIC_PHASE_TRANSFER_ENABLED` | `1` | Enable bounded JEV routing of scouting facts as they enter coding context | `0` (preserve existing handoff) or `1` (route scouting facts) |
| `KASEKI_SEMANTIC_CONTEXT_REEVALUATION_ENABLED` | `1` | Replace stale large file-read results after a successful same-path file edit | `0` (disable event reevaluation) or `1` (enable event reevaluation) |
| `KASEKI_PROMPT_TOKEN_WARN_THRESHOLD` | `32000` | Per-request context size that triggers a compaction recommendation | Positive integer tokens |
| `KASEKI_CODING_MAX_CONTEXT_TOKENS` | `32000` | Advisory context target for the coding phase | Positive integer tokens |
| `KASEKI_CODING_MAX_TURNS` | `36` | Advisory logical-turn target for the coding phase | Positive integer turns |
| `KASEKI_CODING_MAX_TOOL_OUTPUT_TOKENS` | `8000` | Advisory aggregate tool-output target for the coding phase | Positive integer tokens |
| `KASEKI_CODING_OUTPUT_TOKEN_TARGET` | `4096` | Advisory generated-output target per coding response; not sent to the provider as a cap | Positive integer tokens |
| `KASEKI_SCOUTING_MAX_TOOL_OUTPUT_TOKENS` | `4000` | Advisory aggregate tool-output target for the scouting phase | Positive integer tokens |
| `KASEKI_GOAL_SETTING_MAX_TOOL_OUTPUT_TOKENS` | `4000` | Advisory aggregate tool-output target for the goal-setting phase | Positive integer tokens |
| `KASEKI_GOAL_CHECK_MAX_TOOL_OUTPUT_TOKENS` | `3000` | Advisory aggregate tool-output target for the goal-check phase | Positive integer tokens |
| `KASEKI_RUN_EVALUATION_MAX_TOOL_OUTPUT_TOKENS` | `3000` | Advisory aggregate tool-output target for the run-evaluation phase | Positive integer tokens |
| `KASEKI_DECISION_MODEL` | `~typesafe/jev-latest` | Model alias used by Task Admission, Goal Check, Run Evaluation, and validation recovery through the shared DecisionService | A supported model alias |
| `KASEKI_TYPED_EVALUATION_ENABLED` | `1` | Enable structured decision evaluation for Goal Check and Run Evaluation | `0` (disable) or `1` (enable) |
| `KASEKI_GOAL_CHECK_CONFIDENCE_THRESHOLD` | `0.8` | Confidence threshold for Goal Check criteria | Number from 0 to 1 |
| `KASEKI_VALIDATION_RECOVERY_MODE` | `observe` | Validation failure assessment and retry policy | `off`, `observe`, or `auto` |
| `KASEKI_VALIDATION_RETRY_SAFE_COMMANDS` | `[]` | Exact validation commands eligible for a bounded automatic retry | JSON array of command strings |
| `KASEKI_VALIDATION_RETRY_CONFIDENCE_THRESHOLD` | `0.9` | Minimum confidence for a validation recovery retry | Number from 0 to 1 |
<!-- END GENERATED PUBLIC ENVIRONMENT VARIABLES -->
