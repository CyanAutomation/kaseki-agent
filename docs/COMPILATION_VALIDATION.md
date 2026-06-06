# Compilation Validation: Earlier Build Checking

Kaseki's **compilation validation** feature runs build commands early (before and after the main agent) to catch compilation errors as soon as possible, rather than waiting until validation phase.

## Overview

### Why Early Compilation Checks?

When an agent modifies code across a typed language (TypeScript, Go, Rust, Java, Python), it's essential to catch **compilation errors early**:

- ❌ **Without early checks**: Agent completes → validation phase starts → build fails → entire run fails
- ✅ **With early checks**: Scouting phase detects build capability → Agent runs aware it will be tested → Pre-main build fails fast → Can re-prompt or abort

### Supported Languages

Kaseki automatically detects and validates compilation for:

| Language | Config Files | Build Command |
|----------|--------------|---------------|
| TypeScript | `tsconfig.json`, `package.json` (npm scripts) | `npm run build` |
| Go | `go.mod` | `go build ./...` |
| Rust | `Cargo.toml` | `cargo build` |
| Java | `pom.xml` or `build.gradle` | Maven: `mvn clean install` / Gradle: `gradle build` |
| Python | `setup.py` or `pyproject.toml` | `python -m build` |

## How It Works

### Phase Sequence

```
Scouting (read-only)
  ↓
  ├─ Language detection: TypeScript found (tsconfig.json)
  ├─ Build command detection: npm run build
  └─ Store in BuildCapability context
  
Goal Setting
  ├─ Enhance goal with compilation criterion:
  │  "Compilation succeeds with 'npm run build' (exit code 0)"
  └─ Add to SMART requirements
  
Main Agent TASK_PROMPT (enhanced)
  ├─ Embed scouting results:
  │  "🔧 **Build System**: typescript
  │   Your changes will be validated by running: npm run build
  │   Ensure compilation succeeds with no errors."
  └─ Agent is aware of build requirements
  
Pre-Main Compilation (NEW - Exit Code 10)
  ├─ Run: npm run build
  ├─ If success → Agent runs
  └─ If failure → Exit 10 (quality gate)
  
Main Agent (with awareness)
  ↓ (if pre-main passed)
  
Post-Main Validation
  ├─ Run validation commands (npm test, etc.)
  ├─ Compare pre-main vs post-main build status
  └─ Report: Did agent improve compilation?
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 10 | **Pre-main compilation failure** (NEW) |
| 4 | Diff exceeds max bytes |
| 5 | Changed file outside allowlist |
| 6 | Secret scan hit |
| 7 | Validation phase files outside allowlist |

## Configuration

### Environment Variables

Set these variables to control compilation validation:

```bash
# Core Settings
export KASEKI_MODEL="openrouter/free"
export TASK_PROMPT="Fix the TypeScript compilation errors"

# Compilation Specific (auto-detected but can override)
export KASEKI_COMPILATION_ENABLED=true        # Enable/disable (default: true if build detected)
export KASEKI_COMPILATION_TIMEOUT_SECONDS=300 # Build timeout (default: 300s / 5min)
export KASEKI_KEEP_COMPILATION_LOGS=true      # Keep build logs in results (default: true)
```

### Example: TypeScript Project

```bash
# Configuration
export OPENROUTER_API_KEY="sk-or-..."
export KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
export KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"
export TASK_PROMPT="Fix TypeScript compilation errors in the parser module"

# Run
./run-kaseki.sh
```

**What happens:**

1. Scouting detects: TypeScript + `npm run build`
2. Pre-main build runs → If fails, exit 10
3. Goal enhanced with: "Compilation succeeds with 'npm run build'"
4. TASK_PROMPT includes: Build context
5. Agent runs aware of build requirement
6. Post-main: validation commands run including final build check
7. Report shows: Pre vs post compilation status

### Example: Go Project

```bash
export OPENROUTER_API_KEY="sk-or-..."
export KASEKI_CHANGED_FILES_ALLOWLIST="cmd/** pkg/** tests/**"
export TASK_PROMPT="Refactor the HTTP server to use context.Context properly"

./run-kaseki.sh
```

**What happens:**

1. Scouting detects: Go + `go build ./...`
2. Pre-main: builds from repo root
3. Goal: "Compilation succeeds with 'go build ./...'"
4. Agent knows build will be tested
5. Post-main: build again + run tests
6. Report: Changes compile cleanly

## Result Artifacts

All compilation results saved to `/agents/kaseki-results/kaseki-N/`:

### Logs

- `metadata.json` → "pre-main-compilation": {success, exitCode, duration}
- `pre-main-build.log` → Raw output from initial compilation attempt
- `validation.log` → Output from post-main build (as part of validation commands)

### Reports

- `result-summary.md` → "Compilation Status: ✅ PASSED" or "❌ FAILED"
- `<standard-build.log>` → Each build attempt logged

### Structured Data

```json
{
  "timestamp": "2026-06-06T15:30:45.123Z",
  "success": true,
  "exitCode": 0,
  "command": "npm run build",
  "language": "typescript",
  "duration": "2500ms",
  "output": "dist/index.js compiled successfully"
}
```

## Common Scenarios

### Scenario 1: Pre-Main Build Already Fails

**Situation:** The repo has existing compilation errors. Agent is asked to fix them.

```bash
export TASK_PROMPT="Fix the TypeScript compilation errors preventing build"
export KASEKI_CHANGED_FILES_ALLOWLIST="src/**"
./run-kaseki.sh
```

**What happens:**

1. Pre-main build runs → **FAILS** (existing errors)
2. Exit code 10 returned immediately
3. No agent runs (fails at pre-main gate)

**Solution:** This is actually correct behavior — if the repo can't build, the agent shouldn't run yet. But you can override this:

```bash
export KASEKI_ALLOW_BROKEN_BUILD=true  # Skip pre-main check if repo already broken
./run-kaseki.sh
```

### Scenario 2: Agent Breaks Previously Working Build

**Situation:** Repo builds cleanly. Agent makes changes that break compilation.

```bash
export TASK_PROMPT="Add async/await to the HTTP handler"
export KASEKI_CHANGED_FILES_ALLOWLIST="src/handlers/**"
./run-kaseki.sh
```

**Result:**

1. Pre-main build: ✅ SUCCESS
2. Agent runs and modifies `src/handlers/api.ts`
3. Post-main build: ❌ FAILED (type errors from async changes)
4. Validation phase reports: "Compilation regressed"
5. Exit code: Validation failure (propagated from build command)

**What the report shows:**

```markdown
## Compilation Status

