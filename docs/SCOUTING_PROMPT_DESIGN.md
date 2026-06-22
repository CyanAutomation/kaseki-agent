# Scouting Prompt Design & Architecture

**Version**: 2.0 (Improved Structure with Task Validation)  
**Last Updated**: June 2026

## Overview

The **Scouting Prompt** is the system message sent to the Pi coding agent during the read-only scouting phase. Its job is to analyze a repository and task description, then produce a structured JSON artifact (`scouting-candidate.json`) that helps a downstream coding agent understand what to do and how to do it correctly.

## Why Scouting Exists

The scouting phase addresses two core problems:

1. **Task Ambiguity**: User requests are often vague ("fix bugs", "refactor", "make it better"). Scouting validates the task scope before committing expensive coding agent resources.

2. **Missing Context**: A fresh coding agent has no idea which files matter, which tests to update, or where changes might ripple. Scouting gathers this intelligence in advance.

## Prompt Structure (Phase 1-3 Improvements)

The scouting prompt has been restructured into clearly-marked sections for maintainability and clarity:

### `## [ROLE]`
- **2-3 sentences** defining the agent's job
- Sets expectations: analyze → understand → produce JSON
- Emphasizes that scouting output is *planning input*, not the final artifact

### `## [OPERATIONAL CONSTRAINTS - Read-Only Phase]`
- Lists concrete do-nots (no git operations, no package installation, no file modification)
- Explains the output contract: exactly one JSON object to `/results/scouting-candidate.json`
- Keeps the agent's scope bounded and predictable

### `## [TASK VALIDATION - Ensure Task is Valid Before Scouting]`
- **NEW in Phase 2**: Guidance on validating task scope before deep analysis
- Examples of valid tasks (concrete, file-specific, testable)
- Examples of invalid/ambiguous tasks (too vague, unbounded, unclear scope)
- **Success Criteria**: What makes a "good" scouting artifact
  - task field: concrete, restated original request (max 200 chars)
  - requirements: 3-8 specific, testable items
  - relevant_files: 5-20 files with rationales
  - plan: 5-15 distinct steps
  - test_impact: identifies 80%+ of affected files
  - JSON size: <50 KB, completes in <2 minutes
- **When to Ask Clarifying Questions**: Template for ambiguous tasks
  - Produces minimal artifact with `[UNCLEAR - needs clarification]` task field
  - Avoids wasted analysis on undefined scope

### `## [OUTPUT SCHEMA]`
- **Detailed field descriptions** with constraints (e.g., "task: string (max 200 chars)")
- Type information (string, array, object) with item count guidance
- Output rules: concreteness, no copying guidelines, size limits
- Includes 50 KB maximum size constraint

### `## [GUIDELINES: test_impact - Critical for Test Coverage Alignment]`
- **Enhanced** with concrete test_examples showing before/after assertions
- Organized by change type:
  1. **Parser & Regex Changes** (edge cases, null safety, type validation)
  2. **Event Handling & Progress Changes** (timing, field presence, listeners)
  3. **Response Construction & Serialization** (field mapping, format compliance)
  4. **Naming Conventions & Constants** (field name assertions, API contracts)
- Each change type includes detection keywords, typical test files, and example patterns
- Notes when test_impact can be empty (rare; requires explicit reasoning)

### `## [GUIDELINES: critical_change_expectations]`
- When to include: concrete files or literal diff evidence
- required_files: repo-relative paths for changed-files.txt validation
- required_search_strings: exact strings expected in git.diff (function names, config keys, etc.)
- forbidden_empty_diff: true for patches, false for inspections
- Guidance on avoiding guessing; contract enforced before goal-check

### `## [GUIDELINES: suggested_allowlist]`
- agent_patterns: glob patterns for files the coding agent can modify
- validation_patterns: glob patterns for files validation commands may modify
- Rationale for pattern choice (specific vs. broad trade-offs)

### `## [EXECUTION CONTEXT - Optimize for Efficiency]`
- **NEW in Phase 3**: Provider-agnostic execution guidance
- **Timeouts**: 2-minute target (no deep recursion, use fast commands like find/grep)
- **Artifact Size**: 50 KB max, with truncation strategy for large repos
- **Error Handling**: Fail gracefully on unreadable files; adapt scope rather than fail

### `## [RAW TASK PROMPT]`
- The actual task prompt (e.g., "Fix null-safety in parseRole()")
- Inserted as `$TASK_PROMPT` environment variable by kaseki-agent.sh

## Key Design Decisions

### 1. Structure Over Prose
- Uses `## [SECTION]` markers instead of prose paragraphs
- Easier for LLMs to parse, easier to maintain, easier to extend
- Each section has a clear boundary and purpose

### 2. Task Validation (Phase 2)
- Scouting should **validate** before analyzing, not assume scope
- Reduces wasted analysis on ambiguous tasks
- Provides a clear template for escalation ("needs clarification")

### 3. Provider-Agnostic Execution Context (Phase 3)
- No mention of "LLM Gateway" or "OpenRouter" 
- Gateway abstraction handles provider routing; scouting doesn't need to know
- Focuses on universal constraints: timeouts, size limits, error handling
- Works with any provider that runs via Kaseki

### 4. Concrete Test_impact Examples
- Before/after assertions show exactly what needs updating
- Organized by change type so agent can pattern-match
- Reduces likelihood of missed tests

### 5. Size Constraints (50 KB)
- Prevents runaway analysis on large repos
- Forces prioritization of relevant files
- Keeps artifact within token/rate limits for downstream agents

## Field Constraints (Phase 4 Implementation)

When fully refined, the output schema includes field-level constraints:

| Field | Min | Max | Notes |
|-------|-----|-----|-------|
| `task` | 20 chars | 200 chars | Concrete verb + file/scope |
| `requirements` | 3 items | 8 items | Atomic, testable items |
| `relevant_files` | 5 items | 20 items | Path + reason pairs |
| `plan` | 5 steps | 15 steps | No "finish" step |
| `validation` | 2 cmds | 10 cmds | Specific, focused |
| `risks` | 0 items | 10 items | Concrete unknowns |
| `test_impact` | 0 items | ∞ items | Always include; examples in each |
| **JSON size** | — | **50 KB** | Truncate observations if needed |

## How to Extend the Prompt

### Adding a New Change Type to test_impact
1. Identify the keyword pattern (e.g., "config", "middleware", "plugin")
2. List typical test files affected
3. Provide 2-3 concrete before/after assertion examples
4. Document which files to check (tests/config.test.ts, etc.)
5. Add to `Enhanced Guidelines by Change Type` section

### Adding a New Constraint or Section
1. Identify the gap (e.g., "agent doesn't know about X")
2. Add a new `## [SECTION]` if it's cross-cutting, or extend existing section
3. Provide concrete examples or rationale
4. Update tests in `test/scouting-prompt-improvements.test.ts`
5. Run tests to verify

### Deprecating Old Guidance
1. Mark as ⚠️ DEPRECATED at the top of the section
2. Link to replacement guidance
3. Keep for 2 releases for transition
4. Remove and update tests

## Related Files

- [kaseki-agent.sh](../kaseki-agent.sh) - Line 5754: `build_scouting_prompt()` function
- [test/scouting-prompt-improvements.test.ts](../test/scouting-prompt-improvements.test.ts) - TDD test suite
- [docs/QUICK_START.md](QUICK_START.md) - User-facing intro to scouting phase
- [docs/TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) - Examples of good task prompts
- [docs/QUALITY_GATES.md](QUALITY_GATES.md) - Allowlist and diff validation

## Testing the Prompt

The scouting prompt is validated by automated tests that check:

**Phase 1-3 Tests** (implemented):
- ✓ All required sections present and well-formed
- ✓ Role statement and operational constraints clear
- ✓ Task validation guidance with examples
- ✓ Output schema documented with constraints
- ✓ test_impact guidelines comprehensive and concrete
- ✓ Execution context guidance present

**Phase 4 Tests** (TODO):
- [ ] Field constraints enforced (task <200 chars, 3-8 requirements, etc.)
- [ ] test_impact examples are executable patterns
- [ ] critical_change_expectations guidance is clear

**Phase 5 Tests** (TODO):
- [ ] SCOUTING_PROMPT_DESIGN.md exists and is up-to-date
- [ ] Inline comments in kaseki-agent.sh explain each section
- [ ] Usage examples with sample scouting artifacts

## Common Patterns

### Pattern 1: Parser/Validation Change
**Task**: Fix null-safety in parseRole()
**test_impact**: Tests for edge cases (null, empty, undefined)
**test_examples**:
```javascript
// Before
expect(() => parseRole(null)).toThrow();
// After
expect(parseRole(null)).toEqual({ name: 'Unnamed' });
```

### Pattern 2: Event Field Changes
**Task**: Add async timing to event listeners
**test_impact**: Event listener tests, timing assertions
**test_examples**:
```javascript
// Before
await eventPromise; // within 10ms
// After
await eventPromise; // within 50ms (now async)
```

### Pattern 3: Naming/Constant Changes
**Task**: Rename `parseConfig` to `loadConfigFromFile`
**test_impact**: All string literal assertions referencing old name
**test_examples**:
```javascript
// Before
expect(typeof Config.parseConfig).toBe('function');
// After
expect(typeof Config.loadConfigFromFile).toBe('function');
```

## Metrics & Success

A well-designed scouting prompt produces artifacts that:

1. **Completeness**: Coverage of 80%+ of files affected by the task (measured post-implementation)
2. **Accuracy**: test_impact examples match actual test changes needed
3. **Conciseness**: JSON <50 KB even for large repos
4. **Speed**: Completes within 2 minutes
5. **Utility**: Coding agent reduces iteration count (fewer retries, fewer restorions)

## Version History

### v2.0 (June 2026) - Structural Improvements
- Added `## [SECTION]` markers for clarity and maintainability
- Introduced Phase 2: Task Validation with examples and escalation template
- Introduced Phase 3: Provider-agnostic Execution Context guidance
- Enhanced test_impact with organized change type categories
- Added field constraints documentation (Phase 4 preview)

### v1.0 (Pre-May 2026) - Original Release
- Flat prompt structure
- Basic output schema and test_impact guidelines
- No task validation or execution context

## Contributing

To improve this prompt:

1. Run existing tests: `npm test -- test/scouting-prompt-improvements.test.ts`
2. Identify gaps or improvements
3. Update `kaseki-agent.sh` build_scouting_prompt() function
4. Add/update tests in test suite
5. Run tests to verify
6. Document changes in this file

---

**For questions about scouting artifact interpretation**, see [docs/result-report-analysis/SKILL.md](../.agents/skills/result-report-analysis/SKILL.md).

**For examples of real scouting tasks**, see [docs/EXAMPLES.md](EXAMPLES.md) and [docs/TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md).