Pre-agent: ✅ PASSED (npm run build)
Post-agent: ❌ FAILED (npm run build)

Status: **REGRESSION** — Agent broke compilation

Error Details:
src/handlers/api.ts:23:15 - error TS2322: 
  Type 'Promise<Response>' is not assignable to type 'Response'
  
Suggestion: Add 'await' or wrap return in Promise
```

### Scenario 3: Agent Successfully Improves Build

**Situation:** Repo has type errors. Agent fixes them.

```bash
export TASK_PROMPT="Resolve all TypeScript 'strict' mode errors in the data layer"
export KASEKI_CHANGED_FILES_ALLOWLIST="src/db/** src/models/**"
./run-kaseki.sh
```

**Result:**

1. Pre-main build: ❌ FAILED (type errors)
2. Agent runs and fixes types in `src/db/schema.ts`
3. Post-main build: ✅ SUCCESS
4. Validation phase reports: "Compilation improved"
5. Exit code: 0 (SUCCESS)

**What the report shows:**

```markdown
## Compilation Status

Pre-agent: ❌ FAILED (npm run build)
Post-agent: ✅ PASSED (npm run build)

Status: **IMPROVED** — Agent fixed compilation errors

Fixed Issues (12):
- error TS2339: Property 'id' does not exist on type 'User' (3 files)
- error TS2322: Type 'null' not assignable to 'string' (9 files)
```

## Troubleshooting

### Issue: Build Timeout

**Symptom:** `KASEKI_COMPILATION_TIMEOUT_SECONDS` exceeded, compilation exits with code 124.

**Solutions:**

```bash
# Increase timeout (default 300s = 5min)
export KASEKI_COMPILATION_TIMEOUT_SECONDS=600  # 10 minutes

# Or skip pre-main check (still runs post-main)
export KASEKI_PRE_MAIN_COMPILATION_CHECK=false

./run-kaseki.sh
```

### Issue: Pre-Main Fails, But I Still Want Agent to Run

**Situation:** Repo has existing breaks; you want agent to attempt fixing anyway.

```bash
export KASEKI_ALLOW_BROKEN_BUILD=true
./run-kaseki.sh
```

This skips the pre-main gate but still reports the improvement in post-main.

### Issue: Build Command Not Detected

**Symptom:** Scouting doesn't detect your build system.

**Solution:** Explicitly set the command:

```bash
export KASEKI_BUILD_COMMAND="make build"  # Makefile project
export KASEKI_BUILD_LANGUAGE="make"

./run-kaseki.sh
```

## Integration with Goal Setting

The compilation criterion is automatically added to your goal's `success_criteria`:

```json
{
  "criterion": "Compilation succeeds with 'npm run build' (exit code 0)",
  "measurement": "Exit code 0, no errors in stdout/stderr",
  "smart_score": "high",
  "category": "functional"
}
```

This is set during scouting and passed to the agent, so it knows build success is critical.

## Best Practices

### 1. Always Specify an Allowlist

Pair compilation validation with an allowlist to prevent unwanted changes:

```bash
export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts"
export TASK_PROMPT="Fix parser compilation errors"
./run-kaseki.sh
```

### 2. Use Clear Task Prompts

Make compilation expectations explicit:

```bash
# Good: Specific about compilation success
export TASK_PROMPT="Fix the TypeScript compilation errors in the parser.
The build must succeed with 'npm run build' with no type errors."

# Avoid: Vague about expectations
export TASK_PROMPT="Fix the parser"
```

### 3. Test Locally First

Before running kaseki on a large codebase, verify your build works locally:

```bash
npm run build  # Should succeed
git diff      # Should be clean

./run-kaseki.sh  # Then run kaseki
```

### 4. Monitor Compilation Reports

Check the post-run results:

```bash
cat /agents/kaseki-results/kaseki-N/result-summary.md | grep -A 20 "Compilation"
```

## API Reference

### CompilationValidator (Node.js)

If you're integrating kaseki compilation checks into a custom tool:

```typescript
import {
  runCompilation,
  didCompilationImprove,
  createCompilationReport,
} from './src/validation/compilation-validator';

// Run a build
const result = await runCompilation(
  '/repo/root',
  'npm run build',
  'typescript',
  60000 // timeout in ms
);

// Check if it improved
const preAgent = previousResult;
const postAgent = result;
const improved = didCompilationImprove(preAgent, postAgent);

// Generate report
const report = createCompilationReport(
  'typescript',
  'npm run build',
  result,
  'post-agent'
);
console.log(report);
```

## See Also

- [QUALITY_GATES.md](QUALITY_GATES.md) — Compilation gate in quality gate system
- [ASYNC_AWARENESS.md](ASYNC_AWARENESS.md) — Async-aware code changes
- [GOAL_SETTING_IMPROVEMENTS.md](GOAL_SETTING_IMPROVEMENTS.md) — Smart goal criteria
